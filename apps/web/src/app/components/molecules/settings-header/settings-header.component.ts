import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-settings-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings-header.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './settings-header.component.scss',
})
export class SettingsHeaderComponent {
  readonly title = input.required<string>();
  readonly backClicked = output<void>();

  onBackClick(): void {
    this.backClicked.emit();
  }
}
