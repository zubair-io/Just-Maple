import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './notification-list.component.scss',
})
export class NotificationListComponent {
  private readonly notificationService = inject(NotificationService);

  readonly notifications = this.notificationService.notifications;
  readonly unreadCount = this.notificationService.unreadNotificationCount;
  readonly isLoading = signal(false);
  readonly isMarkingAll = signal(false);
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

  ngOnInit(): void {
    this.loadNotifications();
  }

  loadNotifications(): void {
    this.isLoading.set(true);
    this.notificationService.fetchNotifications().subscribe({
      next: () => {
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load notifications:', error);
        this.isLoading.set(false);
      },
    });
  }

  onFiltersChanged(filters: NotificationFilters): void {
    this.filters.set(filters);
  }

  onNotificationClicked(notification: Notification): void {
    // Navigate based on notification type
    // This will be handled in the page component
  }

  onMarkAllAsRead(): void {
    this.isMarkingAll.set(true);
    this.notificationService.markAllAsRead().subscribe({
      next: () => this.isMarkingAll.set(false),
      error: (error) => {
        console.error('Failed to mark all notifications as read:', error);
        this.isMarkingAll.set(false);
      },
    });
  }

  onMarkAsRead(id: string): void {
    this.notificationService.markAsRead(id).subscribe({
      error: (error) => {
        console.error('Failed to mark notification as read:', error);
      },
    });
  }
}
