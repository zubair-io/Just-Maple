import { Injectable } from '@angular/core';
import type { ApiResponse } from '../utils/api-spec-parser';

/**
 * Service for sending HTTP requests to arbitrary external URLs.
 * Uses raw fetch() instead of HttpClient because requests go to external
 * APIs where the app's auth interceptor would be wrong.
 */
@Injectable({ providedIn: 'root' })
export class ApiRequestService {
  async sendRequest(payload: {
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
        // Never attach the app's own cookies: the target URL comes from
        // note-embedded content, so a same-origin URL must not be able to drive
        // an authenticated request with the user's session (one-click CSRF).
        credentials: 'omit',
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

  buildCurl(method: string, url: string, headers: Record<string, string>, body?: string): string {
    // Values here originate from note-embedded content and are untrusted. Wrap
    // every interpolated value in a POSIX-escaped single-quoted string so the
    // generated command cannot break out of quoting and execute injected shell.
    let curl = `curl -X ${shellQuote(method)} ${shellQuote(url)}`;
    for (const [key, value] of Object.entries(headers)) {
      if (key === 'Content-Type' && !body) continue;
      curl += ` \\\n  -H ${shellQuote(`${key}: ${value}`)}`;
    }
    if (body) {
      curl += ` \\\n  -H 'Content-Type: application/json'`;
      curl += ` \\\n  -d ${shellQuote(body)}`;
    }
    return curl;
  }
}

/**
 * POSIX single-quote escaping: wrap in single quotes and replace each embedded
 * single quote with the sequence '\'' (close quote, escaped quote, reopen quote).
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
