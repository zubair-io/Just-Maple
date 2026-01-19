import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { WhiteboardToolType } from '@maple/shared';
import { COLOR_PALETTE, STROKE_SIZES } from '../models/types';

interface ToolButton {
  type: WhiteboardToolType;
  icon: string;
  label: string;
  shortcut: string;
}

@Component({
  selector: 'app-whiteboard-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  // Inputs
  readonly activeTool = input<WhiteboardToolType>('pen');
  readonly strokeColor = input<string>('#000000');
  readonly strokeSize = input<number>(4);
  readonly zoom = input<number>(1);

  // Outputs
  readonly toolChange = output<WhiteboardToolType>();
  readonly colorChange = output<string>();
  readonly sizeChange = output<number>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly zoomReset = output<void>();

  // UI state
  readonly showColorPicker = signal(false);
  readonly showSizePicker = signal(false);

  // Data
  readonly colors = COLOR_PALETTE;
  readonly sizes = STROKE_SIZES;

  readonly tools: ToolButton[] = [
    { type: 'select', icon: 'cursor', label: 'Select', shortcut: 'V' },
    { type: 'pen', icon: 'pen', label: 'Pen', shortcut: 'P' },
    { type: 'line', icon: 'line', label: 'Line', shortcut: 'L' },
    { type: 'rectangle', icon: 'rectangle', label: 'Rectangle', shortcut: 'R' },
    { type: 'ellipse', icon: 'ellipse', label: 'Ellipse', shortcut: 'O' },
    { type: 'arrow', icon: 'arrow', label: 'Arrow', shortcut: 'A' },
  ];

  readonly zoomPercent = computed(() => Math.round(this.zoom() * 100));

  selectTool(type: WhiteboardToolType): void {
    this.toolChange.emit(type);
  }

  selectColor(color: string): void {
    this.colorChange.emit(color);
    this.showColorPicker.set(false);
  }

  selectSize(size: number): void {
    this.sizeChange.emit(size);
    this.showSizePicker.set(false);
  }

  toggleColorPicker(): void {
    this.showColorPicker.update((v) => !v);
    this.showSizePicker.set(false);
  }

  toggleSizePicker(): void {
    this.showSizePicker.update((v) => !v);
    this.showColorPicker.set(false);
  }

  onZoomIn(): void {
    this.zoomIn.emit();
  }

  onZoomOut(): void {
    this.zoomOut.emit();
  }

  onZoomReset(): void {
    this.zoomReset.emit();
  }
}
