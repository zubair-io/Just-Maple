import { Injectable, signal } from '@angular/core';

export interface DialogConfig {
  type: 'confirm' | 'prompt' | 'alert';
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ActiveDialog extends DialogConfig {
  resolve: (value: any) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly activeDialog = signal<ActiveDialog | null>(null);

  /**
   * Show a confirmation dialog. Returns true if confirmed, false if cancelled.
   */
  confirm(options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.activeDialog.set({
        type: 'confirm',
        ...options,
        resolve,
      });
    });
  }

  /**
   * Show a prompt dialog. Returns the input string, or null if cancelled.
   */
  prompt(options: {
    title?: string;
    message: string;
    placeholder?: string;
    defaultValue?: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.activeDialog.set({
        type: 'prompt',
        ...options,
        resolve,
      });
    });
  }

  /**
   * Show an alert dialog. Resolves when user clicks OK.
   */
  alert(options: { title?: string; message: string; confirmLabel?: string }): Promise<void> {
    return new Promise<void>((resolve) => {
      this.activeDialog.set({
        type: 'alert',
        ...options,
        resolve,
      });
    });
  }

  /** @internal Called by the dialog component */
  _close(result: any): void {
    const dialog = this.activeDialog();
    if (dialog) {
      dialog.resolve(result);
      this.activeDialog.set(null);
    }
  }
}
