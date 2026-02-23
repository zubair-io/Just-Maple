import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { lowlight, supportedLanguages } from './code-block-with-language';
import * as yaml from 'js-yaml';
import { isAbsoluteUrl, resolveApiUrl } from '../../../../utils/api-url';

// ─── Types ───────────────────────────────────────────────────────────

interface ApiSpec {
  path: string;
  method: string;
  server?: string;
  summary?: string;
  parameters?: ApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: {
      'application/json'?: {
        schema?: ApiSchema;
      };
    };
  };
  responses?: Record<string, { description: string }>;
  security?: Record<string, string[]>[];
}

interface ApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema?: ApiSchema;
}

interface ApiSchema {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  properties?: Record<string, ApiSchema>;
  required?: string[];
}

interface ApiResponse {
  status: number;
  statusText: string;
  durationMs: number;
  body: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseApiYaml(content: string): { spec: ApiSpec | null; error: string | null } {
  try {
    const parsed = yaml.load(content) as ApiSpec | null;
    if (!parsed || typeof parsed !== 'object') {
      return { spec: null, error: 'Empty or invalid YAML' };
    }
    if (!parsed.path || !parsed.method) {
      return { spec: null, error: 'Missing required fields: path, method' };
    }
    return { spec: parsed, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { spec: null, error: `Invalid YAML: ${message}` };
  }
}

function defaultForType(type?: string): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

function buildBodyFromSchema(schema?: ApiSchema): string {
  if (!schema) return '{}';
  if (schema.example !== undefined) return JSON.stringify(schema.example, null, 2);
  if (!schema.properties) return '{}';

  const skeleton: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    skeleton[key] = prop.example ?? defaultForType(prop.type);
  }
  return JSON.stringify(skeleton, null, 2);
}

function buildCurl(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
): string {
  let curl = `curl -X ${method} '${url}'`;
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'Content-Type' && !body) continue;
    curl += ` \\\n  -H '${key}: ${value}'`;
  }
  if (body) {
    curl += ` \\\n  -H 'Content-Type: application/json'`;
    curl += ` \\\n  -d '${body}'`;
  }
  return curl;
}

/** Stop ProseMirror from intercepting keyboard input inside form controls. */
function isolateFromEditor(el: HTMLElement): void {
  for (const event of ['keydown', 'keypress', 'keyup'] as const) {
    el.addEventListener(event, (e) => e.stopPropagation());
  }
}

/**
 * Send an HTTP request via fetch() with a timeout.
 * Returns a normalized response regardless of success or network error.
 */
