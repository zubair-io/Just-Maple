import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-canvas-prompt-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './canvas-prompt-bar.component.html',
  styleUrl: './canvas-prompt-bar.component.scss',
})
export class CanvasPromptBarComponent {
  readonly isGenerating = input(false);
  readonly promptSubmit = output<string>();

  readonly promptText = signal('');

  onSubmit(): void {
    const text = this.promptText().trim();
    if (!text || this.isGenerating()) return;
    this.promptSubmit.emit(text);
    this.promptText.set('');
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSubmit();
    }
  }

  onInput(event: Event): void {
    this.promptText.set((event.target as HTMLInputElement).value);
  }
}
