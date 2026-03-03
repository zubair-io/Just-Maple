import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type StatSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-stat',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stat.component.html',
  styleUrl: './stat.component.scss',
})
export class StatComponent {
  readonly value = input<string>('');
  readonly label = input<string>('');
  readonly size = input<StatSize>('md');

  get valueClasses(): string {
    const sizeMap: Record<StatSize, string> = {
      sm: 'text-xl',
      md: 'text-3xl',
      lg: 'text-5xl',
    };
    return `${sizeMap[this.size()]} font-bold text-[var(--color-text-main)]`;
  }
}
