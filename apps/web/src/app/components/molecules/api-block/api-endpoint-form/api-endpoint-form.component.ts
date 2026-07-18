import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ApiSpec, ApiResponse } from '../../../../utils/api-spec-parser';
import { METHOD_BG, METHOD_BORDER, buildBodyFromSchema } from '../../../../utils/api-spec-parser';
import { isAbsoluteUrl, resolveApiUrl } from '../../../../utils/api-url';
import { ApiRequestService } from '../../../../services/api-request.service';
import { ApiResponseViewerComponent } from '../api-response-viewer/api-response-viewer.component';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

@Component({
  selector: 'app-api-endpoint-form',
  standalone: true,
  imports: [CommonModule, ApiResponseViewerComponent],
  templateUrl: './api-endpoint-form.component.html',
  styleUrl: './api-endpoint-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiEndpointFormComponent {
  private readonly apiRequest = inject(ApiRequestService);

  readonly spec = input.required<ApiSpec>();
  readonly hideEditButton = input<boolean>(false);
  readonly nested = input<boolean>(false);
  readonly editYaml = output<void>();

  readonly methods = METHODS;
  readonly currentMethod = signal('get');
  readonly serverUrl = signal('');
  readonly paramValues = signal<Record<string, string>>({});
  readonly requestBody = signal('');
  readonly authToken = signal('');
  readonly sending = signal(false);
  readonly response = signal<ApiResponse | null>(null);

  readonly pathParams = computed(() =>
    (this.spec().parameters ?? []).filter((p) => p.in === 'path'),
  );
  readonly queryParams = computed(() =>
    (this.spec().parameters ?? []).filter((p) => p.in === 'query'),
  );
  readonly headerParams = computed(() =>
    (this.spec().parameters ?? []).filter((p) => p.in === 'header'),
  );
  readonly hasBody = computed(() => !!this.spec().requestBody);
  readonly requiresAuth = computed(() => !!this.spec().security?.length);

  readonly methodBg = computed(() => METHOD_BG[this.currentMethod()] ?? 'bg-method-get');
  readonly methodBorder = computed(() => METHOD_BORDER[this.currentMethod()] ?? 'border-l-border');

  readonly serverUrlInvalid = computed(() => {
    const url = this.serverUrl();
    return url !== '' && !isAbsoluteUrl(url);
  });

  readonly canSend = computed(() => {
    const url = this.serverUrl() || this.spec().server || '';
    return isAbsoluteUrl(url) && !this.sending();
  });

  readonly sendHintText = computed(() => {
    const url = this.serverUrl() || this.spec().server || '';
    if (!isAbsoluteUrl(url)) return 'Enter a server URL to send requests';
    return '';
  });

  constructor() {
    // Re-initialize form state when spec changes
    effect(() => {
      const s = this.spec();
      this.currentMethod.set(s.method.toLowerCase());
      this.serverUrl.set(s.server ?? '');
      this.response.set(null);

      // Pre-fill examples
      const values: Record<string, string> = {};
      for (const param of s.parameters ?? []) {
        const example = param.schema?.example ?? param.schema?.default;
        if (example !== undefined) {
          const key = param.in === 'header' ? `header:${param.name}` : param.name;
          values[key] = String(example);
        }
      }
      this.paramValues.set(values);

      if (s.requestBody) {
        const schema = s.requestBody?.content?.['application/json']?.schema;
        this.requestBody.set(buildBodyFromSchema(schema));
      } else {
        this.requestBody.set('');
      }

      this.authToken.set('');
    });
  }

  onMethodChange(value: string): void {
    this.currentMethod.set(value);
  }

  onServerUrlChange(value: string): void {
    this.serverUrl.set(value);
  }

  onParamChange(key: string, value: string): void {
    this.paramValues.update((prev) => ({ ...prev, [key]: value }));
  }

  onBodyChange(value: string): void {
    this.requestBody.set(value);
  }

  onAuthChange(value: string): void {
    this.authToken.set(value);
  }

  getParamInputType(param: { schema?: { type?: string } }): string {
    return param.schema?.type === 'integer' || param.schema?.type === 'number' ? 'number' : 'text';
  }

  getParamPlaceholder(param: { schema?: { example?: unknown; default?: unknown } }): string {
    return String(param.schema?.example ?? param.schema?.default ?? '');
  }

  getParamValue(key: string): string {
    return this.paramValues()[key] ?? '';
  }

  async onSend(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (this.sending()) return;

    const url = this.buildResolvedUrl();
    if (!url) return;

    // The destination can be dictated by note content (spec.server). Before
    // sending an auth token there, make the user confirm the exact origin so a
    // shared/pasted note can't silently exfiltrate their credentials.
    if (this.authToken()) {
      let targetOrigin: string;
      try {
        targetOrigin = new URL(url).origin;
      } catch {
        return;
      }
      const proceed = confirm(
        `Send your authorization token to ${targetOrigin}?\n\n` +
          `This destination comes from the note's API block. Only continue if you trust it.`,
      );
      if (!proceed) return;
    }

    this.sending.set(true);

    const resp = await this.apiRequest.sendRequest({
      url,
      method: this.currentMethod().toUpperCase(),
      headers: this.buildHeaders(),
      body: this.hasBody() ? this.requestBody() : undefined,
    });

    this.sending.set(false);
    this.response.set(resp);
  }

  onCopyCurl(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const url = this.buildResolvedUrl();
    if (!url) return;
    navigator.clipboard.writeText(
      this.apiRequest.buildCurl(
        this.currentMethod().toUpperCase(),
        url,
        this.buildHeaders(),
        this.hasBody() ? this.requestBody() : undefined,
      ),
    );
  }

  private buildResolvedUrl(): string | null {
    const url = resolveApiUrl(this.serverUrl() || this.spec().server, this.spec().path);
    if (!url) return null;

    let resolved = url;
    const values = this.paramValues();
    for (const param of this.pathParams()) {
      const val = values[param.name] ?? '';
      resolved = resolved.replace(`{${param.name}}`, encodeURIComponent(val));
    }

    const qp = this.queryParams()
      .filter((p) => values[p.name])
      .map((p) => [p.name, values[p.name]] as [string, string]);
    if (qp.length) resolved += '?' + new URLSearchParams(qp).toString();

    return resolved;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const values = this.paramValues();
    if (this.hasBody()) headers['Content-Type'] = 'application/json';
    for (const param of this.headerParams()) {
      const val = values[`header:${param.name}`];
      if (val) headers[param.name] = val;
    }
    if (this.authToken()) headers['Authorization'] = `Bearer ${this.authToken()}`;
    return headers;
  }
}