async function sendRequest(payload: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<ApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  const start = performance.now();

  try {
    const resp = await fetch(payload.url, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const body = await resp.text();
    return {
      status: resp.status,
      statusText: resp.statusText,
      durationMs: Math.round(performance.now() - start),
      body,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    const message = isTimeout
      ? 'Request timed out after 30s'
      : err instanceof Error
        ? err.message
        : String(err);

    return {
      status: 0,
      statusText: isTimeout ? 'Timeout' : 'Network Error',
      durationMs: Math.round(performance.now() - start),
      body: JSON.stringify({ error: message }),
    };
  }
}

// ─── Tailwind class maps (so the scanner finds them) ─────────────────

const METHOD_BG: Record<string, string> = {
  get: 'bg-method-get',
  post: 'bg-method-post',
  put: 'bg-method-put',
  patch: 'bg-method-patch',
  delete: 'bg-method-delete',
};

const METHOD_BORDER: Record<string, string> = {
  get: 'border-l-method-get',
  post: 'border-l-method-post',
  put: 'border-l-method-put',
  patch: 'border-l-method-patch',
  delete: 'border-l-method-delete',
};

// ─── DOM Builder ─────────────────────────────────────────────────────

function createApiBlockDom(
  spec: ApiSpec,
  contentDOM: HTMLElement,
  _getContent: () => string,
): HTMLElement {
  const container = document.createElement('div');
  container.classList.add(
    'api-block',
    'border',
    'border-border',
    'rounded-lg',
    'overflow-hidden',
    'font-mono',
    'text-[13px]',
    'border-l-[3px]',
  );
  const methodLower = spec.method.toLowerCase();
  container.classList.add(METHOD_BORDER[methodLower] ?? 'border-l-border');

  // ── State ──

  let showSource = false;
  let sending = false;
  let serverUrl = spec.server ?? '';
  const paramValues: Record<string, string> = {};
  let requestBody = '';
  let authToken = '';
  let lastResponse: ApiResponse | null = null;

  const pathParams = (spec.parameters ?? []).filter((p) => p.in === 'path');
  const queryParams = (spec.parameters ?? []).filter((p) => p.in === 'query');
  const headerParams = (spec.parameters ?? []).filter((p) => p.in === 'header');
  const hasBody = !!spec.requestBody;
  const requiresAuth = !!spec.security?.length;

  // Pre-fill examples
  for (const param of spec.parameters ?? []) {
    const example = param.schema?.example ?? param.schema?.default;
    if (example !== undefined) {
      const key = param.in === 'header' ? `header:${param.name}` : param.name;
      paramValues[key] = String(example);
    }
  }
  if (hasBody) {
    const schema = spec.requestBody?.content?.['application/json']?.schema;
    requestBody = buildBodyFromSchema(schema);
  }

  // ── Header ──

  const header = document.createElement('div');
  header.classList.add(
    'api-block__header',
    'flex',
    'items-center',
    'gap-2',
    'px-3',
    'py-2',
    'bg-bg-secondary',
    'border-b',
    'border-border',
  );

  const methodBadge = document.createElement('span');
  methodBadge.classList.add(
    'font-bold',
    'text-[11px]',
    'uppercase',
    'px-1.5',
    'py-0.5',
    'rounded',
    'text-white',
    'shrink-0',
  );
  methodBadge.classList.add(METHOD_BG[methodLower] ?? 'bg-method-get');
  methodBadge.textContent = spec.method.toUpperCase();
  header.appendChild(methodBadge);

  const pathEl = document.createElement('span');
  pathEl.classList.add('font-semibold', 'break-all');
  pathEl.textContent = spec.path;
  header.appendChild(pathEl);

  if (spec.summary) {
    const summaryEl = document.createElement('span');
    summaryEl.classList.add('text-text-muted', 'text-xs', 'ml-auto', 'shrink-0');
    summaryEl.textContent = spec.summary;
    header.appendChild(summaryEl);
  }

  const headerActions = document.createElement('div');
  headerActions.classList.add('flex', 'items-center', 'ml-auto', 'shrink-0');

  const toggleBtn = document.createElement('button');
  toggleBtn.classList.add(
    'bg-transparent',
    'border',
    'border-border',
    'rounded',
    'px-2',
    'py-1',
    'cursor-pointer',
    'text-text-muted',
    'flex',
    'items-center',
    'hover:bg-bg-hover',
    'hover:text-text-main',
  );
  toggleBtn.title = 'Edit YAML';
  toggleBtn.contentEditable = 'false';
  toggleBtn.innerHTML = `<span class="material-symbols-rounded text-base">code</span>`;
  headerActions.appendChild(toggleBtn);
  header.appendChild(headerActions);
  container.appendChild(header);

  // ── Source view (hidden by default) ──

  const sourceView = document.createElement('div');
  sourceView.classList.add('api-block__source', 'p-0');
  sourceView.style.display = 'none';
  sourceView.appendChild(contentDOM);

  // ── Form view ──

  const formView = document.createElement('div');
  formView.classList.add('api-block__form', 'p-3', 'flex', 'flex-col', 'gap-2');
  formView.contentEditable = 'false';

  function createField(
    label: string,
    opts: {
      required?: boolean;
      type?: string;
      placeholder?: string;
      value?: string;
      isPassword?: boolean;
      hint?: string;
      onInput?: (value: string) => void;
    },
  ): HTMLElement {
    const field = document.createElement('div');
    field.classList.add(
      'api-block__field',
      'grid',
      'grid-cols-[120px_1fr]',
      'items-center',
      'gap-2',
    );

    const labelEl = document.createElement('label');
    labelEl.classList.add('text-xs', 'text-text-muted', 'text-right', 'font-sans');
    labelEl.textContent = label;
    if (opts.required) {
      const req = document.createElement('span');
      req.classList.add('text-error');
      req.textContent = ' *';
      labelEl.appendChild(req);
    }
    field.appendChild(labelEl);

    const input = document.createElement('input');
    input.type = opts.isPassword ? 'password' : opts.type || 'text';
    input.placeholder = opts.placeholder || '';
    input.value = opts.value || '';
    input.classList.add(
      'px-2',
      'py-1.5',
      'border',
      'border-border',
      'rounded',
      'font-[inherit]',
      'text-[13px]',
      'bg-bg',
      'text-text-main',
      'focus:outline-none',
      'focus:border-primary',
    );
    isolateFromEditor(input);
    input.addEventListener('input', () => opts.onInput?.(input.value));
    field.appendChild(input);

    if (opts.hint) {
      const hintEl = document.createElement('span');
      hintEl.classList.add('col-start-2', 'text-[11px]', 'text-text-muted', 'font-sans');
      hintEl.textContent = opts.hint;
      field.appendChild(hintEl);
    }

    return field;
  }

  // Server URL
  const serverField = createField('Server', {
    placeholder: 'https://api.example.com',
    value: serverUrl,
    onInput: (val) => {
      serverUrl = val;
      updateSendState();
      const input = serverField.querySelector('input')!;
      const existing = serverField.querySelector('.field-error');
      if (val && !isAbsoluteUrl(val)) {
        input.classList.add('!border-error');
        if (!existing) {
          const err = document.createElement('span');
          err.classList.add('field-error', 'col-start-2', 'text-[11px]', 'text-error', 'font-sans');
          err.textContent = 'Must be a full URL (http:// or https://)';
          serverField.appendChild(err);
        }
      } else {
        input.classList.remove('!border-error');
        existing?.remove();
      }
    },
  });
  formView.appendChild(serverField);

  // Path params
  for (const param of pathParams) {
    formView.appendChild(
      createField(`:${param.name}`, {
        required: param.required,
        placeholder: String(param.schema?.example ?? param.schema?.default ?? ''),
        value: paramValues[param.name] ?? '',
        onInput: (val) => {
          paramValues[param.name] = val;
        },
      }),
    );
  }

  // Query params
  for (const param of queryParams) {
    formView.appendChild(
      createField(param.name, {
        required: param.required,
        type:
          param.schema?.type === 'integer' || param.schema?.type === 'number' ? 'number' : 'text',
        placeholder: String(param.schema?.example ?? param.schema?.default ?? ''),
        value: paramValues[param.name] ?? '',
        onInput: (val) => {
          paramValues[param.name] = val;
        },
      }),
    );
  }

  // Header params
  for (const param of headerParams) {
    formView.appendChild(
      createField(param.name, {
        placeholder: String(param.schema?.example ?? param.schema?.default ?? ''),
        value: paramValues[`header:${param.name}`] ?? '',
        onInput: (val) => {
          paramValues[`header:${param.name}`] = val;
        },
      }),
    );
  }

  // Request body textarea
  if (hasBody) {
    const bodyField = document.createElement('div');
    bodyField.classList.add('api-block__body', 'flex', 'flex-col', 'gap-1');
    const bodyLabel = document.createElement('label');
    bodyLabel.classList.add('text-xs', 'text-text-muted', 'font-sans');
    bodyLabel.textContent = 'Body';
    bodyField.appendChild(bodyLabel);

    const textarea = document.createElement('textarea');
    textarea.rows = 6;
    textarea.value = requestBody;
    textarea.placeholder = '{}';
    textarea.classList.add(
      'w-full',
      'p-2',
      'border',
      'border-border',
      'rounded',
      'font-mono',
      'text-[13px]',
      'resize-y',
      'bg-bg',
      'text-text-main',
      'focus:outline-none',
      'focus:border-primary',
    );
    isolateFromEditor(textarea);
    textarea.addEventListener('input', () => {
      requestBody = textarea.value;
    });
    bodyField.appendChild(textarea);
    formView.appendChild(bodyField);
  }

  // Auth
  if (requiresAuth) {
    formView.appendChild(
      createField('Auth', {
        isPassword: true,
        placeholder: 'Bearer token or API key',
        hint: 'Stored on this device only',
        onInput: (val) => {
          authToken = val;
        },
      }),
    );
  }

  // ── Actions row ──

  const actions = document.createElement('div');
  actions.classList.add('api-block__actions', 'flex', 'gap-2', 'items-center');

  const sendBtn = document.createElement('button');
  sendBtn.classList.add(
    'api-block__send',
    'flex',
    'items-center',
    'gap-1.5',
    'px-4',
    'py-2',
    'bg-primary',
    'text-white',
    'border-none',
    'rounded-md',
    'cursor-pointer',
    'font-semibold',
    'text-[13px]',
    'font-sans',
    'hover:opacity-90',
    'disabled:opacity-50',
    'disabled:cursor-not-allowed',
  );
  const sendBtnIcon = document.createElement('span');
  sendBtnIcon.classList.add('material-symbols-rounded', 'text-base');
  sendBtnIcon.textContent = 'send';
  sendBtn.appendChild(sendBtnIcon);
  const sendBtnText = document.createTextNode(' Send');
  sendBtn.appendChild(sendBtnText);

  const sendHint = document.createElement('div');
  sendHint.classList.add(
    'api-block__send-disabled',
    'flex',
    'items-center',
    'gap-1.5',
    'px-3',
    'py-2',
    'bg-bg-secondary',
    'border',
    'border-border',
    'rounded-md',
    'text-xs',
    'text-text-muted',
    'font-sans',
  );
  const infoIcon = document.createElement('span');
  infoIcon.classList.add('material-symbols-rounded', 'text-base');
  infoIcon.textContent = 'info';
  sendHint.appendChild(infoIcon);
  const hintText = document.createElement('span');
  sendHint.appendChild(hintText);

  actions.appendChild(sendBtn);
  actions.appendChild(sendHint);

  const curlBtn = document.createElement('button');
  curlBtn.classList.add(
    'bg-transparent',
    'border',
    'border-border',
    'rounded',
    'px-2',
    'py-1',
    'cursor-pointer',
    'text-text-muted',
    'flex',
    'items-center',
    'hover:bg-bg-hover',
    'hover:text-text-main',
  );
  curlBtn.title = 'Copy as cURL';
  curlBtn.innerHTML = `<span class="material-symbols-rounded text-base">content_copy</span>`;
  actions.appendChild(curlBtn);
  formView.appendChild(actions);

  // ── Response area ──

  const responseArea = document.createElement('div');
  responseArea.classList.add('api-block__response', 'border-t', 'border-border');
  responseArea.style.display = 'none';

  const responseHeader = document.createElement('div');
  responseHeader.classList.add(
    'api-block__response-header',
    'flex',
    'items-center',
    'gap-2',
    'px-3',
    'py-2',
    'bg-bg-secondary',
  );
  const statusEl = document.createElement('span');
  statusEl.classList.add('api-block__status', 'font-bold', 'text-xs', 'px-2', 'py-0.5', 'rounded');
  const timingEl = document.createElement('span');
  timingEl.classList.add('text-text-muted', 'text-xs', 'ml-auto');
  responseHeader.appendChild(statusEl);
  responseHeader.appendChild(timingEl);
  responseArea.appendChild(responseHeader);

  const responseBody = document.createElement('pre');
  responseBody.classList.add(
    'api-block__response-body',
    'p-3',
    'm-0',
    'max-h-[300px]',
    'overflow-auto',
    'text-xs',
    'leading-relaxed',
    'whitespace-pre-wrap',
    'bg-code-bg',
    'text-code-text',
    'font-mono',
  );
  responseArea.appendChild(responseBody);

  // ── Assemble ──

  container.appendChild(formView);
  container.appendChild(sourceView);
  container.appendChild(responseArea);

  // ── Behaviour ──

  function updateSendState(): void {
    const validUrl = isAbsoluteUrl(serverUrl || spec.server || '');
    const canSend = validUrl && !sending;

    sendBtn.style.display = canSend ? 'flex' : 'none';
    sendBtn.disabled = sending;

    if (!validUrl) {
      sendHint.style.display = 'flex';
      hintText.textContent = 'Enter a server URL to send requests';
    } else {
      sendHint.style.display = 'none';
    }
  }

  function showResponse(resp: ApiResponse): void {
    lastResponse = resp;
    responseArea.style.display = '';

    const isSuccess = resp.status >= 200 && resp.status < 400;
    const isTimeout = resp.status === 0;

    statusEl.textContent = isTimeout ? `${resp.statusText}` : `${resp.status} ${resp.statusText}`;
    statusEl.className =
      'api-block__status font-bold text-xs px-2 py-0.5 rounded ' +
      (isSuccess
        ? 'bg-status-success-bg text-status-success-text'
        : 'bg-status-error-bg text-status-error-text');

    timingEl.textContent = `${resp.durationMs}ms`;

    try {
      const parsed = JSON.parse(resp.body);
      responseBody.textContent = JSON.stringify(parsed, null, 2);
    } catch {
      responseBody.textContent = resp.body;
    }
  }

  function buildResolvedUrl(): string | null {
    const url = resolveApiUrl(serverUrl || spec.server, spec.path);
    if (!url) return null;

    let resolved = url;
    for (const param of pathParams) {
      const val = paramValues[param.name] ?? '';
      resolved = resolved.replace(`{${param.name}}`, encodeURIComponent(val));
    }

    const qp = queryParams
      .filter((p) => paramValues[p.name])
      .map((p) => [p.name, paramValues[p.name]] as [string, string]);
    if (qp.length) resolved += '?' + new URLSearchParams(qp).toString();

    return resolved;
  }

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const param of headerParams) {
      const val = paramValues[`header:${param.name}`];
      if (val) headers[param.name] = val;
    }
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
  }

  // ── Event handlers ──

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showSource = !showSource;
    toggleBtn.innerHTML = `<span class="material-symbols-rounded text-base">${showSource ? 'visibility' : 'code'}</span>`;

    if (showSource) {
      sourceView.style.display = '';
      formView.style.display = 'none';
      responseArea.style.display = 'none';
    } else {
      sourceView.style.display = 'none';
      formView.style.display = '';
      if (lastResponse) responseArea.style.display = '';
    }
  });

  sendBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (sending) return;

    const resolvedUrl = buildResolvedUrl();
    if (!resolvedUrl) return;

    // Enter sending state
    sending = true;
    sendBtnIcon.textContent = 'progress_activity';
    sendBtnIcon.classList.add('animate-spin');
    sendBtnText.textContent = ' Sending...';
    sendBtn.disabled = true;

    const resp = await sendRequest({
      url: resolvedUrl,
      method: spec.method.toUpperCase(),
      headers: buildHeaders(),
      body: hasBody ? requestBody : undefined,
    });

    // Reset button
    sending = false;
    sendBtnIcon.textContent = 'send';
    sendBtnIcon.classList.remove('animate-spin');
    sendBtnText.textContent = ' Send';
    sendBtn.disabled = false;
    updateSendState();

    showResponse(resp);
  });

  curlBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const base = serverUrl || spec.server || '';
    let url = base + spec.path;
    for (const param of pathParams) {
      url = url.replace(`{${param.name}}`, paramValues[param.name] ?? '');
    }
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    for (const param of headerParams) {
      const val = paramValues[`header:${param.name}`];
      if (val) headers[param.name] = val;
    }
    navigator.clipboard.writeText(
      buildCurl(spec.method.toUpperCase(), url, headers, hasBody ? requestBody : undefined),
    );
  });

  updateSendState();
  return container;
}

