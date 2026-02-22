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
import { firstValueFrom } from 'rxjs';
import { AIWritingService } from '../../../services/ai-writing.service';
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

/**
 * History entry for tracking prompts and results
 */
export interface HistoryEntry {
  prompt: string;
  result: {
    appliedCount: number;
    responseText?: string;
    error?: string;
  };
  timestamp: number;
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
  private readonly aiWritingService = inject(AIWritingService);

  @ViewChild('promptInput') promptInputRef?: ElementRef<HTMLInputElement>;

  readonly widgetId = input.required<string>();
  readonly editor = input.required<Editor>();
  readonly getPos = input.required<() => number | undefined>();
  readonly notebookId = input.required<string>();
  readonly pageId = input.required<string>();
  readonly initialPrompt = input<string>('');
  readonly initialStatus = input<AiBotWidgetStatus>('idle');
  readonly initialHistory = input<HistoryEntry[]>([]);

  readonly deleteRequested = output<string>();

  // Local state
  readonly prompt = signal('');
  readonly status = signal<AiBotWidgetStatus>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly responseText = signal<string | null>(null);
  readonly operationsApplied = signal<number>(0);
  readonly history = signal<HistoryEntry[]>([]);
  readonly historyExpanded = signal(false);

  ngAfterViewInit(): void {
    // Initialize from inputs
    this.prompt.set(this.initialPrompt());
    this.status.set(this.initialStatus());
    this.history.set(this.initialHistory() || []);

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
      // Get IDs from inputs
      const notebookId = this.notebookId();
      const pageId = this.pageId();

      // Call API - server fetches document and applies edits directly to Y.js
      const response = await firstValueFrom(
        this.aiWritingService.aiEdit(notebookId, {
          prompt: promptText,
          pageId,
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

      // Add to history
      const historyEntry: HistoryEntry = {
        prompt: promptText,
        result: {
          appliedCount: response.appliedCount,
          responseText: response.responseText,
          error: response.errors?.join(', '),
        },
        timestamp: Date.now(),
      };
      const newHistory = [...this.history(), historyEntry];
      this.history.set(newHistory);

      // Update widget attrs to persist history
      this.updateWidgetAttrs(newHistory);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute AI prompt';
      this.errorMessage.set(message);
      this.status.set('error');

      // Add failed attempt to history
      const historyEntry: HistoryEntry = {
        prompt: promptText,
        result: {
          appliedCount: 0,
          error: message,
        },
        timestamp: Date.now(),
      };
      const newHistory = [...this.history(), historyEntry];
      this.history.set(newHistory);

      // Update widget attrs to persist history
      this.updateWidgetAttrs(newHistory);
    }
  }

  /**
   * Toggle history panel visibility
   */
  toggleHistory(): void {
    this.historyExpanded.set(!this.historyExpanded());
  }

  /**
   * Update the widget node attrs to persist history
   */
  private updateWidgetAttrs(history: HistoryEntry[]): void {
    const editor = this.editor();
    const widgetId = this.widgetId();

    // Use the editor command to update widget attrs
    (editor.commands as any).updateAiBotWidget(widgetId, { history });
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
}
