import { Injectable, signal } from '@angular/core';

/**
 * Simple service for UI state that needs to be shared across components.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  /** Signal for sidebar open state (mobile) */
  readonly sidebarOpen = signal(false);

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  openSidebar(): void {
    this.sidebarOpen.set(true);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