// ─── Error view (invalid YAML) ───────────────────────────────────────

function createErrorBlock(error: string, contentDOM: HTMLElement): HTMLElement {
  const errorEl = document.createElement('div');
  errorEl.classList.add(
    'api-block',
    'border',
    'border-border',
    'rounded-lg',
    'overflow-hidden',
    'font-mono',
    'text-[13px]',
  );

  const errorHeader = document.createElement('div');
  errorHeader.classList.add(
    'flex',
    'items-center',
    'gap-2',
    'px-3',
    'py-2',
    'bg-bg-secondary',
    'border-b',
    'border-border',
  );
  const badge = document.createElement('span');
  badge.classList.add(
    'font-bold',
    'text-[11px]',
    'uppercase',
    'px-1.5',
    'py-0.5',
    'rounded',
    'text-white',
    'shrink-0',
    'bg-method-get',
  );
  badge.textContent = 'API';
  errorHeader.appendChild(badge);
  const pathEl = document.createElement('span');
  pathEl.classList.add('font-semibold', 'break-all');
  pathEl.textContent = 'Invalid spec';
  errorHeader.appendChild(pathEl);
  errorEl.appendChild(errorHeader);

  const errMsg = document.createElement('div');
  errMsg.classList.add(
    'px-3',
    'py-2',
    'bg-status-error-bg',
    'text-status-error-text',
    'text-xs',
    'flex',
    'items-center',
    'gap-1.5',
    'font-sans',
  );
  const errIcon = document.createElement('span');
  errIcon.classList.add('material-symbols-rounded', 'text-base');
  errIcon.textContent = 'error';
  errMsg.appendChild(errIcon);
  errMsg.appendChild(document.createTextNode(` ${error}`));
  errorEl.appendChild(errMsg);

  const sourceView = document.createElement('div');
  sourceView.classList.add('p-0');
  const pre = document.createElement('pre');
  pre.classList.add('m-0', 'bg-code-bg', 'p-4');
  pre.appendChild(contentDOM);
  contentDOM.classList.add('bg-transparent', 'p-0', 'text-code-text', 'font-mono', 'text-sm');
  contentDOM.style.display = '';
  sourceView.appendChild(pre);
  errorEl.appendChild(sourceView);

  return errorEl;
}

