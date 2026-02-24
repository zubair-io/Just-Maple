import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { lowlight, supportedLanguages } from './code-block-with-language';
import * as yaml from 'js-yaml';
import { isAbsoluteUrl, resolveApiUrl } from '../../../../utils/api-url';

// CodeMirror 6
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

/**
 * Resolve a same-document `$ref` (e.g. `#/components/parameters/NoteId`).
 * Returns the original object when it is not a `$ref` or cannot be resolved.
 */
function resolveRef(obj: AnyObj | undefined, root: AnyObj, seen?: Set<string>): AnyObj | undefined {
  if (!obj || typeof obj !== 'object' || !('$ref' in obj)) return obj;
  const ref = obj['$ref'] as string;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return obj;

  const _seen = seen ?? new Set<string>();
  if (_seen.has(ref)) return obj; // circular
  _seen.add(ref);

  const segments = ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = root;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return obj;
    current = (current as AnyObj)[seg];
  }
  if (current == null || typeof current !== 'object') return obj;
  return resolveRef(current as AnyObj, root, _seen);
}

/** Recursively resolve `$ref` within a schema, returning a shallow-copied ApiSchema. */
function resolveSchema(schema: AnyObj | undefined, root: AnyObj): ApiSchema | undefined {
  if (!schema) return undefined;
  const resolved = resolveRef(schema, root) ?? schema;
  const out: ApiSchema = { ...resolved };
  if (out.properties) {
    const props: Record<string, ApiSchema> = {};
    for (const [key, val] of Object.entries(out.properties)) {
      const rp = resolveRef(val as AnyObj, root);
      props[key] = rp ? { ...rp } : (val as ApiSchema);
    }
    out.properties = props;
  }
  return out;
}

/**
 * Merge path-level and operation-level parameters.
 * Operation params override path params with the same `name`+`in` key.
 */
function mergeParameters(
  pathParams: AnyObj[] | undefined,
  opParams: AnyObj[] | undefined,
): AnyObj[] {
  const map = new Map<string, AnyObj>();
  for (const p of pathParams ?? []) {
    map.set(`${p['in']}:${p['name']}`, p);
  }
  for (const p of opParams ?? []) {
    map.set(`${p['in']}:${p['name']}`, p);
  }
  return [...map.values()];
}

const OPENAPI_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

/** Extract individual endpoint specs from a full OpenAPI 3.x document. */
function extractEndpoints(doc: AnyObj): ApiSpec[] {
  const paths = doc['paths'];
  if (!paths || typeof paths !== 'object') return [];

  const serverUrl = doc['servers']?.[0]?.['url'] ?? '';
  const rootSecurity = doc['security'] as Record<string, string[]>[] | undefined;
  const specs: ApiSpec[] = [];

  for (const [pathKey, pathObj] of Object.entries(paths)) {
    if (!pathObj || typeof pathObj !== 'object') continue;
    const pathItem = resolveRef(pathObj as AnyObj, doc) ?? (pathObj as AnyObj);
    const pathLevelParams = pathItem['parameters'] as AnyObj[] | undefined;

    for (const method of OPENAPI_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      const merged = mergeParameters(pathLevelParams, operation['parameters'] as AnyObj[]);
      const resolvedParams: ApiParameter[] = merged.map((p) => {
        const rp = resolveRef(p, doc) ?? p;
        return {
          name: rp['name'] as string,
          in: rp['in'] as 'path' | 'query' | 'header',
          required: !!rp['required'],
          schema: resolveSchema(rp['schema'], doc),
        };
      });

      // Request body
      let requestBody: ApiSpec['requestBody'];
      const rawBody = resolveRef(operation['requestBody'] as AnyObj, doc);
      if (rawBody) {
        const jsonContent = rawBody['content']?.['application/json'];
        requestBody = {
          required: !!rawBody['required'],
          content: jsonContent
            ? {
                'application/json': {
                  schema: resolveSchema(jsonContent['schema'], doc),
                },
              }
            : undefined,
        };
      }

      // Responses
      const rawResponses = operation['responses'] as AnyObj | undefined;
      let responses: Record<string, { description: string }> | undefined;
      if (rawResponses) {
        responses = {};
        for (const [code, resp] of Object.entries(rawResponses)) {
          const rr = resolveRef(resp as AnyObj, doc);
          responses[code] = { description: (rr?.['description'] as string) ?? '' };
        }
      }

      const security =
        (operation['security'] as Record<string, string[]>[]) ?? rootSecurity ?? undefined;

      specs.push({
        path: pathKey,
        method,
        server: serverUrl,
        summary: (operation['summary'] as string) ?? (operation['operationId'] as string),
        parameters: resolvedParams.length ? resolvedParams : undefined,
        requestBody,
        responses,
        security: security?.length ? security : undefined,
      });
    }
  }

  return specs;
}

