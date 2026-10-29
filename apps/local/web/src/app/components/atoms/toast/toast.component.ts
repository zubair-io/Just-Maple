import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ToastData {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
})
export class ToastComponent {
  readonly toast = input.required<ToastData>();
  readonly closed = output<string>();

  close(): void {
    this.closed.emit(this.toast().id);
  }
}
