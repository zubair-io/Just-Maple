import {
  Component,
  ElementRef,
  ViewChild,
  afterNextRender,
  OnDestroy,
  inject,
  signal,
  computed,
  effect,
  Signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NoteService } from '../../services/note.service';
import { AuthService } from '../../services/auth.service';
import { TagService } from '../../services/tag.service';
import { NoteHeaderComponent } from '../../components';
import { DocumentId, isValidAutomergeUrl, Repo } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { init } from '@automerge/prosemirror';
import { EditorState, Plugin, Transaction, PluginKey } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { wrapInList, sinkListItem, liftListItem, splitListItem } from 'prosemirror-schema-list';
import type { Node, Schema } from 'prosemirror-model';
import { basicSchemaAdapter } from './basic-schema';
import { DEFAULT_NOTE_CONTENT } from '@maple/shared';
import { switchMap, tap } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { WriteService } from './write.service';

// Define the plugin to force the first node to be a header
const forceHeaderPlugin = new Plugin({
  appendTransaction: (transactions, oldState, newState) => {
    // Safety check: if no changes in doc, ignore to prevent loops
    // But we want to enforce it even on init if invalid.
    // The logic below is stable (idempotent) so loops shouldn't happen unless setBlockType fails repeatedly.
    const firstNode = newState.doc.firstChild;
    if (!firstNode) return null;

    // If the first node is already a heading, we're good
    if (firstNode.type.name === 'heading') return null;

    const tr = newState.tr;

    // If it is a textblock (like a paragraph), convert it to a heading
    if (firstNode.isTextblock) {
      tr.setBlockType(0, firstNode.nodeSize, newState.schema.nodes['heading'], { level: 1 });
    } else {
      // Otherwise (e.g. it's a list), insert a heading before it
      tr.insert(0, newState.schema.nodes['heading'].create({ level: 1 }));
    }

    return tr;
  },
});

// Zero-width space to trigger Automerge sync for mark changes
const ZERO_WIDTH_SPACE = '\u200B';

const cursorPluginKey = new PluginKey('cursor');

const cursorPlugin = (handle: any) => {
  let lastBroadcast = 0;
  const BROADCAST_THROTTLE = 100; // ms

  return new Plugin({
    key: cursorPluginKey,
    state: {
      init(config, instance) {
        return {
          cursors: {} as Record<string, { pos: number; color: string }>,
          decorations: DecorationSet.empty,
        };
      },
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(cursorPluginKey);

        // If there's a remote cursor update, re-compute decorations
        if (meta && meta.cursors) {
          const cursors = meta.cursors;
          const decorations: Decoration[] = [];

          Object.entries(cursors).forEach(([peerId, cursor]: [string, any]) => {
            if (cursor && cursor.pos !== null) {
              const widget = document.createElement('span');
              widget.style.borderLeft = `2px solid ${cursor.color}`;
              widget.style.marginLeft = '-1px';
              widget.style.height = '1.2em';
              widget.style.position = 'relative';
              widget.style.display = 'inline-block';
              widget.style.verticalAlign = 'text-top';

              // Add name tag
              const label = document.createElement('div');
              label.textContent = peerId.slice(0, 4);
              label.style.position = 'absolute';
              label.style.top = '-1.2em';
              label.style.left = '-2px';
              label.style.backgroundColor = cursor.color;
              label.style.color = 'white';
              label.style.fontSize = '10px';
              label.style.padding = '1px 3px';
              label.style.borderRadius = '3px';
              label.style.whiteSpace = 'nowrap';
              label.style.pointerEvents = 'none';

              widget.appendChild(label);

              decorations.push(Decoration.widget(cursor.pos, widget, { key: peerId }));
            }
          });

          return {
            cursors,
            decorations: DecorationSet.create(newState.doc, decorations),
          };
        }

        // On local changes, we must map, but we CANNOT map a DecorationSet with widgets easily if they are stuck to positions?
        // Actually DecorationSet.map works well.
        return {
          cursors: value.cursors,
          decorations: value.decorations.map(tr.mapping, newState.doc),
        };
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations || DecorationSet.empty;
      },
    },
    view(view) {
      if (!handle) return {};

      const onEphemeralMessage = (payload: any) => {
        // Payload: { handle, senderId, message }
        const { senderId, message } = payload;

        if (message && message.type === 'cursor') {
          const tr = view.state.tr;
          const currentPluginState = cursorPluginKey.getState(view.state);
          if (currentPluginState) {
            const newCursors = {
              ...currentPluginState.cursors,
              [senderId]: { pos: message.pos, color: message.color },
            };
            tr.setMeta(cursorPluginKey, { cursors: newCursors });
            view.dispatch(tr);
          }
        }
      };

      handle.on('ephemeral-message', onEphemeralMessage);

      return {
        update(view, prevState) {
          const state = view.state;
          if (state.selection.from !== prevState.selection.from) {
            const now = Date.now();
            if (now - lastBroadcast > BROADCAST_THROTTLE) {
              lastBroadcast = now;
              const message = {
                type: 'cursor',
                pos: state.selection.from,
                color: '#0000FF',
              };
              handle.broadcast(message);
            }
          }
        },
        destroy() {
          handle.off('ephemeral-message', onEphemeralMessage);
        },
      };
    },
  });
};

