import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationListComponent } from '../../components/organisms/notification-list/notification-list.component';
import { NotificationService } from '../../services/notification.service';
import type { Notification } from '@maple/shared';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, NotificationListComponent],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent {
  private readonly router = inject(Router);
  private readonly notificationService = inject(NotificationService);

  onNotificationClicked(notification: Notification): void {
    // Navigate based on notification type
    switch (notification.type) {
      case 'share_received':
      case 'message_received':
        if (notification.data['tagId']) {
          this.router.navigate(['/', notification.data['tagId']]);
        }
        break;

      case 'transcription_complete':
      case 'reminder':
        if (notification.data['memoId']) {
          const tagId = notification.data['tagId'];
          const memoId = notification.data['memoId'];
          if (tagId && memoId) {
            this.router.navigate(['/', tagId, memoId]);
          }
        }
        break;

      case 'export_ready':
        console.log('Export ready:', notification.data['exportId']);
        break;

      case 'processing_failed':
        console.error('Processing failed:', notification.data['errorCode']);
        break;
    }

    // Mark as read after navigation
    if (!notification.read) {
      this.notificationService.markAsRead(notification._id).catch(console.error);
    }
  }
}