// ─── Parse result types ──────────────────────────────────────────────

type ParseResult =
  | { kind: 'single'; spec: ApiSpec }
  | { kind: 'multi'; specs: ApiSpec[]; title?: string; version?: string };

function parseApiYaml(content: string): { result: ParseResult | null; error: string | null } {
  try {
    const parsed = yaml.load(content) as AnyObj | null;
    if (!parsed || typeof parsed !== 'object') {
      return { result: null, error: 'Empty or invalid YAML' };
    }

    // OpenAPI 3.x detection
    if (parsed['openapi'] && parsed['paths']) {
      const specs = extractEndpoints(parsed);
      if (!specs.length) {
        return { result: null, error: 'No endpoints found in OpenAPI spec' };
      }
      return {
        result: {
          kind: 'multi',
          specs,
          title: parsed['info']?.['title'] as string | undefined,
          version: parsed['info']?.['version'] as string | undefined,
        },
        error: null,
      };
    }

    // Flat format
    if (parsed['path'] && parsed['method']) {
      return { result: { kind: 'single', spec: parsed as unknown as ApiSpec }, error: null };
    }

    return { result: null, error: 'Missing required fields: path, method' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: null, error: `Invalid YAML: ${message}` };
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

// ─── YAML Editor Modal ──────────────────────────────────────────────

function createYamlEditorModal(currentYaml: string, onSave: (yaml: string) => void): void {
  const yamlHighlighting = HighlightStyle.define([
    { tag: tags.propertyName, color: '#9cdcfe' },
    { tag: tags.string, color: '#ce9178' },
    { tag: tags.number, color: '#b5cea8' },
    { tag: tags.bool, color: '#569cd6' },
    { tag: tags.null, color: '#569cd6' },
    { tag: tags.punctuation, color: '#808080' },
    { tag: tags.comment, color: '#6a9955' },
    { tag: tags.keyword, color: '#c586c0' },
  ]);

  const cmTheme = EditorView.theme({
    '&': {
      flex: '1',
      fontSize: '13px',
      height: '100%',
    },
    '.cm-scroller': {
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
      overflow: 'auto',
    },
    '.cm-content': {
      caretColor: 'var(--color-text-main)',
      padding: '12px 0',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--color-bg-elevated, var(--color-bg))',
      color: 'var(--color-text-muted)',
      borderRight: '1px solid var(--color-border)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--color-border)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-border) 30%, transparent)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-text-main)',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent)',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent)',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      opacity: '0.5',
      minWidth: '32px',
      padding: '0 8px 0 12px',
    },
  });

  // ── Backdrop ──
  const backdrop = document.createElement('div');
  backdrop.classList.add('yaml-modal-backdrop');
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    animation: 'yaml-modal-enter 0.15s ease-out',
  });

  // ── Panel ──
  const panel = document.createElement('div');
  panel.classList.add('yaml-modal-panel');
  Object.assign(panel.style, {
    width: '700px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: '12px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    overflow: 'hidden',
    animation: 'yaml-modal-panel-enter 0.15s ease-out',
  });

  // ── Header ──
  const headerEl = document.createElement('div');
  Object.assign(headerEl.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-bg-secondary)',
  });
  const title = document.createElement('span');
  title.textContent = 'Edit API Spec';
  Object.assign(title.style, {
    fontWeight: '600',
    fontSize: '14px',
    color: 'var(--color-text-main)',
  });
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 20px;">close</span>`;
  Object.assign(closeBtn.style, {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
  });
  headerEl.appendChild(title);
  headerEl.appendChild(closeBtn);
  panel.appendChild(headerEl);

  // ── Editor host ──
  const editorHost = document.createElement('div');
  Object.assign(editorHost.style, {
    flex: '1',
    overflow: 'auto',
    minHeight: '200px',
    maxHeight: 'calc(80vh - 110px)',
  });
  panel.appendChild(editorHost);

  // ── Footer ──
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid var(--color-border)',
    background: 'var(--color-bg-secondary)',
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '6px 16px',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    background: 'var(--color-bg)',
    color: 'var(--color-text-main)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  Object.assign(saveBtn.style, {
    padding: '6px 16px',
    border: 'none',
    borderRadius: '6px',
    background: 'var(--color-primary)',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  panel.appendChild(footer);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  // ── CodeMirror instance ──
  let cmView: EditorView | null = new EditorView({
    state: EditorState.create({
      doc: currentYaml,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        yamlLang(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(yamlHighlighting),
        keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
        cmTheme,
      ],
    }),
    parent: editorHost,
  });

  // Focus the editor
  cmView.focus();

  // ── Close helper ──
  function close(): void {
    cmView?.destroy();
    cmView = null;
    backdrop.remove();
  }

  // ── Event handlers ──
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  saveBtn.addEventListener('click', () => {
    if (!cmView) return;
    const newYaml = cmView.state.doc.toString();
    close();
    onSave(newYaml);
  });
}

