import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { DialogContentComponent } from './dialog.component';

export interface DialogConfig {
  type: 'confirm' | 'prompt' | 'alert';
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly cdkDialog = inject(Dialog);

  /**
   * Show a confirmation dialog. Returns true if confirmed, false if cancelled.
   */
  confirm(options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }): Promise<boolean> {
    const config: DialogConfig = { type: 'confirm', ...options };
    return this.open<boolean>(config, false);
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
    const config: DialogConfig = { type: 'prompt', ...options };
    return this.open<string | null>(config, null);
  }

  /**
   * Show an alert dialog. Resolves when user clicks OK.
   */
  alert(options: { title?: string; message: string; confirmLabel?: string }): Promise<void> {
    const config: DialogConfig = { type: 'alert', ...options };
    return this.open<void>(config, undefined);
  }

  private async open<T>(config: DialogConfig, defaultResult: T): Promise<T> {
    const dialogRef = this.cdkDialog.open<T>(DialogContentComponent, {
      data: config,
      hasBackdrop: true,
      backdropClass: 'cdk-dialog-backdrop',
      panelClass: 'cdk-dialog-panel',
      autoFocus: config.type === 'prompt' ? 'input' : 'first-tabbable',
    });

    const result = await firstValueFrom(dialogRef.closed);
    return result ?? defaultResult;
  }
}
