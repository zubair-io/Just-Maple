import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BadgeColor = 'red' | 'amber' | 'blue' | 'green' | 'gray';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './badge.component.html',
  styleUrl: './badge.component.scss',
})
export class BadgeComponent {
  readonly value = input<string>('');
  readonly color = input<BadgeColor>('gray');

  get badgeClasses(): string {
    const colorMap: Record<BadgeColor, string> = {
      red: 'bg-red-100 text-red-700',
      amber: 'bg-amber-100 text-amber-700',
      blue: 'bg-blue-100 text-blue-700',
      green: 'bg-green-100 text-green-700',
      gray: 'bg-gray-100 text-gray-700',
    };
    return `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorMap[this.color()]}`;
  }
}
