import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../../services/notification.service';
import {
  NotificationItemComponent,
  NotificationFiltersComponent,
  type NotificationFilters,
} from '../../molecules';
import type { Notification } from '@maple/shared';

@Component({
  selector: 'app-notification-list',
  standalone: true,
  imports: [CommonModule, NotificationItemComponent, NotificationFiltersComponent],
  templateUrl: './notification-list.component.html',
  styleUrl: './notification-list.component.scss',
})
export class NotificationListComponent {
  private readonly notificationService = inject(NotificationService);

  readonly notifications = this.notificationService.notifications;
  readonly isLoading = signal(false);
  readonly filters = signal<NotificationFilters>({
    type: null,
    showUnreadOnly: false,
  });

  readonly filteredNotifications = computed(() => {
    const notifications = this.notifications();
    const { type, showUnreadOnly } = this.filters();

    return notifications.filter((n) => {
      if (type && n.type !== type) return false;
      if (showUnreadOnly && n.read) return false;
      return true;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.loadNotifications();
  }

  async loadNotifications(): Promise<void> {
    this.isLoading.set(true);
    try {
      await this.notificationService.fetchNotifications();
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  onFiltersChanged(filters: NotificationFilters): void {
    this.filters.set(filters);
  }

  async onNotificationClicked(notification: Notification): Promise<void> {
    // Navigate based on notification type
    // This will be handled in the page component
  }

  async onMarkAsRead(id: string): Promise<void> {
    try {
      await this.notificationService.markAsRead(id);
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }
}
