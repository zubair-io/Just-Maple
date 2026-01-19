import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileAvatarComponent } from '../profile-avatar/profile-avatar.component';

export interface ToastData {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  // Optional avatar fields for message notifications
  avatarEmail?: string;
  avatarDisplayName?: string;
  avatarUrl?: string;
}

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule, ProfileAvatarComponent],
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