// ─── TipTap NodeView ─────────────────────────────────────────────────

function createApiNodeView(
  node: ProseMirrorNode,
  _getPos: (() => number | undefined) | boolean,
  _editor: Editor,
) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('api-block-wrapper', 'my-3');

  const contentDOM = document.createElement('code');
  contentDOM.style.display = 'none';

  const content = node.textContent;
  const { spec, error } = parseApiYaml(content);

  if (spec && !error) {
    wrapper.appendChild(createApiBlockDom(spec, contentDOM, () => node.textContent));
  } else {
    wrapper.appendChild(createErrorBlock(error || 'Invalid YAML', contentDOM));
  }

  return {
    dom: wrapper,
    contentDOM,
    update: (updatedNode: ProseMirrorNode) => {
      if (updatedNode.type.name !== 'codeBlock') return false;
      if (updatedNode.attrs['language'] !== 'api') return false;

      const newContent = updatedNode.textContent;
      const { spec: newSpec, error: newError } = parseApiYaml(newContent);

      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);

      if (newSpec && !newError) {
        contentDOM.style.display = 'none';
        wrapper.appendChild(createApiBlockDom(newSpec, contentDOM, () => updatedNode.textContent));
      } else {
        const errEl = document.createElement('div');
        errEl.classList.add(
          'api-block',
          'border',
          'border-border',
          'rounded-lg',
          'overflow-hidden',
          'font-mono',
          'text-[13px]',
        );
        const errMsg = document.createElement('div');
        errMsg.classList.add(
          'px-3',
          'py-2',
          'bg-status-error-bg',
          'text-status-error-text',
          'text-xs',
          'flex',
          'items-center',
          'gap-1.5',
          'font-sans',
        );
        errMsg.textContent = newError || 'Invalid YAML';
        errEl.appendChild(errMsg);
        contentDOM.style.display = 'none';
        errEl.appendChild(contentDOM);
        wrapper.appendChild(errEl);
      }
      return true;
    },
  };
}

