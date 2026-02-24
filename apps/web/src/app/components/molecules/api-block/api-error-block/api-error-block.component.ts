import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

@Component({
  selector: 'app-api-error-block',
  standalone: true,
  templateUrl: './api-error-block.component.html',
  styleUrl: './api-error-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiErrorBlockComponent {
  readonly error = input.required<string>();
  readonly editYaml = output<void>();
}