// ─── DOM Builder ─────────────────────────────────────────────────────

function createApiBlockDom(
  spec: ApiSpec,
  contentDOM: HTMLElement,
  _getContent: () => string,
  pmEditor: Editor,
  getPos: (() => number | undefined) | boolean,
  opts?: { hideEditButton?: boolean },
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
  let currentMethod = spec.method.toLowerCase();
  container.classList.add(METHOD_BORDER[currentMethod] ?? 'border-l-border');

  // ── State ──

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

  const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

  const methodSelect = document.createElement('select');
  methodSelect.classList.add(
    'font-bold',
    'text-[11px]',
    'uppercase',
    'px-1.5',
    'py-0.5',
    'rounded',
    'text-white',
    'shrink-0',
    'cursor-pointer',
    'border-none',
    'outline-none',
    'appearance-none',
  );
  methodSelect.classList.add(METHOD_BG[currentMethod] ?? 'bg-method-get');
  for (const m of METHODS) {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = m.toUpperCase();
    option.classList.add('text-text-main', 'bg-bg');
    if (m === currentMethod) option.selected = true;
    methodSelect.appendChild(option);
  }
  isolateFromEditor(methodSelect);
  methodSelect.addEventListener('change', () => {
    const prev = currentMethod;
    currentMethod = methodSelect.value;
    // Update border color on container
    container.classList.remove(METHOD_BORDER[prev] ?? 'border-l-border');
    container.classList.add(METHOD_BORDER[currentMethod] ?? 'border-l-border');
    // Update select background color
    methodSelect.classList.remove(METHOD_BG[prev] ?? 'bg-method-get');
    methodSelect.classList.add(METHOD_BG[currentMethod] ?? 'bg-method-get');
  });
  header.appendChild(methodSelect);

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

  let toggleBtn: HTMLButtonElement | null = null;
  if (!opts?.hideEditButton) {
    toggleBtn = document.createElement('button');
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
  }
  header.appendChild(headerActions);
  container.appendChild(header);

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
    const headers: Record<string, string> = {};
    if (hasBody) headers['Content-Type'] = 'application/json';
    for (const param of headerParams) {
      const val = paramValues[`header:${param.name}`];
      if (val) headers[param.name] = val;
    }
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return headers;
  }

  // ── Event handlers ──

  toggleBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const currentYaml = _getContent();
    createYamlEditorModal(currentYaml, (newYaml) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      const tr = pmEditor.view.state.tr;
      const node = tr.doc.nodeAt(pos);
      if (!node) return;
      const start = pos + 1;
      const end = start + node.content.size;
      tr.replaceWith(start, end, pmEditor.view.state.schema.text(newYaml));
      pmEditor.view.dispatch(tr);
    });
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
      method: currentMethod.toUpperCase(),
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
    const url = buildResolvedUrl();
    if (!url) return;
    navigator.clipboard.writeText(
      buildCurl(
        currentMethod.toUpperCase(),
        url,
        buildHeaders(),
        hasBody ? requestBody : undefined,
      ),
    );
  });

  updateSendState();
  return container;
}

