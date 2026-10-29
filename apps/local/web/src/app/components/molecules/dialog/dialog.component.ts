import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import type { DialogConfig } from './dialog.service';

@Component({
  selector: 'app-dialog-content',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
})
export class DialogContentComponent {
  readonly dialogRef = inject(DialogRef);
  readonly config = inject<DialogConfig>(DIALOG_DATA);
  readonly inputValue = signal(this.config.defaultValue ?? '');

  onConfirm(): void {
    switch (this.config.type) {
      case 'confirm':
        this.dialogRef.close(true);
        break;
      case 'prompt':
        this.dialogRef.close(this.inputValue() || null);
        break;
      case 'alert':
        this.dialogRef.close(undefined);
        break;
    }
  }

  onCancel(): void {
    switch (this.config.type) {
      case 'confirm':
        this.dialogRef.close(false);
        break;
      case 'prompt':
        this.dialogRef.close(null);
        break;
      case 'alert':
        this.dialogRef.close(undefined);
        break;
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.onConfirm();
    }
  }
}
