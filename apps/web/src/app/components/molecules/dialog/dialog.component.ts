import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService } from './dialog.service';

@Component({
  selector: 'app-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
})
export class DialogComponent {
  readonly dialogService = inject(DialogService);
  readonly inputValue = signal('');

  constructor() {
    effect(() => {
      const dialog = this.dialogService.activeDialog();
      if (dialog?.type === 'prompt') {
        this.inputValue.set(dialog.defaultValue ?? '');
      }
    });
  }

  onConfirm(): void {
    const dialog = this.dialogService.activeDialog();
    if (!dialog) return;

    switch (dialog.type) {
      case 'confirm':
        this.dialogService._close(true);
        break;
      case 'prompt':
        this.dialogService._close(this.inputValue() || null);
        break;
      case 'alert':
        this.dialogService._close(undefined);
        break;
    }
  }

  onCancel(): void {
    const dialog = this.dialogService.activeDialog();
    if (!dialog) return;

    switch (dialog.type) {
      case 'confirm':
        this.dialogService._close(false);
        break;
      case 'prompt':
        this.dialogService._close(null);
        break;
      case 'alert':
        this.dialogService._close(undefined);
        break;
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onCancel();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.onCancel();
    } else if (event.key === 'Enter') {
      this.onConfirm();
    }
  }
}
