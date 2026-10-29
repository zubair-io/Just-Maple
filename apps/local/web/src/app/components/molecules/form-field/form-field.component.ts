import { Component, input, contentChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InputComponent } from '../../atoms/input/input.component';

@Component({
  selector: 'ui-form-field',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './form-field.component.html',
})
export class FormFieldComponent {
  readonly label = input<string>('');
  readonly for = input<string>('');
  readonly error = input<string>('');
  readonly hint = input<string>('');
  readonly required = input(false);
}
