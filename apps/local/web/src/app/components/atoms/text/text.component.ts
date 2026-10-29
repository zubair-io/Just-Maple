import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type TextColor = 'main' | 'muted' | 'primary' | 'error' | 'success';
export type TextWeight = 'normal' | 'medium' | 'bold';

@Component({
  selector: 'app-text',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './text.component.html',
  styleUrl: './text.component.scss',
})
export class TextComponent {
  readonly value = input<string>('');
  readonly size = input<TextSize>('md');
  readonly color = input<TextColor>('main');
  readonly weight = input<TextWeight>('normal');

  get classes(): string {
    const sizeMap: Record<TextSize, string> = {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
    };
    const colorMap: Record<TextColor, string> = {
      main: 'text-[var(--color-text-main)]',
      muted: 'text-[var(--color-text-muted)]',
      primary: 'text-[var(--color-primary)]',
      error: 'text-red-600',
      success: 'text-green-600',
    };
    const weightMap: Record<TextWeight, string> = {
      normal: 'font-normal',
      medium: 'font-medium',
      bold: 'font-bold',
    };
    return `${sizeMap[this.size()]} ${colorMap[this.color()]} ${weightMap[this.weight()]}`;
  }
}
