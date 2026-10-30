import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ListSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './list.component.html',
  styleUrl: './list.component.scss',
})
export class ListComponent {
  readonly items = input<string[]>([]);
  readonly ordered = input<boolean>(false);
  readonly size = input<ListSize>('md');

  get listClasses(): string {
    const sizeMap: Record<ListSize, string> = {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
    };
    return `${sizeMap[this.size()]} text-[var(--color-text-main)] pl-5`;
  }
}
