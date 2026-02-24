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
}
