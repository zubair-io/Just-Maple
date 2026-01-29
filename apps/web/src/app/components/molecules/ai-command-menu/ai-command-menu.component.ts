import {
  Component,
  input,
  output,
  signal,
  ChangeDetectionStrategy,
  HostListener,
  ElementRef,
  inject,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type { AIWritingType } from '@maple/shared';

export interface AICommandItem {
  type: AIWritingType;
  title: string;
  description: string;
  icon: string;
  requiresSelection: boolean;
}

export interface AICommandMenuPosition {
  top: number;
  left: number;
}

const AI_COMMANDS: AICommandItem[] = [
  {
    type: 'continue',
    title: 'Continue Writing',
    description: 'AI continues writing from cursor',
    icon: '...',
    requiresSelection: false,
  },
  {
    type: 'improve',
    title: 'Improve',
    description: 'Improve clarity and readability',
    icon: '+++',
    requiresSelection: true,
  },
  {
    type: 'simplify',
    title: 'Simplify',
    description: 'Make text easier to understand',
    icon: '---',
    requiresSelection: true,
  },
  {
    type: 'expand',
    title: 'Expand',
    description: 'Add more detail',
    icon: '>>>',
    requiresSelection: true,
  },
  {
    type: 'shorten',
    title: 'Shorten',
    description: 'Make more concise',
    icon: '<<<',
    requiresSelection: true,
  },
  {
    type: 'summarize',
    title: 'Summarize',
    description: 'Generate a summary',
    icon: '*',
    requiresSelection: false,
  },
  {
    type: 'grammar',
    title: 'Fix Grammar',
    description: 'Fix spelling and grammar',
    icon: 'abc',
    requiresSelection: true,
  },
  {
    type: 'translate',
    title: 'Translate',
    description: 'Translate to another language',
    icon: 'A>B',
    requiresSelection: true,
  },
  {
    type: 'custom',
    title: 'Custom Prompt',
    description: 'Give custom instructions',
    icon: '?',
    requiresSelection: false,
  },
];

@Component({
  selector: 'app-ai-command-menu',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-command-menu.component.html',
  styleUrl: './ai-command-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AICommandMenuComponent implements AfterViewInit {
  private readonly elementRef = inject(ElementRef);

  // Inputs
  readonly position = input.required<AICommandMenuPosition>();
  readonly hasSelection = input<boolean>(false);

  // Outputs
  readonly commandSelected = output<{
    type: AIWritingType;
    instruction?: string;
    targetLanguage?: string;
  }>();
  readonly closed = output<void>();

  // Local state
  readonly selectedIndex = signal(0);
  readonly showCustomPrompt = signal(false);
  readonly showLanguageSelect = signal(false);
  readonly customInstruction = signal('');
  readonly targetLanguage = signal('Spanish');

  readonly languages = [
    'Spanish',
    'French',
    'German',
    'Italian',
    'Portuguese',
    'Chinese',
    'Japanese',
    'Korean',
    'Russian',
    'Arabic',
  ];

  get filteredCommands(): AICommandItem[] {
    const hasSelection = this.hasSelection();
    return AI_COMMANDS.filter((cmd) => !cmd.requiresSelection || hasSelection);
  }

  ngAfterViewInit(): void {
    // Focus the menu for keyboard navigation
    setTimeout(() => {
      this.elementRef.nativeElement.querySelector('.ai-command-menu')?.focus();
    }, 0);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (this.showCustomPrompt() || this.showLanguageSelect()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.showCustomPrompt.set(false);
        this.showLanguageSelect.set(false);
      } else if (event.key === 'Enter' && this.showCustomPrompt()) {
        event.preventDefault();
        this.submitCustomPrompt();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedIndex.update((i) => Math.min(i + 1, this.filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedIndex.update((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        this.selectCommand(this.filteredCommands[this.selectedIndex()]);
        break;
      case 'Escape':
        event.preventDefault();
        this.closed.emit();
        break;
    }
  }

  selectCommand(command: AICommandItem): void {
    if (command.type === 'custom') {
      this.showCustomPrompt.set(true);
      return;
    }

    if (command.type === 'translate') {
      this.showLanguageSelect.set(true);
      return;
    }

    this.commandSelected.emit({ type: command.type });
  }

  submitCustomPrompt(): void {
    const instruction = this.customInstruction().trim();
    if (instruction) {
      this.commandSelected.emit({
        type: 'custom',
        instruction,
      });
    }
  }

  selectLanguage(language: string): void {
    this.commandSelected.emit({
      type: 'translate',
      targetLanguage: language,
    });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  trackByType(index: number, command: AICommandItem): string {
    return command.type;
  }
}
