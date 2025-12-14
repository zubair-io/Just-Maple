import { Component, input, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { Note, Tag } from '@maple/shared';

@Component({
  selector: 'app-note-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent {
  readonly note = input<Note | null>(null);
  readonly tag = input<Tag | null>(null);

  readonly titleChange = output<string>();
  readonly contentChange = output<string>();

  readonly title = signal('');
  readonly contentText = signal('');

  constructor() {
    // Sync title from note input
    effect(() => {
      const currentNote = this.note();
      if (currentNote) {
        this.title.set(currentNote.title);
        // Extract text from content (simplified - content is ProseMirror JSON)
        this.contentText.set(this.extractTextFromContent(currentNote.content));
      } else {
        this.title.set('');
        this.contentText.set('');
      }
    });
  }

  onTitleChange(newTitle: string): void {
    this.title.set(newTitle);
    this.titleChange.emit(newTitle);
  }

  onContentChange(newContent: string): void {
    this.contentText.set(newContent);
    this.contentChange.emit(newContent);
  }

  private extractTextFromContent(content: unknown): string {
    if (!content) return '';

    // Simple text extraction from ProseMirror JSON
    const extractText = (node: { text?: string; content?: unknown[] }): string => {
      if (node.text) return node.text;
      if (node.content) {
        return node.content
          .map((n) => extractText(n as { text?: string; content?: unknown[] }))
          .join('\n');
      }
      return '';
    };

    return extractText(content as { text?: string; content?: unknown[] });
  }
}