// ─── Default code block NodeView ─────────────────────────────────────

function createDefaultCodeBlockView(
  node: ProseMirrorNode,
  getPos: (() => number | undefined) | boolean,
  editor: Editor,
) {
  const container = document.createElement('div');
  container.classList.add('code-block-container');

  const select = document.createElement('select');
  select.classList.add('code-block-language');
  select.contentEditable = 'false';

  const allLanguages = [...supportedLanguages, { value: 'api', label: 'API' }];
  allLanguages.forEach((lang) => {
    const option = document.createElement('option');
    option.value = lang.value;
    option.textContent = lang.label;
    if (node.attrs['language'] === lang.value) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos !== null && pos !== undefined) {
      editor.chain().focus().setCodeBlock({ language: target.value }).run();
    }
  });

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.classList.add(`language-${node.attrs['language'] || 'plaintext'}`);
  pre.appendChild(code);

  container.appendChild(select);
  container.appendChild(pre);

  return {
    dom: container,
    contentDOM: code,
    update: (updatedNode: ProseMirrorNode) => {
      if (updatedNode.type.name !== 'codeBlock') return false;
      if (updatedNode.attrs['language'] === 'api') return false;
      code.className = `language-${updatedNode.attrs['language'] || 'plaintext'}`;
      select.value = updatedNode.attrs['language'] || 'plaintext';
      return true;
    },
  };
}

// ─── Extension export ────────────────────────────────────────────────

export const ApiCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      if (node.attrs['language'] === 'api') {
        return createApiNodeView(node, getPos, editor);
      }
      return createDefaultCodeBlockView(node, getPos, editor);
    };
  },
}).configure({
  lowlight,
  defaultLanguage: 'plaintext',
});
