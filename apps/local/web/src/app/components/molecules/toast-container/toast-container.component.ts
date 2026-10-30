import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastComponent, type ToastData } from '../../atoms/toast/toast.component';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule, ToastComponent],
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.scss',
})
export class ToastContainerComponent {
  private readonly toastService = inject(ToastService);
  readonly toasts = this.toastService.toasts;

  onToastClosed(id: string): void {
    this.toastService.removeToast(id);
  }
}
