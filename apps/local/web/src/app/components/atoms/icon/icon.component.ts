import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-icon, ui-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<IconSize>('md');
  readonly color = input<string>('');

  get iconClasses(): string {
    const sizeMap: Record<IconSize, string> = {
      xs: 'text-sm',
      sm: 'text-base',
      md: 'text-2xl',
      lg: 'text-3xl',
      xl: 'text-4xl',
    };
    const colorClasses = this.color() ? `text-${this.color()}` : 'text-[var(--color-text-main)]';
    return `${sizeMap[this.size()]} ${colorClasses}`;
  }
}
