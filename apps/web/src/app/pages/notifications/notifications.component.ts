import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NotificationListComponent } from '../../components/organisms/notification-list/notification-list.component';
import { NotificationService } from '../../services/notification.service';
import { SettingsHeaderComponent } from '../../components';
import type { Notification } from '@maple/shared';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, NotificationListComponent, SettingsHeaderComponent],
  templateUrl: './notifications.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent {
  private readonly router = inject(Router);
  private readonly notificationService = inject(NotificationService);

  goBack(): void {
    this.router.navigate(['/']);
  }

  onNotificationClicked(notification: Notification): void {
    // Navigate based on notification type
    switch (notification.type) {
      case 'share_received':
      case 'message_received':
        if (notification.data['notebookId']) {
          this.router.navigate(['/', notification.data['notebookId']]);
        }
        break;

      case 'transcription_complete':
      case 'reminder':
        if (notification.data['memoId']) {
          const notebookId = notification.data['notebookId'];
          const memoId = notification.data['memoId'];
          if (notebookId && memoId) {
            this.router.navigate(['/', notebookId, memoId]);
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
      this.notificationService.markAsRead(notification._id).subscribe({
        error: console.error,
      });
    }
  }
}
