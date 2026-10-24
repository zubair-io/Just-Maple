import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Template } from '@maple/shared';

@Component({
  selector: 'app-template-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './template-card.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './template-card.component.scss',
})
export class TemplateCardComponent {
  readonly template = input.required<Template>();
  readonly isApplying = input(false);
  readonly showDelete = input(false);

  readonly apply = output<void>();
  readonly delete = output<void>();

  getCategoryClasses(): string {
    const category = this.template().category;
    switch (category) {
      case 'work':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'personal':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'planning':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'custom':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  }

  onApply(event: Event): void {
    event.stopPropagation();
    if (!this.isApplying()) {
      this.apply.emit();
    }
  }

  onDelete(event: Event): void {
    event.stopPropagation();
    this.delete.emit();
  }
}
