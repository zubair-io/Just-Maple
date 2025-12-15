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

  setChatInputFocused(focused: boolean): void {
    this.chatInputFocused.set(focused);
  }

  openScanner(): void {
    this.showScanner.set(true);
  }

  closeScanner(): void {
    this.showScanner.set(false);
  }
}
