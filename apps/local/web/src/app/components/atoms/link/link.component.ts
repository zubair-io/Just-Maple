import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-link',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './link.component.html',
  styleUrl: './link.component.scss',
})
export class LinkComponent {
  readonly href = input<string>('');
  readonly label = input<string>('');
  readonly external = input<boolean>(false);

  get displayText(): string {
    return this.label() || this.href();
  }
}
