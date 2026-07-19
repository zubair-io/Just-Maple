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
        return 'share';
      case 'message_received':
        return 'chat_bubble';
      case 'transcription_complete':
        return 'check_circle';
      case 'reminder':
        return 'alarm';
      case 'export_ready':
        return 'download';
      case 'processing_failed':
        return 'error';
      default:
        return 'notifications';
    }
  }

  getNotificationTitle(): string {
    const notif = this.notification();
    switch (notif.type) {
      case 'message_received':
        // Show sender name, fallback to email
        return notif.data['senderName'] || notif.data['senderEmail'] || 'New Message';

      case 'share_received':
        return 'New Share';

      case 'transcription_complete':
        return 'Transcription Ready';

      case 'reminder':
        return 'Reminder';

      case 'export_ready':
        return 'Export Ready';

      case 'processing_failed':
        return 'Processing Failed';

      default:
        return 'Notification';
    }
  }

  getNotificationBody(): string {
    const notif = this.notification();
    switch (notif.type) {
      case 'message_received':
        // Show actual message content
        return notif.data['messagePreview'] || 'New message';

      case 'share_received':
        return notif.data['sharedBy']
          ? `Shared by ${notif.data['sharedBy']}`
          : 'Someone shared a note with you';

      case 'transcription_complete':
        return 'Your audio transcription is complete';

      case 'reminder':
        return 'You have a reminder';

      case 'export_ready':
        return 'Your export is ready for download';

      case 'processing_failed':
        return notif.data['errorCode']
          ? `Error: ${notif.data['errorCode']}`
          : 'An error occurred while processing';

      default:
        return 'You have a new notification';
    }
  }
}
