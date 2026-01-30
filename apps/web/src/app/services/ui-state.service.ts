import { Injectable, signal } from '@angular/core';

/**
 * Simple service for UI state that needs to be shared across components.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  /** Signal indicating if a chat/message input is focused */
  readonly chatInputFocused = signal(false);

  /** Signal to trigger barcode scanner from footer */
  readonly showScanner = signal(false);

  /** Signal for sidebar open state (mobile) */
  readonly sidebarOpen = signal(false);

  /** Signal to show template gallery modal */
  readonly showTemplateGallery = signal(false);

  /** Signal to show search modal */
  readonly showSearchModal = signal(false);

  setChatInputFocused(focused: boolean): void {
    this.chatInputFocused.set(focused);
  }

  openScanner(): void {
    this.showScanner.set(true);
  }

  closeScanner(): void {
    this.showScanner.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  openSidebar(): void {
    this.sidebarOpen.set(true);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  openTemplateGallery(): void {
    this.showTemplateGallery.set(true);
  }

  closeTemplateGallery(): void {
    this.showTemplateGallery.set(false);
  }

  openSearchModal(): void {
    this.showSearchModal.set(true);
  }

  closeSearchModal(): void {
    this.showSearchModal.set(false);
  }
}
