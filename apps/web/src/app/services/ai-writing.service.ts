import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, firstValueFrom } from 'rxjs';
import type { AIWritingType, AIUsageResponse } from '@maple/shared';

export interface AIWritingRequest {
  type: AIWritingType;
  selection?: string;
  context: string;
  instruction?: string;
  targetLanguage?: string;
  pageId?: string;
}

export interface AIStreamEvent {
  type: 'token' | 'done' | 'error';
  text?: string;
  tokensUsed?: number;
  finishReason?: string;
  error?: string;
  resetAt?: string;
}

@Injectable({ providedIn: 'root' })
export class AIWritingService {
  private readonly http = inject(HttpClient);

  // Current generation state
  private readonly _isGenerating = signal(false);
  private readonly _currentText = signal('');
  private readonly _error = signal<string | null>(null);

  // Abort controller for cancellation
  private abortController: AbortController | null = null;

  // Public signals
  readonly isGenerating = this._isGenerating.asReadonly();
  readonly currentText = this._currentText.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Generate AI content with streaming
   * Returns an Observable that emits stream events
   */
  generate(notebookId: string, request: AIWritingRequest): Observable<AIStreamEvent> {
    const subject = new Subject<AIStreamEvent>();

    this._isGenerating.set(true);
    this._currentText.set('');
    this._error.set(null);

    // Create abort controller for cancellation
    this.abortController = new AbortController();

    this.streamGenerate(notebookId, request, subject).finally(() => {
      this._isGenerating.set(false);
      this.abortController = null;
    });

    return subject.asObservable();
  }

  /**
   * Cancel the current generation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this._isGenerating.set(false);
  }

  /**
   * Get usage statistics
   */
  async getUsage(): Promise<AIUsageResponse> {
    const response = await firstValueFrom(
      this.http.get<{ usage: AIUsageResponse }>('/api/ai/usage'),
    );
    return response.usage;
  }

  /**
   * Internal method to handle SSE streaming
   */
  private async streamGenerate(
    notebookId: string,
    request: AIWritingRequest,
    subject: Subject<AIStreamEvent>,
  ): Promise<void> {
    try {
      const response = await fetch(`/api/ai/generate/${notebookId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getAuthToken()}`,
        },
        body: JSON.stringify(request),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `HTTP error: ${response.status}`;
        this._error.set(errorMsg);
        subject.next({ type: 'error', error: errorMsg, resetAt: errorData.resetAt });
        subject.complete();
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const errorMsg = 'Failed to get response stream';
        this._error.set(errorMsg);
        subject.next({ type: 'error', error: errorMsg });
        subject.complete();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);

              if (parsed.text !== undefined) {
                // Token event
                this._currentText.update((t) => t + parsed.text);
                subject.next({ type: 'token', text: parsed.text });
              } else if (parsed.tokensUsed !== undefined) {
                // Done event
                subject.next({
                  type: 'done',
                  tokensUsed: parsed.tokensUsed,
                  finishReason: parsed.finishReason,
                });
              } else if (parsed.error !== undefined) {
                // Error event
                this._error.set(parsed.error);
                subject.next({
                  type: 'error',
                  error: parsed.error,
                  resetAt: parsed.resetAt,
                });
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      subject.complete();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled
        subject.next({ type: 'error', error: 'Generation cancelled' });
      } else {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this._error.set(errorMsg);
        subject.next({ type: 'error', error: errorMsg });
      }
      subject.complete();
    }
  }

  /**
   * Get auth token from localStorage
   */
  private getAuthToken(): string {
    return localStorage.getItem('auth_token') || '';
  }

  /**
   * Reset the service state
   */
  reset(): void {
    this.cancel();
    this._currentText.set('');
    this._error.set(null);
  }
}
