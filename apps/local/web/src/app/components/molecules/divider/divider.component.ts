import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ui-divider',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './divider.component.html',
})
export class DividerComponent {
  readonly text = input<string>('');
}
