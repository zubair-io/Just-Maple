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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import type { Note } from '@maple/shared';
import { NotebookDocumentService } from '../../../services/notebook-document.service';
import { SyncStatusComponent } from '../../atoms/sync-status/sync-status.component';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

@Component({
  selector: 'app-notebook-editor',
  standalone: true,
  imports: [CommonModule, SyncStatusComponent],
  templateUrl: './notebook-editor.component.html',
  styleUrl: './notebook-editor.component.scss',
})
export class NotebookEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private readonly notebookService = inject(NotebookDocumentService);
  private readonly destroyRef = inject(DestroyRef);

  readonly noteId = input.required<string>();
  readonly editable = input<boolean>(true);

  readonly isReady = signal(false);
  readonly isFocused = signal(false);
  readonly error = signal<string | null>(null);

  private editor: Editor | null = null;
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private readonly viewReady = signal(false);
  private lastNoteId: string | null = null;

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
      console.log('[NotebookEditor] Initializing editor for', noteId);

      // Open document via service (handles offline-first loading)
      const { ydoc, awareness } = await this.notebookService.openDocument(noteId);
      this.ydoc = ydoc;
      this.awareness = awareness;

      // Wait for editor element
      if (!this.editorRef?.nativeElement) {
        console.error('[NotebookEditor] Editor element not ready');
        return;
      }

      // Create TipTap editor with YJS collaboration
      const localState = awareness.getLocalState();
      const userData = localState?.['user'] || {
        name: 'Anonymous',
        color: '#888888',
      };

      this.editor = new Editor({
        element: this.editorRef.nativeElement,
        extensions: [
          StarterKit as any,
          Placeholder.configure({
            placeholder: 'Start writing...',
          }) as any,
          Collaboration.configure({
            document: ydoc,
            field: 'prosemirror',
          }) as any,
          CollaborationCursor.configure({
            provider: awareness as any,
            user: userData,
          }) as any,
        ],
        editable: this.editable(),
        onFocus: () => this.isFocused.set(true),
        onBlur: () => this.isFocused.set(false),
      });

      this.isReady.set(true);
      console.log('[NotebookEditor] Editor initialized successfully');
    } catch (err) {
      console.error('[NotebookEditor] Failed to initialize:', err);
      this.error.set('Failed to load notebook');
    }
  }

  private cleanup(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }

    if (this.lastNoteId) {
      this.notebookService.closeDocument(this.lastNoteId);
    }

    this.ydoc = null;
    this.awareness = null;
    this.isReady.set(false);
  }

  focus(): void {
    this.editor?.commands.focus();
  }

  getEditor(): Editor | null {
    return this.editor;
  }
}