// Create a rich text schema adapter for Automerge

@Component({
  selector: 'app-write',
  standalone: true,
  imports: [NoteHeaderComponent],
  templateUrl: './write.component.html',
  styleUrl: './write.component.scss',
})
export class WriteComponent implements OnDestroy {
  @ViewChild('editor', { static: false })
  private editorRef?: ElementRef<HTMLElement>;
  private readonly router = inject(Router);

  private repo!: Repo;
  private editorView: EditorView | null = null;
  private route = inject(ActivatedRoute);
  private noteService = inject(NoteService);
  private authService = inject(AuthService);
  private tagService = inject(TagService);
  private writeService = inject(WriteService);
  private docHandle: any = null;
  private tagId: any = '';
  private params = toSignal(this.route.paramMap, { initialValue: null });
  private lastDocumentId = '';
  private currentDocumentId = '';
  private newState: EditorState | null = null;

  // Get the note from the store based on docUrl
  readonly selectedNote = toSignal(this.noteService.activeNote$, { initialValue: null });

  // Get the tag for the selected note
  readonly selectedTag = toSignal(this.tagService.activeTag$, { initialValue: null });

  // Active state signals for toolbar
  readonly isBold = signal(false);
  readonly isItalic = signal(false);
  readonly isCode = signal(false);
  readonly currentHeadingLevel = signal<number | null>(null);
  readonly isParagraph = signal(false);
  readonly isBulletList = signal(false);
  readonly isOrderedList = signal(false);

  timerReset = false;

  constructor() {
    effect(() => {
      const params = this.params();
      const isReady = this.writeService.ready();
      if (params && params.has('documentId') && isReady) {
        this.tagId = params.get('tagId') || '';
        const documentId = params.get('documentId') || '';
        this.currentDocumentId = documentId;
        this.noteService.setActiveNoteId(documentId);
        if (this.lastDocumentId !== documentId) {
          this.repo = this.writeService.repo;

          this.cleanup();
          this.initializeEditor();
        }
      }
    });
  }

