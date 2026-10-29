import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TimestampFormat = 'relative' | 'date' | 'time' | 'datetime';

@Component({
  selector: 'app-timestamp',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './timestamp.component.html',
  styleUrl: './timestamp.component.scss',
})
export class TimestampComponent {
  readonly value = input<string>('');
  readonly format = input<TimestampFormat>('datetime');

  readonly formatted = computed(() => {
    const val = this.value();
    if (!val) return '';
    const date = new Date(val);
    if (isNaN(date.getTime())) return val;

    switch (this.format()) {
      case 'relative':
        return this.getRelativeTime(date);
      case 'date':
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      case 'time':
        return date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        });
      case 'datetime':
      default:
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
    }
  });

  private getRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