// ─── Multi-endpoint OpenAPI view ─────────────────────────────────────

function createOpenApiBlockDom(
  specs: ApiSpec[],
  meta: { title?: string; version?: string },
  contentDOM: HTMLElement,
  getContent: () => string,
  pmEditor: Editor,
  getPos: (() => number | undefined) | boolean,
): HTMLElement {
  const container = document.createElement('div');
  container.classList.add(
    'api-block-wrapper-multi',
    'border',
    'border-border',
    'rounded-lg',
    'overflow-hidden',
    'text-[13px]',
  );

  // ── Header bar ──
  const header = document.createElement('div');
  header.classList.add(
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
  header.appendChild(badge);

  if (meta.title) {
    const titleEl = document.createElement('span');
    titleEl.classList.add('font-semibold', 'font-sans');
    titleEl.textContent = meta.title;
    header.appendChild(titleEl);
  }

  if (meta.version) {
    const versionEl = document.createElement('span');
    versionEl.classList.add(
      'text-[11px]',
      'px-1.5',
      'py-0.5',
      'rounded',
      'bg-bg',
      'border',
      'border-border',
      'text-text-muted',
      'font-mono',
    );
    versionEl.textContent = `v${meta.version}`;
    header.appendChild(versionEl);
  }

  const countEl = document.createElement('span');
  countEl.classList.add('text-text-muted', 'text-xs', 'font-sans');
  countEl.textContent = `${specs.length} endpoint${specs.length !== 1 ? 's' : ''}`;
  header.appendChild(countEl);

  const spacer = document.createElement('div');
  spacer.classList.add('flex-1');
  header.appendChild(spacer);

  const editBtn = document.createElement('button');
  editBtn.classList.add(
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
    'shrink-0',
  );
  editBtn.title = 'Edit YAML';
  editBtn.contentEditable = 'false';
  editBtn.innerHTML = `<span class="material-symbols-rounded text-base">code</span>`;
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const currentYaml = getContent();
    createYamlEditorModal(currentYaml, (newYaml) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      const tr = pmEditor.view.state.tr;
      const node = tr.doc.nodeAt(pos);
      if (!node) return;
      const start = pos + 1;
      const end = start + node.content.size;
      tr.replaceWith(start, end, pmEditor.view.state.schema.text(newYaml));
      pmEditor.view.dispatch(tr);
    });
  });
  header.appendChild(editBtn);
  container.appendChild(header);

  // ── Endpoint selector ──
  const selectorRow = document.createElement('div');
  selectorRow.classList.add(
    'flex',
    'items-center',
    'gap-2',
    'px-3',
    'py-2',
    'border-b',
    'border-border',
    'bg-bg',
  );

  const selectorLabel = document.createElement('span');
  selectorLabel.classList.add('text-xs', 'text-text-muted', 'font-sans', 'shrink-0');
  selectorLabel.textContent = 'Endpoint';
  selectorRow.appendChild(selectorLabel);

  const select = document.createElement('select');
  select.classList.add(
    'flex-1',
    'px-2',
    'py-1.5',
    'border',
    'border-border',
    'rounded',
    'text-[13px]',
    'bg-bg',
    'text-text-main',
    'font-mono',
    'cursor-pointer',
    'focus:outline-none',
    'focus:border-primary',
  );
  isolateFromEditor(select);

  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const option = document.createElement('option');
    option.value = String(i);
    const label = `${s.method.toUpperCase()} ${s.path}`;
    option.textContent = s.summary ? `${label} — ${s.summary}` : label;
    select.appendChild(option);
  }
  selectorRow.appendChild(select);
  container.appendChild(selectorRow);

  // ── Form mount point ──
  const formMount = document.createElement('div');
  formMount.classList.add('api-block-multi-form');
  container.appendChild(formMount);

  // Hidden contentDOM
  contentDOM.style.display = 'none';
  container.appendChild(contentDOM);

  function renderSelected(index: number): void {
    while (formMount.firstChild) formMount.removeChild(formMount.firstChild);
    const spec = specs[index];
    if (!spec) return;
    const block = createApiBlockDom(
      spec,
      document.createElement('code'),
      getContent,
      pmEditor,
      getPos,
      {
        hideEditButton: true,
      },
    );
    // Remove outer border/rounding since we're nested
    block.classList.remove('border', 'border-border', 'rounded-lg', 'border-l-[3px]');
    for (const cls of Object.values(METHOD_BORDER)) {
      block.classList.remove(cls);
    }
    formMount.appendChild(block);
  }

  select.addEventListener('change', () => {
    renderSelected(Number(select.value));
  });

  // Initial render
  renderSelected(0);

  return container;
}

