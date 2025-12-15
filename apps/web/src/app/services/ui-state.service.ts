import { Injectable, signal } from '@angular/core';

/**
 * Simple service for UI state that needs to be shared across components.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  /** Signal indicating if a chat/message input is focused */
  readonly chatInputFocused = signal(false);

  setChatInputFocused(focused: boolean): void {
    this.chatInputFocused.set(focused);
  }
}
