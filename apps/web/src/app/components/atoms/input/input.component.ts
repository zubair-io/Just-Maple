import { Component, input, output, forwardRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

export type InputType = 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';

@Component({
  selector: 'ui-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <input
      [type]="type()"
      [id]="id()"
      [name]="name()"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [required]="required()"
      [autocomplete]="autocomplete()"
      [class]="inputClasses"
      [ngModel]="value"
      [ngModelOptions]="{ standalone: true }"
      (ngModelChange)="onValueChange($event)"
      (blur)="onTouched()"
    />
  `,
})
export class InputComponent implements ControlValueAccessor {
  readonly type = input<InputType>('text');
  readonly id = input<string>('');
  readonly name = input<string>('');
  readonly placeholder = input<string>('');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly autocomplete = input<string>('off');
  readonly error = input(false);

  value = '';
  onChange: (value: string) => void = () => {};
  onTouched: () => void = () => {};

  get inputClasses(): string {
    const base =
      'block w-full px-4 py-3 rounded-lg text-sm transition-all duration-200 placeholder-[var(--color-text-muted)]';
    const normal =
      'border border-[var(--color-border)] bg-[var(--color-input-bg)] text-[var(--color-text-main)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20';
    const errorStyle =
      'border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-[var(--color-error)]/20';
    const disabledStyle =
      'disabled:bg-[var(--color-surface-alt)] disabled:cursor-not-allowed disabled:opacity-60';

    return `${base} ${this.error() ? errorStyle : normal} ${disabledStyle}`;
  }

  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    // Handled via input
  }

  onValueChange(value: string): void {
    this.value = value;
    this.onChange(value);
  }
}
