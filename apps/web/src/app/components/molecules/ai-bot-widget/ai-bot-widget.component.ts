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
import { ActivatedRoute } from '@angular/router';

export type AiBotWidgetStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AiEditOperation {
  type: 'insert' | 'delete' | 'replace';
  position?: AnchorPosition;
  from?: AnchorPosition;
  to?: AnchorPosition;
  content?: string;
}

export type AnchorPosition =
  | { type: 'absolute'; pos: number }
  | { type: 'relative'; anchor: 'widget' | 'start' | 'end'; offset: number }
  | { type: 'search'; query: string; occurrence: number };

export interface AiEditResponse {
  operations: AiEditOperation[];
  responseText?: string;
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
  private readonly route = inject(ActivatedRoute);

  @ViewChild('promptInput') promptInputRef?: ElementRef<HTMLInputElement>;

  readonly widgetId = input.required<string>();
  readonly editor = input.required<Editor>();
  readonly getPos = input.required<() => number | undefined>();
  readonly initialPrompt = input<string>('');
  readonly initialStatus = input<AiBotWidgetStatus>('idle');

  readonly deleteRequested = output<string>();

  // Local state
  readonly prompt = signal('');
  readonly status = signal<AiBotWidgetStatus>('idle');
  readonly errorMessage = signal<string | null>(null);

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

    try {
      // Get document content
      const documentContent = this.getDocumentContent(editor);

      // Get notebook ID from route
      const notebookId = this.route.snapshot.paramMap.get('tagId');
      if (!notebookId) {
        throw new Error('Notebook ID not found');
      }

      // Call API
      const response = await firstValueFrom(
        this.http.post<AiEditResponse>(`/api/notebooks/${notebookId}/ai-edit`, {
          prompt: promptText,
          document: {
            content: documentContent,
            format: 'markdown',
          },
          context: {
            widgetPosition: widgetPos,
          },
        }),
      );

      // Apply operations if any
      if (response.operations && response.operations.length > 0) {
        this.applyOperations(editor, response.operations, widgetPos);
      } else if (response.responseText) {
        // If no operations but there's response text, insert it after the widget
        this.insertTextAfterWidget(editor, response.responseText, widgetPos);
      }

      this.status.set('success');

      // Auto-remove widget after successful execution
      setTimeout(() => {
        this.removeWidget();
      }, 500);
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
   * Get document content as text/markdown
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

  /**
   * Apply AI operations to the document
   */
  private applyOperations(editor: Editor, operations: AiEditOperation[], widgetPos: number): void {
    // Sort operations by position (descending) to avoid position shifts
    const sortedOps = [...operations].sort((a, b) => {
      const posA = this.resolvePosition(a, editor, widgetPos);
      const posB = this.resolvePosition(b, editor, widgetPos);
      return posB - posA;
    });

    // Apply all operations in a single transaction
    editor
      .chain()
      .command(({ tr, state }) => {
        for (const op of sortedOps) {
          const from = this.resolveOperationFrom(op, state, widgetPos);
          const to = this.resolveOperationTo(op, state, widgetPos);

          switch (op.type) {
            case 'insert':
              if (op.content) {
                const insertPos = this.resolvePosition(op, editor, widgetPos);
                tr.insertText(op.content, insertPos);
              }
              break;
            case 'delete':
              tr.delete(from, to);
              break;
            case 'replace':
              if (op.content) {
                tr.replaceWith(from, to, state.schema.text(op.content));
              }
              break;
          }
        }
        return true;
      })
      .run();
  }

  /**
   * Insert text after the widget position
   */
  private insertTextAfterWidget(editor: Editor, text: string, widgetPos: number): void {
    // Find the widget node and get its size
    const state = editor.state;
    let widgetSize = 1; // Default node size

    state.doc.descendants((node, pos) => {
      if (pos === widgetPos && node.type.name === 'aiBotWidget') {
        widgetSize = node.nodeSize;
        return false;
      }
      return true;
    });

    const insertPos = widgetPos + widgetSize;

    // Insert a new paragraph with the response text
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })
      .run();
  }

  /**
   * Resolve position for an operation
   */
  private resolvePosition(op: AiEditOperation, editor: Editor, widgetPos: number): number {
    const anchor = op.position || op.from;
    if (!anchor) return widgetPos;

    const state = editor.state;

    switch (anchor.type) {
      case 'absolute':
        return anchor.pos;

      case 'relative':
        switch (anchor.anchor) {
          case 'widget':
            return widgetPos + anchor.offset;
          case 'start':
            return anchor.offset;
          case 'end':
            return state.doc.content.size + anchor.offset;
          default:
            return widgetPos;
        }

      case 'search':
        return this.findTextPosition(state.doc, anchor.query, anchor.occurrence);

      default:
        return widgetPos;
    }
  }

  /**
   * Resolve 'from' position for an operation
   */
  private resolveOperationFrom(op: AiEditOperation, state: any, widgetPos: number): number {
    if (op.from) {
      return this.resolveAnchorPosition(op.from, state, widgetPos);
    }
    if (op.position) {
      return this.resolveAnchorPosition(op.position, state, widgetPos);
    }
    return widgetPos;
  }

  /**
   * Resolve 'to' position for an operation
   */
  private resolveOperationTo(op: AiEditOperation, state: any, widgetPos: number): number {
    if (op.to) {
      return this.resolveAnchorPosition(op.to, state, widgetPos);
    }
    return this.resolveOperationFrom(op, state, widgetPos);
  }

  /**
   * Resolve an anchor position
   */
  private resolveAnchorPosition(anchor: AnchorPosition, state: any, widgetPos: number): number {
    switch (anchor.type) {
      case 'absolute':
        return anchor.pos;

      case 'relative':
        switch (anchor.anchor) {
          case 'widget':
            return widgetPos + anchor.offset;
          case 'start':
            return anchor.offset;
          case 'end':
            return state.doc.content.size + anchor.offset;
          default:
            return widgetPos;
        }

      case 'search':
        return this.findTextPosition(state.doc, anchor.query, anchor.occurrence);

      default:
        return widgetPos;
    }
  }

  /**
   * Find the position of text in the document
   */
  private findTextPosition(doc: any, query: string, occurrence: number = 1): number {
    let count = 0;
    let foundPos = 0;

    doc.descendants((node: any, pos: number) => {
      if (node.isText) {
        const text = node.text || '';
        let index = 0;
        while (true) {
          const found = text.indexOf(query, index);
          if (found === -1) break;
          count++;
          if (count === occurrence) {
            foundPos = pos + found;
            return false;
          }
          index = found + 1;
        }
      }
      return true;
    });

    return foundPos;
  }
}
