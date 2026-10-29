/**
 * Pure parsing functions and types for API spec code blocks.
 * Zero DOM, zero Angular — easily unit-testable.
 */

import * as yaml from 'js-yaml';

// ─── Types ───────────────────────────────────────────────────────────

export interface ApiSpec {
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

export interface ApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema?: ApiSchema;
}

export interface ApiSchema {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  properties?: Record<string, ApiSchema>;
  required?: string[];
}

export interface ApiResponse {
  status: number;
  statusText: string;
  durationMs: number;
  body: string;
}

export type ParseResult =
  | { kind: 'single'; spec: ApiSpec }
  | { kind: 'multi'; specs: ApiSpec[]; title?: string; version?: string };

// ─── Helpers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

/**
 * Resolve a same-document `$ref` (e.g. `#/components/parameters/NoteId`).
 * Returns the original object when it is not a `$ref` or cannot be resolved.
 */
export function resolveRef(
  obj: AnyObj | undefined,
  root: AnyObj,
  seen?: Set<string>,
): AnyObj | undefined {
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
export function resolveSchema(schema: AnyObj | undefined, root: AnyObj): ApiSchema | undefined {
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
export function mergeParameters(
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

export const OPENAPI_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
] as const;

/** Extract individual endpoint specs from a full OpenAPI 3.x document. */
export function extractEndpoints(doc: AnyObj): ApiSpec[] {
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

// ─── Parse API YAML ──────────────────────────────────────────────────

export function parseApiYaml(content: string): {
  result: ParseResult | null;
  error: string | null;
} {
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

// ─── Body / default helpers ──────────────────────────────────────────

export function defaultForType(type?: string): unknown {
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

export function buildBodyFromSchema(schema?: ApiSchema): string {
  if (!schema) return '{}';
  if (schema.example !== undefined) return JSON.stringify(schema.example, null, 2);
  if (!schema.properties) return '{}';

  const skeleton: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    skeleton[key] = prop.example ?? defaultForType(prop.type);
  }
  return JSON.stringify(skeleton, null, 2);
}

// ─── Tailwind class maps (so the scanner finds them) ─────────────────

export const METHOD_BG: Record<string, string> = {
  get: 'bg-method-get',
  post: 'bg-method-post',
  put: 'bg-method-put',
  patch: 'bg-method-patch',
  delete: 'bg-method-delete',
};

export const METHOD_BORDER: Record<string, string> = {
  get: 'border-l-method-get',
  post: 'border-l-method-post',
  put: 'border-l-method-put',
  patch: 'border-l-method-patch',
  delete: 'border-l-method-delete',
};
