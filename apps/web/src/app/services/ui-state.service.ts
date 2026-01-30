import { Injectable, signal } from '@angular/core';

/**
 * Options for opening the search modal with pre-configured state
 */
export interface SearchModalOptions {
  /** Initial search query */
  query?: string;
  /** Filter by tag name */
  tag?: string;
  /** Filter by notebook ID */
  notebookId?: string;
}

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

  /** Signal for search modal initial options */
  readonly searchModalOptions = signal<SearchModalOptions | null>(null);

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

  openSearchModal(options?: SearchModalOptions): void {
    this.searchModalOptions.set(options || null);
    this.showSearchModal.set(true);
  }

  closeSearchModal(): void {
    this.showSearchModal.set(false);
    this.searchModalOptions.set(null);
  }
}
