import {
  Component,
  input,
  output,
  signal,
  effect,
  inject,
  ElementRef,
  ViewChild,
  OnDestroy,
  afterNextRender,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import type { Note } from '@maple/shared';
import { CollabAutomergeService } from '../../../services/collab-automerge.service';
import type { DocHandle } from '@automerge/automerge-repo/slim';
import { init } from '@automerge/prosemirror';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';

@Component({
  selector: 'app-note-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private readonly collabAutomerge = inject(CollabAutomergeService);
  private readonly destroyRef = inject(DestroyRef);

  // Automerge collaboration state
  private currentDocHandle: DocHandle<any> | null = null;
  private editorView: EditorView | null = null;

  readonly note = input<Note | null>(null);
  readonly editable = input<boolean>(true);

  readonly isFocused = signal(false);

  private readonly destroy$ = new Subject<void>();
  private lastCollabNoteId: string | null = null;
  private readonly viewReady = signal(false);

  constructor() {
    // Initialize editor after view is ready
    afterNextRender(() => {
      this.viewReady.set(true);
    });

    // Initialize Automerge collaboration when note changes
    effect(() => {
      const currentNote = this.note();
      if (!this.viewReady() || !currentNote?._id) {
        this.disconnectCollaboration();
        this.lastCollabNoteId = null;
        return;
      }

      if (currentNote._id !== this.lastCollabNoteId) {
        this.lastCollabNoteId = currentNote._id;
        this.initializeAutomergeCollaboration(currentNote);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
      this.disconnectCollaboration();
    });
  }

  ngOnDestroy(): void {
    this.disconnectCollaboration();
    this.editorView?.destroy();
  }

  // Automerge Collaboration using AutoMirror
  private async initializeAutomergeCollaboration(note: Note): Promise<void> {
    this.disconnectCollaboration();

    try {
      console.log('[AutoMirror] Initializing collaboration for note', note._id);

      // 1. Initialize Automerge Repo
      await this.collabAutomerge.initialize();

      // 2. Get or create DocHandle (if no Automerge doc exists, create empty one)
      const { handle } = await this.collabAutomerge.getOrCreateHandle(note._id, {
        automergeDoc: note.automergeDoc as Uint8Array | undefined,
        documentId: note.documentId,
        content: note.content,
      });

      this.currentDocHandle = handle;

      // 3. Wait for document to be ready
      await handle.whenReady();

      // 4. Initialize text field if it doesn't exist (as empty string, not array)
      handle.change((doc: any) => {
        if (!doc.text) {
          console.log('[AutoMirror] Initializing text field as empty string');
          //doc.text = ''// 'Hello World \n Let\'s go';
        }
      });

      // 5. Use AutoMirror's init() to create schema, document, and plugin
      const { schema, pmDoc, plugin } = init(handle, ['text']);

      console.log('[AutoMirror] Initialized with schema', {
        docContent: pmDoc.content.childCount,
        docType: pmDoc.type.name,
      });

      // 6. Create vanilla ProseMirror editor
      if (!this.editorRef?.nativeElement) {
        console.error('[AutoMirror] Editor element not ready');
        return;
      }

      // Destroy old editor if exists
      this.editorView?.destroy();

      // Create ProseMirror state with AutoMirror plugin
      const state = EditorState.create({
        schema,
        doc: pmDoc,
        plugins: [
          plugin, // AutoMirror plugin MUST be first
          history(),
          keymap({
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
          }),
          keymap(baseKeymap),
        ],
      });

      // Create ProseMirror view
      this.editorView = new EditorView(this.editorRef.nativeElement, {
        state,
        editable: () => this.editable(),
      });
    } catch (error) {
      console.error('[AutoMirror] Failed to initialize collaboration:', error);
    }
  }

  private disconnectCollaboration(): void {
    const noteId = this.note()?._id;

    if (noteId) {
      this.collabAutomerge.cleanupDocument(noteId);
    }

    this.editorView?.destroy();
    this.editorView = null;
    this.currentDocHandle = null;
  }

  focusTitle(): void {
    // Focus the editor
    this.editorView?.focus();
  }
}
