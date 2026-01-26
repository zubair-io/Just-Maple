import {
  Component,
  input,
  signal,
  inject,
  output,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Editor } from '@tiptap/core';

export type AiBotWidgetStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Response from the server-side AI edit endpoint
 */
export interface AiEditResponse {
  success: boolean;
  appliedCount: number;
  responseText?: string;
  errors?: string[];
}

@Component({
  selector: 'app-ai-bot-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-bot-widget.component.html',
  styleUrl: './ai-bot-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiBotWidgetComponent implements AfterViewInit {
  private readonly http = inject(HttpClient);

  @ViewChild('promptInput') promptInputRef?: ElementRef<HTMLInputElement>;

  readonly widgetId = input.required<string>();
  readonly editor = input.required<Editor>();
  readonly getPos = input.required<() => number | undefined>();
  readonly notebookId = input.required<string>();
  readonly pageId = input.required<string>();
  readonly initialPrompt = input<string>('');
  readonly initialStatus = input<AiBotWidgetStatus>('idle');

  readonly deleteRequested = output<string>();

  // Local state
  readonly prompt = signal('');
  readonly status = signal<AiBotWidgetStatus>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly responseText = signal<string | null>(null);
  readonly operationsApplied = signal<number>(0);

  ngAfterViewInit(): void {
    // Initialize from inputs
    this.prompt.set(this.initialPrompt());
    this.status.set(this.initialStatus());

    // Focus the input after a short delay
    setTimeout(() => {
      this.promptInputRef?.nativeElement.focus();
    }, 100);
  }

  /**
   * Handle input changes
   */
  onPromptChange(value: string): void {
    this.prompt.set(value);
  }

  /**
   * Handle Enter key to run prompt
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.runPrompt();
    }
    // Stop propagation to prevent ProseMirror from handling
    event.stopPropagation();
  }

  /**
   * Execute the AI prompt
   * Sends request to server which applies edits directly to the Y.js document
   */
  async runPrompt(): Promise<void> {
    const promptText = this.prompt().trim();
    if (!promptText || this.status() === 'loading') {
      return;
    }

    const editor = this.editor();
    const getPos = this.getPos();
    const widgetPos = getPos();

    if (typeof widgetPos !== 'number') {
      this.errorMessage.set('Widget position not found');
      this.status.set('error');
      return;
    }

    this.status.set('loading');
    this.errorMessage.set(null);
    this.responseText.set(null);
    this.operationsApplied.set(0);

    try {
      // Get document content for AI context
      const documentContent = this.getDocumentContent(editor);

      // Get IDs from inputs
      const notebookId = this.notebookId();
      const pageId = this.pageId();

      // Call API - server applies edits directly to Y.js document
      const response = await firstValueFrom(
        this.http.post<AiEditResponse>(`/api/notebooks/${notebookId}/ai-edit`, {
          prompt: promptText,
          pageId, // Server uses this to apply edits
          document: {
            content: documentContent,
            format: 'markdown',
          },
          context: {
            widgetPosition: widgetPos,
          },
        }),
      );

      // Store response text if any
      if (response.responseText) {
        this.responseText.set(response.responseText);
      }

      // Store applied count
      if (response.appliedCount > 0) {
        this.operationsApplied.set(response.appliedCount);
      }

      // Handle errors from server
      if (response.errors && response.errors.length > 0) {
        this.errorMessage.set(response.errors.join(', '));
      }

      this.status.set(response.success ? 'success' : 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute AI prompt';
      this.errorMessage.set(message);
      this.status.set('error');
    }
  }

  /**
   * Remove the widget from the document
   */
  removeWidget(): void {
    const widgetId = this.widgetId();
    const editor = this.editor();

    // Use the editor command to remove the widget
    (editor.commands as any).removeAiBotWidget(widgetId);
  }

  /**
   * Get document content as text/markdown for AI context
   * This is read-only - used to provide context to the AI
   */
  private getDocumentContent(editor: Editor): string {
    const doc = editor.state.doc;
    const parts: string[] = [];

    doc.descendants((node) => {
      // Skip the AI widget node itself
      if (node.type.name === 'aiBotWidget') {
        return false;
      }

      if (node.isText) {
        parts.push(node.text || '');
      } else if (node.type.name === 'paragraph') {
        parts.push('\n');
      } else if (node.type.name === 'heading') {
        const level = node.attrs['level'] || 1;
        parts.push('\n' + '#'.repeat(level) + ' ');
      } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
        // Lists are handled by their children
      } else if (node.type.name === 'listItem') {
        parts.push('\n- ');
      } else if (node.type.name === 'codeBlock') {
        parts.push('\n```\n');
      } else if (node.type.name === 'blockquote') {
        parts.push('\n> ');
      } else if (node.type.name === 'horizontalRule') {
        parts.push('\n---\n');
      }
      return true;
    });

    return parts.join('').trim();
  }
}
