import {
  Component,
  input,
  signal,
  effect,
  inject,
  ElementRef,
  ViewChild,
  OnDestroy,
  afterNextRender,
  DestroyRef,
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { NotebookDocumentService } from '../../../services/notebook-document.service';
import { NoteService } from '../../../services/note.service';
import { SyncStatusComponent } from '../../atoms/sync-status/sync-status.component';
import { SlashCommandMenuComponent } from '../../molecules/slash-command-menu/slash-command-menu.component';
import DragHandle from '@tiptap/extension-drag-handle';
import {
  CustomDocument,
  EmojiReplacer,
  SlashCommands,
  defaultSlashCommands,
  filterCommands,
  getTableExtensions,
  TableOfContents,
  type SlashCommandItem,
} from './extensions';
import { EditorToolbarComponent } from '../../molecules/editor-toolbar/editor-toolbar.component';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

@Component({
  selector: 'app-notebook-editor',
  standalone: true,
  imports: [CommonModule, SyncStatusComponent, EditorToolbarComponent],
  templateUrl: './notebook-editor.component.html',
  styleUrl: './notebook-editor.component.scss',
})
export class NotebookEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  @ViewChild('editorWrapper', { static: false })
  private editorWrapperRef?: ElementRef<HTMLElement>;

  private readonly notebookService = inject(NotebookDocumentService);
  private readonly noteService = inject(NoteService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);

  readonly noteId = input.required<string>();
  readonly editable = input<boolean>(true);

  readonly isReady = signal(false);
  readonly isFocused = signal(false);
  readonly error = signal<string | null>(null);
  readonly isFullWidth = signal(false);

  private _editor: Editor | null = null;
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private readonly viewReady = signal(false);
  private lastNoteId: string | null = null;
  private titleUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedTitle: string = '';
  private slashMenuElement: HTMLElement | null = null;
  private slashMenuComponent: SlashCommandMenuComponent | null = null;

  constructor() {
    // Initialize editor after view is ready
    afterNextRender(() => {
      this.viewReady.set(true);
    });

    // Initialize when noteId changes
    effect(() => {
      const currentNoteId = this.noteId();
      if (!this.viewReady() || !currentNoteId) {
        return;
      }

      if (currentNoteId !== this.lastNoteId) {
        this.lastNoteId = currentNoteId;
        this.initializeEditor(currentNoteId);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.cleanup();
    });
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private async initializeEditor(noteId: string): Promise<void> {
    this.cleanup();
    this.isReady.set(false);
    this.error.set(null);

    try {
      // Open document via service (handles offline-first loading)
      const { ydoc, awareness } = await this.notebookService.openDocument(noteId);
      this.ydoc = ydoc;
      this.awareness = awareness;

      // Wait for editor element
      if (!this.editorRef?.nativeElement) {
        return;
      }

      // Get user info for collaboration cursor
      const userInfo = (awareness.getLocalState() as any)?.user || {
        name: 'Anonymous',
        color: '#888888',
      };

      // Create TipTap editor with YJS collaboration and Notion-like features
      this._editor = new Editor({
        element: this.editorRef.nativeElement,
        extensions: [
          // Custom document that enforces heading first
          CustomDocument,
          // StarterKit without document (we use CustomDocument) and undoRedo (Collaboration has its own)
          StarterKit.configure({
            document: false,
            undoRedo: false,
          } as any),
          // Placeholder with different text for headings
          Placeholder.configure({
            placeholder: ({ node }) => {
              if (node.type.name === 'heading') {
                return 'Note title';
              }
              return "Type '/' for commands...";
            },
          }) as any,
          // YJS Collaboration
          Collaboration.configure({
            document: ydoc,
            field: 'prosemirror',
          }) as any,
          // Collaboration cursors (show other users)
          // Provider wrapper that forwards awareness events to CollaborationCursor
          CollaborationCursor.configure({
            provider: {
              awareness,
              doc: ydoc,
              on: (event: string, callback: (...args: any[]) => void) => {
                if (event === 'awarenessUpdate') {
                  awareness.on('update', callback);
                }
              },
              off: (event: string, callback: (...args: any[]) => void) => {
                if (event === 'awarenessUpdate') {
                  awareness.off('update', callback);
                }
              },
            },
            user: userInfo,
          }),
          // Emoji replacer (e.g., :) -> emoji)
          EmojiReplacer,
          // Task lists
          TaskList,
          TaskItem.configure({
            nested: true,
          }),
          // Table support
          ...getTableExtensions(),
          // Table of Contents
          TableOfContents,
          // Drag handles for blocks
          DragHandle.configure({
            render: () => {
              const handle = document.createElement('div');
              handle.classList.add('drag-handle');
              handle.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <circle cx="4" cy="3" r="1.5"/>
                  <circle cx="10" cy="3" r="1.5"/>
                  <circle cx="4" cy="7" r="1.5"/>
                  <circle cx="10" cy="7" r="1.5"/>
                  <circle cx="4" cy="11" r="1.5"/>
                  <circle cx="10" cy="11" r="1.5"/>
                </svg>
              `;
              return handle;
            },
          }),
          // Slash commands
          SlashCommands.configure({
            suggestion: {
              items: ({ query }: { query: string }) => filterCommands(defaultSlashCommands, query),
              render: () => this.createSlashMenuRenderer(),
              command: ({
                editor,
                range,
                props,
              }: {
                editor: Editor;
                range: any;
                props: SlashCommandItem;
              }) => {
                props.command({ editor, range });
              },
            },
          }),
        ],
        editable: this.editable(),
        onFocus: () => this.isFocused.set(true),
        onBlur: () => this.isFocused.set(false),
        onUpdate: ({ editor }) => this.handleContentUpdate(editor),
      });

      // Initialize lastSyncedTitle with the current title from the document
      this.lastSyncedTitle = this.extractFirstHeadingText(this._editor)?.trim() || '';

      this.isReady.set(true);
    } catch {
      this.error.set('Failed to load notebook');
    }
  }

  /**
   * Handle editor content updates - extract first heading and sync as title
   */
  private handleContentUpdate(editor: Editor): void {
    const title = this.extractFirstHeadingText(editor)?.trim();

    // Only update if title changed and not empty
    if (title && title !== this.lastSyncedTitle) {
      // Clear existing timeout
      if (this.titleUpdateTimeout) {
        clearTimeout(this.titleUpdateTimeout);
      }

      // Debounce title updates (500ms)
      this.titleUpdateTimeout = setTimeout(() => {
        this.lastSyncedTitle = title;
        const noteId = this.noteId();
        this.noteService.updateNote(noteId, { title }).subscribe();
      }, 500);
    }
  }

  /**
   * Extract text from the first heading in the document
   */
  private extractFirstHeadingText(editor: Editor): string | null {
    const doc = editor.state.doc;
    let headingText: string | null = null;

    // Find the first heading node
    doc.descendants((node, pos) => {
      if (headingText !== null) return false; // Stop if found

      if (node.type.name === 'heading') {
        headingText = node.textContent.trim();
        return false; // Stop traversal
      }

      return true; // Continue
    });

    return headingText;
  }

  /**
   * Create the slash command menu renderer for TipTap suggestion
   */
  private createSlashMenuRenderer() {
    let popup: HTMLElement | null = null;
    let menuComponent: SlashCommandMenuComponent | null = null;
    let componentRef: any = null;

    return {
      onStart: (props: any) => {
        // Create popup element
        popup = document.createElement('div');
        popup.classList.add('slash-menu-popup');
        popup.style.position = 'absolute';
        popup.style.zIndex = '1000';
        document.body.appendChild(popup);

        // Create Angular component dynamically
        componentRef = createComponent(SlashCommandMenuComponent, {
          environmentInjector: this.injector,
          hostElement: popup,
        });

        menuComponent = componentRef.instance;
        menuComponent!.items.set(props.items);
        menuComponent!.query.set(props.query);

        // Handle command selection
        componentRef.instance.commandSelected.subscribe((item: SlashCommandItem) => {
          props.command(item);
        });

        this.appRef.attachView(componentRef.hostView);

        // Position the popup
        this.updatePopupPosition(popup, props.clientRect);
      },

      onUpdate: (props: any) => {
        if (menuComponent) {
          menuComponent.items.set(props.items);
          menuComponent.query.set(props.query);
        }
        if (popup && props.clientRect) {
          this.updatePopupPosition(popup, props.clientRect);
        }
      },

      onKeyDown: (props: any) => {
        if (!menuComponent) return false;

        if (props.event.key === 'ArrowUp') {
          menuComponent.navigateUp();
          return true;
        }

        if (props.event.key === 'ArrowDown') {
          menuComponent.navigateDown();
          return true;
        }

        if (props.event.key === 'Enter') {
          menuComponent.selectCurrent();
          return true;
        }

        return false;
      },

      onExit: () => {
        if (componentRef) {
          this.appRef.detachView(componentRef.hostView);
          componentRef.destroy();
        }
        if (popup) {
          popup.remove();
          popup = null;
        }
        menuComponent = null;
      },
    };
  }

  /**
   * Position the slash menu popup near the cursor
   */
  private updatePopupPosition(popup: HTMLElement, clientRect: (() => DOMRect | null) | null): void {
    if (!clientRect) return;

    const rect = typeof clientRect === 'function' ? clientRect() : clientRect;
    if (!rect) return;

    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 8}px`;
  }

  private cleanup(): void {
    if (this.titleUpdateTimeout) {
      clearTimeout(this.titleUpdateTimeout);
      this.titleUpdateTimeout = null;
    }

    if (this._editor) {
      this._editor.destroy();
      this._editor = null;
    }

    if (this.lastNoteId) {
      this.notebookService.closeDocument(this.lastNoteId);
    }

    this.ydoc = null;
    this.awareness = null;
    this.isReady.set(false);
    this.lastSyncedTitle = '';
  }

  focus(): void {
    this._editor?.commands.focus();
  }

  getEditor(): Editor | null {
    return this._editor;
  }

  toggleFullWidth(): void {
    this.isFullWidth.update((v) => !v);
  }

  /**
   * Handle click on the editor wrapper to focus
   */
  onEditorWrapperClick(event: MouseEvent): void {
    // Only focus if clicking directly on the wrapper (not on editor content)
    const target = event.target as HTMLElement;
    if (
      target.classList.contains('editor-wrapper') ||
      target.classList.contains('editor-content')
    ) {
      this._editor?.commands.focus('end');
    }
  }
}
