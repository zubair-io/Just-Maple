import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastComponent, type ToastData } from '../../atoms/toast/toast.component';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule, ToastComponent],
  templateUrl: './toast-container.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './toast-container.component.scss',
})
export class ToastContainerComponent {
  private readonly notificationService = inject(NotificationService);
  readonly toasts = this.notificationService.toasts;

  onToastClosed(id: string): void {
    this.notificationService.removeToast(id);
  }
}
