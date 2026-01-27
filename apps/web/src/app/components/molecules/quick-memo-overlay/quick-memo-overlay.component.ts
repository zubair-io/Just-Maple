import {
  Component,
  inject,
  signal,
  computed,
  output,
  OnDestroy,
  HostListener,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import * as Y from 'yjs';
import { NotebookService } from '../../../services/notebook.service';
import { MemoDocumentService } from '../../../services/memo-document.service';
import { RecordingService } from '../../../services/recording.service';
import type { Notebook } from '@maple/shared';

interface RecordingChip {
  id: string;
  duration: number;
  blob: Blob | null;
  isRecording: boolean;
}

@Component({
  selector: 'app-quick-memo-overlay',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './quick-memo-overlay.component.html',
  styleUrl: './quick-memo-overlay.component.scss',
})
export class QuickMemoOverlayComponent implements OnDestroy, AfterViewInit {
  private readonly router = inject(Router);
  private readonly notebookService = inject(NotebookService);
  private readonly memoDocumentService = inject(MemoDocumentService);
  private readonly recordingService = inject(RecordingService);

  @ViewChild('textInput') textInput!: ElementRef<HTMLTextAreaElement>;

  readonly close = output<void>();

  // State
  readonly content = signal('');
  readonly selectedNotebookId = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly isRecording = signal(false);
  readonly recordings = signal<RecordingChip[]>([]);
  readonly error = signal<string | null>(null);
  readonly showNotebookDropdown = signal(false);

  // Recording state from service
  readonly recordingDuration = this.recordingService.duration;
  readonly audioLevel = this.recordingService.audioLevel;

  // Computed
  readonly notebooks = computed(() => this.notebookService.notebooks());

  readonly selectedNotebook = computed(() => {
    const id = this.selectedNotebookId();
    if (!id) return null;
    return this.notebooks().find((n) => n._id === id) || null;
  });

  readonly canSubmit = computed(() => {
    const hasContent = this.content().trim().length > 0;
    const hasRecordings = this.recordings().length > 0;
    return (hasContent || hasRecordings) && !this.isSubmitting() && !this.isRecording();
  });

  readonly inputPlaceholder = computed(() => {
    return this.recordings().length > 0 ? 'Add a note (optional)...' : 'Quick thought...';
  });

  constructor() {
    // Load last used notebook from localStorage
    this.loadLastNotebook();
  }

  ngAfterViewInit(): void {
    // Focus the input when overlay opens
    setTimeout(() => {
      this.textInput?.nativeElement?.focus();
    }, 100);
  }

  ngOnDestroy(): void {
    // Cancel any active recording
    if (this.isRecording()) {
      this.cancelRecording();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Escape to close
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onClose();
    }

    // Cmd/Ctrl + Enter to submit
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (this.canSubmit()) {
        this.submit();
      }
    }
  }

  private loadLastNotebook(): void {
    const lastNotebookId = localStorage.getItem('quick-memo-notebook-id');
    if (lastNotebookId) {
      // Verify the notebook still exists
      const notebooks = this.notebookService.notebooks();
      if (notebooks.find((n) => n._id === lastNotebookId)) {
        this.selectedNotebookId.set(lastNotebookId);
        return;
      }
    }

    // Default to first notebook
    const notebooks = this.notebookService.notebooks();
    if (notebooks.length > 0) {
      this.selectedNotebookId.set(notebooks[0]._id);
    }
  }

  selectNotebook(notebook: Notebook): void {
    this.selectedNotebookId.set(notebook._id);
    this.showNotebookDropdown.set(false);
    localStorage.setItem('quick-memo-notebook-id', notebook._id);
  }

  toggleNotebookDropdown(): void {
    this.showNotebookDropdown.update((v) => !v);
  }

  onBackdropClick(): void {
    this.onClose();
  }

  onClose(): void {
    // Cancel any active recording before closing
    if (this.isRecording()) {
      this.cancelRecording();
    }
    this.close.emit();
  }

  // Recording methods
  async toggleRecording(): Promise<void> {
    if (this.isRecording()) {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    const recordingId = crypto.randomUUID();
    this.error.set(null);

    try {
      // Create recording placeholder on server
      await firstValueFrom(this.recordingService.createRecording(recordingId));

      // Start web recording
      await this.recordingService.startWebRecording(recordingId);
      this.isRecording.set(true);

      // Add recording chip in recording state
      this.recordings.update((recs) => [
        ...recs,
        {
          id: recordingId,
          duration: 0,
          blob: null,
          isRecording: true,
        },
      ]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to start recording');
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      const blob = await this.recordingService.stopWebRecording();
      const duration = this.recordingService.duration();

      // Update the recording chip with the blob
      this.recordings.update((recs) => {
        const last = recs[recs.length - 1];
        if (last && last.isRecording) {
          return [
            ...recs.slice(0, -1),
            {
              ...last,
              duration,
              blob,
              isRecording: false,
            },
          ];
        }
        return recs;
      });

      this.isRecording.set(false);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to stop recording');
      this.isRecording.set(false);
    }
  }

  private cancelRecording(): void {
    this.recordingService.cancelWebRecording();
    this.isRecording.set(false);

    // Remove the in-progress recording chip
    this.recordings.update((recs) => recs.filter((r) => !r.isRecording));
  }

  removeRecording(recordingId: string): void {
    // If it's currently recording, cancel it
    const recording = this.recordings().find((r) => r.id === recordingId);
    if (recording?.isRecording) {
      this.cancelRecording();
    } else {
      this.recordings.update((recs) => recs.filter((r) => r.id !== recordingId));
    }
  }

  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;

    const notebookId = this.selectedNotebookId();
    if (!notebookId) {
      this.error.set('Please select a notebook');
      return;
    }

    this.isSubmitting.set(true);
    this.error.set(null);

    try {
      // Parse content - first line is title, rest is body
      const lines = this.content().split('\n');
      const title = lines[0]?.trim() || this.generateAutoTitle();
      const bodyLines = lines.slice(1);

      // Create the memo
      const { page, ydoc } = await this.memoDocumentService.createMemo(notebookId);

      // Build content in TipTap JSON format
      const contentNodes: unknown[] = [];

      // Add title as H1
      if (title) {
        contentNodes.push({
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: title }],
        });
      }

      // Add body paragraphs
      if (bodyLines.length > 0) {
        for (const line of bodyLines) {
          if (line.trim()) {
            contentNodes.push({
              type: 'paragraph',
              content: [{ type: 'text', text: line }],
            });
          } else {
            contentNodes.push({ type: 'paragraph' });
          }
        }
      }

      // Upload recordings and add embeds
      const completedRecordings = this.recordings().filter((r) => !r.isRecording && r.blob);
      for (const rec of completedRecordings) {
        try {
          // Upload the recording
          await firstValueFrom(
            this.recordingService.uploadRecording(rec.id, rec.blob!, rec.duration),
          );

          // Add recording embed node
          contentNodes.push({
            type: 'recordingEmbed',
            attrs: { recordingId: rec.id },
          });
        } catch (err) {
          console.error('Failed to upload recording:', err);
        }
      }

      // Apply content to Y.Doc
      const prosemirror = ydoc.getXmlFragment('prosemirror');

      // Insert TipTap content structure
      ydoc.transact(() => {
        // Clear existing content
        while (prosemirror.length > 0) {
          prosemirror.delete(0, 1);
        }

        // Insert new content as XML elements
        for (const node of contentNodes) {
          this.insertYjsNode(prosemirror, node as ContentNode);
        }
      });

      // Update page title
      page.title = title;

      // Close overlay and navigate to the new memo
      this.close.emit();
      this.router.navigate(['/', notebookId, page.id]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to create memo');
      this.isSubmitting.set(false);
    }
  }

  private generateAutoTitle(): string {
    const hasRecordings = this.recordings().filter((r) => !r.isRecording).length > 0;
    if (hasRecordings) {
      const now = new Date();
      return `Voice Memo - ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return 'Untitled Memo';
  }

  private insertYjsNode(parent: Y.XmlFragment, node: ContentNode): void {
    if (node.type === 'heading') {
      const elem = new Y.XmlElement('heading');
      const level = node.attrs?.['level'] ?? 1;
      elem.setAttribute('level', String(level));
      if (node.content) {
        for (const child of node.content) {
          if (child.type === 'text' && child.text) {
            const textNode = new Y.XmlText();
            textNode.insert(0, child.text);
            elem.push([textNode]);
          }
        }
      }
      parent.push([elem]);
    } else if (node.type === 'paragraph') {
      const elem = new Y.XmlElement('paragraph');
      if (node.content) {
        for (const child of node.content) {
          if (child.type === 'text' && child.text) {
            const textNode = new Y.XmlText();
            textNode.insert(0, child.text);
            elem.push([textNode]);
          }
        }
      }
      parent.push([elem]);
    } else if (node.type === 'recordingEmbed') {
      const elem = new Y.XmlElement('recordingEmbed');
      const recordingId = (node.attrs?.['recordingId'] as string) ?? '';
      elem.setAttribute('recordingId', recordingId);
      parent.push([elem]);
    }
  }
}

interface ContentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  text?: string;
}
