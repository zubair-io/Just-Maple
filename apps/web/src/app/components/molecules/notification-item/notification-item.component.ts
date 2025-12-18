import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Notification } from '@maple/shared';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-item.component.html',
  styleUrl: './notification-item.component.scss',
})
export class NotificationItemComponent {
  readonly notification = input.required<Notification>();
  readonly clicked = output<Notification>();
  readonly markAsRead = output<string>();

  onClick(): void {
    this.clicked.emit(this.notification());
  }

  onMarkAsRead(event: Event): void {
    event.stopPropagation();
    this.markAsRead.emit(this.notification()._id);
  }

  getRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  getNotificationIcon(type: string): string {
    switch (type) {
      case 'share_received':
        return '🔗';
      case 'message_received':
        return '💬';
      case 'transcription_complete':
        return '✅';
      case 'reminder':
        return '⏰';
      case 'export_ready':
        return '📦';
      case 'processing_failed':
        return '❌';
      default:
        return '🔔';
    }
  }
}
