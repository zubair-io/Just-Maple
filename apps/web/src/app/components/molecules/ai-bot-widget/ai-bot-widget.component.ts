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
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
import { marked } from 'marked';

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

  @ViewChild('promptInput') promptInputRef?: ElementRef<HTMLInputElement>;

  readonly widgetId = input.required<string>();
  readonly editor = input.required<Editor>();
  readonly getPos = input.required<() => number | undefined>();
  readonly notebookId = input.required<string>();
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
      // Get document content
      const documentContent = this.getDocumentContent(editor);

      // Get notebook ID from input
      const notebookId = this.notebookId();

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

      // Store response text if any
      if (response.responseText) {
        this.responseText.set(response.responseText);
      }

      // Apply operations if any
      if (response.operations && response.operations.length > 0) {
        const appliedCount = this.applyOperations(editor, response.operations);
        this.operationsApplied.set(appliedCount);
      }

      this.status.set('success');

      // Don't auto-remove - let user see the response and dismiss manually
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
   * Returns the number of operations successfully applied
   */
  private applyOperations(editor: Editor, operations: AiEditOperation[]): number {
    let appliedCount = 0;

    for (const op of operations) {
      try {
        // Skip operations with very short search queries (likely AI errors)
        if (op.from?.type === 'search' && op.from.query.length < 5) {
          console.warn('Skipping operation with too-short search query:', op.from.query);
          continue;
        }

        if (op.type === 'replace' && op.from?.type === 'search' && op.content) {
          // For search-based replace, use find and replace approach
          const searchQuery = op.from.query;
          const occurrence = op.from.occurrence || 1;

          if (this.findAndReplace(editor, searchQuery, op.content, occurrence)) {
            appliedCount++;
          }
        } else if (op.type === 'delete' && op.from?.type === 'search') {
          // For search-based delete, find and delete
          const searchQuery = op.from.query;
          const occurrence = op.from.occurrence || 1;

          if (this.findAndDelete(editor, searchQuery, occurrence)) {
            appliedCount++;
          }
        } else if (op.type === 'insert' && op.content) {
          // For insert, find position and insert
          const widgetPos = this.getPos()() || 0;
          const pos = this.resolvePosition(op.position, editor, widgetPos);

          if (pos > 0) {
            // Convert markdown to HTML for proper formatting
            const htmlContent = this.markdownToHtml(op.content);
            editor
              .chain()
              .focus()
              .insertContentAt(pos, htmlContent, {
                parseOptions: { preserveWhitespace: false },
              })
              .run();
            appliedCount++;
          }
        }
      } catch (e) {
        console.error('Failed to apply operation:', op, e);
      }
    }

    return appliedCount;
  }

  /**
   * Strip markdown formatting from search text
   * The AI sees markdown but doc.textContent doesn't include formatting chars
   * Also removes newlines since doc.textContent concatenates without separators
   */
  private stripMarkdownForSearch(text: string): string {
    return (
      text
        // Remove heading prefixes: # ## ### etc
        .replace(/^#{1,6}\s+/gm, '')
        // Remove blockquote prefix: >
        .replace(/^>\s*/gm, '')
        // Remove list prefixes: - * 1.
        .replace(/^[-*]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        // Remove bold/italic markers but keep the text
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove inline code backticks
        .replace(/`([^`]+)`/g, '$1')
        // Remove link syntax, keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove horizontal rules
        .replace(/^---+$/gm, '')
        // IMPORTANT: doc.textContent doesn't include newlines between paragraphs
        // Replace newlines with empty string to match how textContent works
        .replace(/\n+/g, '')
        .trim()
    );
  }

  /**
   * Find text in the document and replace it
   */
  private findAndReplace(
    editor: Editor,
    searchText: string,
    replaceText: string,
    occurrence: number = 1,
  ): boolean {
    const { state } = editor;
    const { doc } = state;

    // Strip markdown from search text since doc.textContent doesn't include formatting
    const normalizedSearch = this.stripMarkdownForSearch(searchText);

    // Search through the document for the text
    let foundFrom = -1;
    let foundTo = -1;

    // Get the full text content and search in it
    const fullText = doc.textContent;
    let searchIndex = 0;

    for (let i = 0; i < occurrence; i++) {
      const idx = fullText.indexOf(normalizedSearch, searchIndex);
      if (idx === -1) {
        return false;
      }
      if (i === occurrence - 1) {
        // This is the occurrence we want
        // Now we need to find the actual document positions
        const positions = this.textOffsetToDocPositions(doc, idx, idx + normalizedSearch.length);
        if (positions) {
          foundFrom = positions.from;
          foundTo = positions.to;
        }
      }
      searchIndex = idx + 1;
    }

    if (foundFrom >= 0 && foundTo >= 0) {
      // Convert markdown to HTML for proper formatting
      const htmlContent = this.markdownToHtml(replaceText);

      // Parse HTML into ProseMirror nodes
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      const parser = ProseMirrorDOMParser.fromSchema(editor.schema);
      const parsed = parser.parse(tempDiv);
      const fragment = parsed.content;

      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.replaceWith(foundFrom, foundTo, fragment);
          return true;
        })
        .run();
      return true;
    }

    return false;
  }

  /**
   * Find text in the document and delete it
   */
  private findAndDelete(editor: Editor, searchText: string, occurrence: number = 1): boolean {
    const { state } = editor;
    const { doc } = state;

    // Strip markdown from search text since doc.textContent doesn't include formatting
    const normalizedSearch = this.stripMarkdownForSearch(searchText);

    // Get the full text content and search in it
    const fullText = doc.textContent;
    let searchIndex = 0;
    let foundFrom = -1;
    let foundTo = -1;

    for (let i = 0; i < occurrence; i++) {
      const idx = fullText.indexOf(normalizedSearch, searchIndex);
      if (idx === -1) {
        return false;
      }
      if (i === occurrence - 1) {
        const positions = this.textOffsetToDocPositions(doc, idx, idx + normalizedSearch.length);
        if (positions) {
          foundFrom = positions.from;
          foundTo = positions.to;
        }
      }
      searchIndex = idx + 1;
    }

    if (foundFrom >= 0 && foundTo >= 0) {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.delete(foundFrom, foundTo);
          return true;
        })
        .run();
      return true;
    }

    return false;
  }

  /**
   * Convert text content offset to document positions
   * This accounts for ProseMirror's node structure
   */
  private textOffsetToDocPositions(
    doc: any,
    textFrom: number,
    textTo: number,
  ): { from: number; to: number } | null {
    let currentTextOffset = 0;
    let docFrom = -1;
    let docTo = -1;

    doc.descendants((node: any, pos: number) => {
      if (docFrom >= 0 && docTo >= 0) {
        return false; // Already found both
      }

      if (node.isText) {
        const text = node.text || '';
        const nodeStart = currentTextOffset;
        const nodeEnd = currentTextOffset + text.length;

        // Check if textFrom is in this node
        if (docFrom < 0 && textFrom >= nodeStart && textFrom < nodeEnd) {
          docFrom = pos + (textFrom - nodeStart);
        }

        // Check if textTo is in this node
        if (docTo < 0 && textTo > nodeStart && textTo <= nodeEnd) {
          docTo = pos + (textTo - nodeStart);
        }

        currentTextOffset += text.length;
      }

      return true;
    });

    if (docFrom >= 0 && docTo >= 0) {
      return { from: docFrom, to: docTo };
    }

    return null;
  }

  /**
   * Resolve position from anchor
   */
  private resolvePosition(
    anchor: AnchorPosition | undefined,
    editor: Editor,
    widgetPos: number,
  ): number {
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
        // For search-based positions, find the text
        // Strip markdown since doc.textContent doesn't include formatting chars
        const normalizedQuery = this.stripMarkdownForSearch(anchor.query);
        const fullText = state.doc.textContent;
        let searchIndex = 0;
        for (let i = 0; i < (anchor.occurrence || 1); i++) {
          const idx = fullText.indexOf(normalizedQuery, searchIndex);
          if (idx === -1) return widgetPos;
          if (i === (anchor.occurrence || 1) - 1) {
            const positions = this.textOffsetToDocPositions(state.doc, idx, idx);
            if (positions) return positions.from;
          }
          searchIndex = idx + 1;
        }
        return widgetPos;

      default:
        return widgetPos;
    }
  }

  /**
   * Convert markdown to HTML using marked parser
   * Configured with URL sanitization to prevent XSS
   */
  private markdownToHtml(markdown: string): string {
    // Configure marked options
    marked.use({
      breaks: true, // Convert \n to <br>
      gfm: true, // GitHub Flavored Markdown
    });

    // Parse markdown to HTML synchronously
    const html = marked.parse(markdown, { async: false });

    if (typeof html !== 'string') {
      return '';
    }

    // Post-process to sanitize links (remove javascript:, data:, etc.)
    return this.sanitizeHtmlLinks(html);
  }

  /**
   * Sanitize links in HTML to prevent XSS attacks
   */
  private sanitizeHtmlLinks(html: string): string {
    // Match href attributes and sanitize the URLs
    return html.replace(/href="([^"]*)"/g, (_match, url) => {
      const sanitizedUrl = this.sanitizeUrl(url);
      if (sanitizedUrl) {
        return `href="${sanitizedUrl}"`;
      }
      // Remove the href entirely if unsafe
      return 'href="#"';
    });
  }

  /**
   * Sanitize URL to prevent XSS attacks
   * Only allows http, https, and mailto protocols
   */
  private sanitizeUrl(url: string): string | null {
    const trimmed = url.trim().toLowerCase();

    // Only allow safe protocols
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('/') || // relative URLs
      trimmed.startsWith('#') // anchor links
    ) {
      return url;
    }

    // Block javascript:, data:, vbscript:, and other dangerous protocols
    return null;
  }
}
