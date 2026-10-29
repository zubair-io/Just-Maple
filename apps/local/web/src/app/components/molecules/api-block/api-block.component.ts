import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ParseResult, ApiSpec } from '../../../utils/api-spec-parser';
import { createYamlEditorModal } from '../../../utils/yaml-editor-modal';
import { ApiEndpointFormComponent } from './api-endpoint-form/api-endpoint-form.component';
import { ApiErrorBlockComponent } from './api-error-block/api-error-block.component';

@Component({
  selector: 'app-api-block',
  standalone: true,
  imports: [CommonModule, ApiEndpointFormComponent, ApiErrorBlockComponent],
  templateUrl: './api-block.component.html',
  styleUrl: './api-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiBlockComponent {
  readonly parseResult = input<ParseResult | null>(null);
  readonly parseError = input<string | null>(null);
  readonly yamlContent = input<string>('');
  readonly yamlSaved = output<string>();

  readonly selectedEndpointIndex = signal(0);

  readonly viewMode = computed<'single' | 'multi' | 'error'>(() => {
    const result = this.parseResult();
    if (!result || this.parseError()) return 'error';
    return result.kind;
  });

  readonly currentSpec = computed<ApiSpec | null>(() => {
    const result = this.parseResult();
    if (!result) return null;
    if (result.kind === 'single') return result.spec;
    return result.specs[this.selectedEndpointIndex()] ?? null;
  });

  readonly specs = computed<ApiSpec[]>(() => {
    const result = this.parseResult();
    if (!result || result.kind !== 'multi') return [];
    return result.specs;
  });

  readonly meta = computed(() => {
    const result = this.parseResult();
    if (!result || result.kind !== 'multi') return { title: undefined, version: undefined };
    return { title: result.title, version: result.version };
  });

  readonly errorMessage = computed(() => this.parseError() ?? 'Invalid YAML');

  onEndpointChange(index: number): void {
    this.selectedEndpointIndex.set(index);
  }

  onEditYaml(): void {
    createYamlEditorModal(this.yamlContent(), (newYaml) => {
      this.yamlSaved.emit(newYaml);
    });
  }
}
