import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ApiResponse } from '../../../../utils/api-spec-parser';

@Component({
  selector: 'app-api-response-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './api-response-viewer.component.html',
  styleUrl: './api-response-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiResponseViewerComponent {
  readonly response = input.required<ApiResponse>();

  readonly isSuccess = computed(() => {
    const r = this.response();
    return r.status >= 200 && r.status < 400;
  });

  readonly isTimeout = computed(() => this.response().status === 0);

  readonly statusLabel = computed(() => {
    const r = this.response();
    return this.isTimeout() ? r.statusText : `${r.status} ${r.statusText}`;
  });

  readonly formattedBody = computed(() => {
    const r = this.response();
    try {
      const parsed = JSON.parse(r.body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return r.body;
    }
  });
}
