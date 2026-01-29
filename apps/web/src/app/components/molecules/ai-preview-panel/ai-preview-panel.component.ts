import {
  Component,
  input,
  output,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AIWritingService, type AIStreamEvent } from '../../../services/ai-writing.service';
import type { AIWritingType } from '@maple/shared';
import { Subscription } from 'rxjs';

export interface AIPreviewPosition {
  top: number;
  left: number;
}

@Component({
  selector: 'app-ai-preview-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-preview-panel.component.html',
  styleUrl: './ai-preview-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AIPreviewPanelComponent implements AfterViewInit, OnDestroy {
  private readonly aiWritingService = inject(AIWritingService);

  @ViewChild('panel') panelRef!: ElementRef<HTMLDivElement>;

  // Inputs
  readonly notebookId = input.required<string>();
  readonly position = input.required<AIPreviewPosition>();
  readonly actionType = input.required<AIWritingType>();
  readonly selection = input<string>('');
  readonly context = input<string>('');
  readonly instruction = input<string>('');
  readonly targetLanguage = input<string>('');

  // Outputs
  readonly accepted = output<string>();
  readonly rejected = output<void>();
  readonly closed = output<void>();

  // Local state
  readonly generatedText = signal('');
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly isDone = signal(false);

  // Computed
  readonly hasContent = computed(() => this.generatedText().length > 0);
  readonly canAccept = computed(() => this.hasContent() && !this.isLoading());

  private subscription: Subscription | null = null;

  ngAfterViewInit(): void {
    this.startGeneration();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.aiWritingService.cancel();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onReject();
    } else if (event.key === 'Enter' && !event.shiftKey && this.canAccept()) {
      event.preventDefault();
      this.onAccept();
    }
  }

  private startGeneration(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.generatedText.set('');
    this.isDone.set(false);

    this.subscription = this.aiWritingService
      .generate(this.notebookId(), {
        type: this.actionType(),
        selection: this.selection(),
        context: this.context(),
        instruction: this.instruction(),
        targetLanguage: this.targetLanguage(),
      })
      .subscribe({
        next: (event: AIStreamEvent) => {
          if (event.type === 'token' && event.text) {
            this.generatedText.update((t) => t + event.text);
          } else if (event.type === 'done') {
            this.isLoading.set(false);
            this.isDone.set(true);
          } else if (event.type === 'error') {
            this.isLoading.set(false);
            this.error.set(event.error || 'An error occurred');
          }
        },
        complete: () => {
          this.isLoading.set(false);
        },
        error: (err) => {
          this.isLoading.set(false);
          this.error.set(err.message || 'An error occurred');
        },
      });
  }

  onAccept(): void {
    if (this.canAccept()) {
      this.accepted.emit(this.generatedText());
    }
  }

  onReject(): void {
    this.aiWritingService.cancel();
    this.rejected.emit();
    this.closed.emit();
  }

  onCancel(): void {
    this.aiWritingService.cancel();
    this.isLoading.set(false);
  }

  onRetry(): void {
    this.startGeneration();
  }

  onCopy(): void {
    navigator.clipboard.writeText(this.generatedText());
  }

  getActionLabel(): string {
    const labels: Record<AIWritingType, string> = {
      continue: 'Continue Writing',
      improve: 'Improve Text',
      simplify: 'Simplify Text',
      expand: 'Expand Text',
      shorten: 'Shorten Text',
      summarize: 'Summarize',
      grammar: 'Fix Grammar',
      translate: 'Translate',
      custom: 'AI Assistant',
    };
    return labels[this.actionType()] || 'AI Assistant';
  }
}
