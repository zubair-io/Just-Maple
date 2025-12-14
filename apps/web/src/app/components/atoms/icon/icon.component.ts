import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'ui-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="material-icons-round" [class]="iconClasses">
      {{ name() }}
    </span>
  `,
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<IconSize>('md');
  readonly color = input<string>('');

  get iconClasses(): string {
    const sizes: Record<IconSize, string> = {
      xs: 'text-sm',
      sm: 'text-base',
      md: 'text-lg',
      lg: 'text-xl',
      xl: 'text-2xl',
    };

    return `${sizes[this.size()]} ${this.color()}`;
  }
}