// ─── Error view (invalid YAML) ───────────────────────────────────────

function createErrorBlock(
  error: string,
  contentDOM: HTMLElement,
  getContent: () => string,
  pmEditor: Editor,
  getPos: (() => number | undefined) | boolean,
): HTMLElement {
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

  const editBtn = document.createElement('button');
  editBtn.classList.add(
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
    'ml-auto',
    'shrink-0',
  );
  editBtn.title = 'Edit YAML';
  editBtn.contentEditable = 'false';
  editBtn.innerHTML = `<span class="material-symbols-rounded text-base">code</span>`;
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const currentYaml = getContent();
    createYamlEditorModal(currentYaml, (newYaml) => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined) return;
      const tr = pmEditor.view.state.tr;
      const node = tr.doc.nodeAt(pos);
      if (!node) return;
      const start = pos + 1;
      const end = start + node.content.size;
      tr.replaceWith(start, end, pmEditor.view.state.schema.text(newYaml));
      pmEditor.view.dispatch(tr);
    });
  });
  errorHeader.appendChild(editBtn);
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

  contentDOM.style.display = 'none';
  errorEl.appendChild(contentDOM);

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

  function renderResult(
    result: ParseResult | null,
    error: string | null,
    getContent: () => string,
  ): void {
    while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
    contentDOM.style.display = 'none';

    if (result && !error) {
      if (result.kind === 'single') {
        wrapper.appendChild(
          createApiBlockDom(result.spec, contentDOM, getContent, _editor, _getPos),
        );
      } else {
        wrapper.appendChild(
          createOpenApiBlockDom(
            result.specs,
            { title: result.title, version: result.version },
            contentDOM,
            getContent,
            _editor,
            _getPos,
          ),
        );
      }
    } else {
      wrapper.appendChild(
        createErrorBlock(error || 'Invalid YAML', contentDOM, getContent, _editor, _getPos),
      );
    }
  }

  const content = node.textContent;
  let lastContent = content;
  const { result, error } = parseApiYaml(content);
  renderResult(result, error, () => node.textContent);

  return {
    dom: wrapper,
    contentDOM,
    stopEvent: (event: Event) => {
      const target = event.target as HTMLElement;
      // Let ProseMirror handle events inside contentDOM (YAML source editing)
      if (contentDOM.contains(target)) return false;
      // Stop ProseMirror from intercepting events on form controls and buttons
      return true;
    },
    ignoreMutation: () => true,
    update: (updatedNode: ProseMirrorNode) => {
      if (updatedNode.type.name !== 'codeBlock') return false;
      if (updatedNode.attrs['language'] !== 'api') return false;

      const newContent = updatedNode.textContent;
      if (newContent === lastContent) return true;
      lastContent = newContent;

      const { result: newResult, error: newError } = parseApiYaml(newContent);
      renderResult(newResult, newError, () => updatedNode.textContent);
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
