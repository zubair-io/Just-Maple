import { Injectable, signal } from '@angular/core';
import type { ToastData } from '../components/atoms/toast/toast.component';
import { generateUUID } from '../utils/uuid';

export interface ShowToastOptions {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<ToastData[]>([]);
  readonly toasts = this._toasts.asReadonly();

  showToast(options: ShowToastOptions): void {
    const id = generateUUID();
    const toast: ToastData = {
      id,
      title: options.title,
      message: options.message,
      type: options.type,
      duration: options.duration ?? 5000,
    };

    this._toasts.update((list) => [...list, toast]);

    // Auto-remove after duration
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => this.removeToast(id), toast.duration);
    }
  }

  removeToast(id: string): void {
    this._toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
