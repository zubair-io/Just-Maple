import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type DividerSpacing = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-divider',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './divider.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './divider.component.scss',
})
export class HrDividerComponent {
  readonly spacing = input<DividerSpacing>('md');

  get dividerClasses(): string {
    const spacingMap: Record<DividerSpacing, string> = {
      sm: 'my-1',
      md: 'my-3',
      lg: 'my-5',
    };
    return `border-t border-[var(--color-border)] ${spacingMap[this.spacing()]}`;
  }
}
