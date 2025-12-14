import { Component, input, contentChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputComponent } from '../../atoms';

@Component({
  selector: 'ui-form-field',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-2">
      @if (label()) {
        <label [for]="for()" class="block text-sm font-semibold text-[var(--color-charcoal)]">
          {{ label() }}
          @if (required()) {
            <span class="text-[var(--color-maple)]">*</span>
          }
        </label>
      }
      <ng-content />
      @if (error()) {
        <p class="text-sm text-[var(--color-error)]">{{ error() }}</p>
      }
      @if (hint() && !error()) {
        <p class="text-sm text-[var(--color-mist)]">{{ hint() }}</p>
      }
    </div>
  `,
})
export class FormFieldComponent {
  readonly label = input<string>('');
  readonly for = input<string>('');
  readonly error = input<string>('');
  readonly hint = input<string>('');
  readonly required = input(false);
}