  private async initializeEditor() {
    try {
      const documentId = this.currentDocumentId;
      const userId = this.authService.user()?._id;

      if (!userId) {
        console.error('[Write] Cannot initialize - user not authenticated');
        return;
      }

      // Enable HTTP + WebRTC adapters for this document
      // Get noteId from selected note
      const note = this.selectedNote();
      const noteId = note?._id || documentId; // Fallback to documentId if no note yet

      const autoMergeUrl = `automerge:${documentId}`;
      let handle;

      if (documentId && isValidAutomergeUrl(autoMergeUrl)) {
        handle = await this.repo.find(autoMergeUrl);
      } else {
        handle = this.repo.create({ text: '' });
        this.noteService
          .createNote({
            title: 'Untitled',
            content: DEFAULT_NOTE_CONTENT,
            tagId: this.tagId,
            documentId: handle.documentId,
          })
          .subscribe();
      }
      this.lastDocumentId = handle.documentId;
      if (documentId !== handle.documentId) {
        this.router.navigate(['/', this.tagId, handle.documentId], {
          replaceUrl: true,
        });

        await handle.whenReady();
        this.docHandle = handle;
        // const binaryData = Automerge.save(handle.doc);
        // const base64Data = btoa(String.fromCharCode(...new Uint8Array([])));

        // this.noteService
        //   .createNote({
        //     title: 'Untitled',
        //     content: DEFAULT_NOTE_CONTENT,
        //     tagId: this.tagId,
        //     documentId: handle.documentId,
        //     automergeDoc: base64Data,
        //   })
        //   .subscribe();
      }

      // Initialize text field if needed
      handle.change((doc: any) => {
        if (!doc.text) {
          doc.text = '';
        }
      });

      // Use AutoMirror with rich text schema
      const { schema, pmDoc, plugin } = init(handle, ['text'], {
        schemaAdapter: basicSchemaAdapter,
      });

      // Create ProseMirror state with rich text support
      const state = EditorState.create({
        schema,
        doc: pmDoc,
        plugins: [
          forceHeaderPlugin,
          cursorPlugin(handle),
          plugin, // AutoMirror plugin first
          history(),
          keymap({
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
            'Mod-b': (state, dispatch) =>
              this.toggleMarkWithSync(schema.marks['strong'])(state, dispatch),
            'Mod-i': (state, dispatch) =>
              this.toggleMarkWithSync(schema.marks['em'])(state, dispatch),
            'Mod-`': (state, dispatch) =>
              this.toggleMarkWithSync(schema.marks['code'])(state, dispatch),
            Tab: sinkListItem(schema.nodes['list_item']),
            'Shift-Tab': liftListItem(schema.nodes['list_item']),
            Enter: splitListItem(schema.nodes['list_item']),
          }),
          keymap(baseKeymap),
        ],
      });

      // Create ProseMirror view
      if (this.editorRef?.nativeElement) {
        this.editorView = new EditorView(this.editorRef.nativeElement, {
          state,
          dispatchTransaction: (tr) => {
            const newState = this.editorView!.state.apply(tr);
            this.editorView!.updateState(newState);
            this.updateActiveState(newState);

            // Sync title to note if the first heading changed
            if (tr.docChanged) {
              this.syncTitleToNote(newState);
              this.newState = newState;
            }
          },
        });
        // Trigger a transaction to ensure valid state immediately
        this.editorView.dispatch(this.editorView.state.tr);
        // Update initial active state
        this.updateActiveState(this.editorView.state);
        this.editorView.focus();
      }
    } catch (error) {
      console.error('[Write] Failed to initialize:', error);
    }
  }

  /**
   * Update active state signals based on current editor selection
   */
  private updateActiveState(state: EditorState) {
    const { $from } = state.selection;
    const marks = $from.marks();

    // Update mark states
    this.isBold.set(marks.some((mark) => mark.type.name === 'strong'));
    this.isItalic.set(marks.some((mark) => mark.type.name === 'em'));
    this.isCode.set(marks.some((mark) => mark.type.name === 'code'));

    // Get the current node (block type)
    const node = $from.parent;

    // Update block type states
    if (node.type.name === 'heading') {
      this.currentHeadingLevel.set(node.attrs['level']);
      this.isParagraph.set(false);
    } else if (node.type.name === 'paragraph') {
      this.currentHeadingLevel.set(null);
      this.isParagraph.set(true);
    } else {
      this.currentHeadingLevel.set(null);
      this.isParagraph.set(false);
    }

    // Check if in list
    let depth = $from.depth;
    let inBulletList = false;
    let inOrderedList = false;

    while (depth > 0) {
      const ancestor = $from.node(depth);
      if (ancestor.type.name === 'bullet_list') {
        inBulletList = true;
      } else if (ancestor.type.name === 'ordered_list') {
        inOrderedList = true;
      }
      depth--;
    }

    this.isBulletList.set(inBulletList);
    this.isOrderedList.set(inOrderedList);
  }

  private lastSyncedTitle = '';
  private titleSyncTimeout: any = null;

