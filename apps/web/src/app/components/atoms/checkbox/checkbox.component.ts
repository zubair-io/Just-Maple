import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-checkbox',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './checkbox.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './checkbox.component.scss',
})
export class CheckboxComponent {
  readonly checked = input<boolean>(false);
  readonly label = input<string>('');
  readonly disabled = input<boolean>(false);
}
