import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ActiveUser {
  name: string;
  color: string;
  userId?: string;
}

@Component({
  selector: 'app-active-users-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './active-users-list.component.html',
  styleUrl: './active-users-list.component.scss',
})
export class ActiveUsersListComponent {
  readonly users = input<ActiveUser[]>([]);
  readonly maxVisible = input<number>(5);

  readonly visibleUsers = computed(() => {
    const users = this.users();
    const max = this.maxVisible();
    return users.slice(0, max);
  });

  readonly remainingCount = computed(() => {
    const users = this.users();
    const max = this.maxVisible();
    return Math.max(0, users.length - max);
  });

  getInitials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
}
