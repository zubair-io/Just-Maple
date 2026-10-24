import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ProgressVariant = 'bar' | 'ring';

@Component({
  selector: 'app-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './progress.component.scss',
})
export class ProgressComponent {
  readonly value = input<number>(0);
  readonly max = input<number>(100);
  readonly variant = input<ProgressVariant>('bar');
  readonly color = input<string>('');

  readonly percentage = computed(() => {
    const max = this.max() || 100;
    return Math.min(100, Math.max(0, (this.value() / max) * 100));
  });

  readonly barColor = computed(() => {
    return this.color() || 'var(--color-primary)';
  });

  // SVG ring properties
  readonly ringRadius = 40;
  readonly ringCircumference = computed(() => 2 * Math.PI * this.ringRadius);
  readonly ringOffset = computed(() => {
    return this.ringCircumference() - (this.percentage() / 100) * this.ringCircumference();
  });
}