  /**
   * Sync the title (first heading) to the note
   */
  private syncTitleToNote(state: EditorState, timeoutMs = 1000) {
    const note = this.selectedNote();
    if (!note?._id) return;
    // Get the first heading as the title
    const firstNode = state.doc.firstChild;
    if (!firstNode || firstNode.type.name !== 'heading') return;
    const title = firstNode.textContent.trim() || 'Untitled';
    // Only update if title changed (debounce)
    if (title === this.lastSyncedTitle) return;
    this.lastSyncedTitle = title;
    // Debounce the update to avoid too many API calls
    if (this.titleSyncTimeout) {
      clearTimeout(this.titleSyncTimeout);
    }
    this.titleSyncTimeout = setTimeout(() => {
      const selectedNote = this.selectedNote();
      if (!selectedNote) {
        return;
      }
      this.noteService.updateNote(selectedNote?.documentId, { title }).subscribe({
        error: (err) => console.error('[Write] Failed to sync title:', err),
      });
    }, timeoutMs); // Wait 1 second after typing stops
  }

  /**
   * Toggle mark command that triggers Automerge sync via temporary zero-width space.
   *
   * Three transactions:
   * 1. Toggle the mark (apply/remove formatting)
   * 2. Insert zero-width space (triggers Automerge to detect change)
   * 3. Remove zero-width space (cleanup, leaves no trace)
   */
  private toggleMarkWithSync(markType: any) {
    return (state: EditorState, dispatch?: (tr: any) => void): boolean => {
      if (!dispatch) {
        return toggleMark(markType)(state);
      }

      // Transaction 1: Toggle the mark
      const toggleResult = toggleMark(markType)(state, dispatch);

      if (!this.editorView) return toggleResult;

      // Transaction 2: Insert zero-width space to trigger sync
      const insertTr = this.editorView.state.tr;
      const { selection } = this.editorView.state;
      const insertPos = selection.from;
      setTimeout(() => {
        insertTr.insertText(ZERO_WIDTH_SPACE, insertPos);
        this.editorView!.dispatch(insertTr);
      }, 0);

      // Transaction 3: Remove the zero-width space immediately
      setTimeout(() => {
        const removeTr = this.editorView!.state.tr;
        removeTr.delete(insertPos, insertPos + 1);
        this.editorView!.dispatch(removeTr);
      }, 50);

      return toggleResult;
    };
  }

  // Toolbar actions
  toggleBold() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    this.toggleMarkWithSync(state.schema.marks['strong'])(state, dispatch);
    this.editorView.focus();
  }

  toggleItalic() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    this.toggleMarkWithSync(state.schema.marks['em'])(state, dispatch);
    this.editorView.focus();
  }

  toggleCode() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    this.toggleMarkWithSync(state.schema.marks['code'])(state, dispatch);
    this.editorView.focus();
  }

  setHeading(level: number) {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;

    // Toggle: if already at this heading level, convert to paragraph
    if (this.currentHeadingLevel() === level) {
      setBlockType(state.schema.nodes['paragraph'])(state, dispatch);
    } else {
      setBlockType(state.schema.nodes['heading'], { level })(state, dispatch);
    }

    this.editorView.focus();
  }

  setParagraph() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    setBlockType(state.schema.nodes['paragraph'])(state, dispatch);
    this.editorView.focus();
  }

  toggleBulletList() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    wrapInList(state.schema.nodes['bullet_list'])(state, dispatch);
    this.editorView.focus();
  }

  toggleOrderedList() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    wrapInList(state.schema.nodes['ordered_list'])(state, dispatch);
    this.editorView.focus();
  }

  toggleFavorite(): void {
    const note = this.selectedNote();
    if (!note?._id) return;

    this.noteService.toggleFavorite(note._id).subscribe({
      error: (error) => {
        console.error('Failed to toggle favorite:', error);
      },
    });
  }

  cleanup() {
    if (this.newState) {
      this.syncTitleToNote(this.newState, 0);
    }
    if (this.titleSyncTimeout) {
      clearTimeout(this.titleSyncTimeout);
    }
    this.editorView?.destroy();
  }

  ngOnDestroy() {
    this.cleanup();
  }
}
