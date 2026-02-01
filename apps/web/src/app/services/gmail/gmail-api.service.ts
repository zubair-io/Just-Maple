import { Injectable, inject } from '@angular/core';
import { Observable, from, throwError } from 'rxjs';
import { map, switchMap, catchError, retry, delay } from 'rxjs/operators';
import { GmailAuthService } from './gmail-auth.service';
import type {
  CachedEmail,
  EmailAddress,
  EmailAttachment,
  GmailMessageListResponse,
  ComposeEmailInput,
} from '@maple/shared';

interface GmailApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPayload;
}

interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPayload[];
}

interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: GmailApiMessage }>;
    messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
    labelsAdded?: Array<{ message: GmailApiMessage; labelIds: string[] }>;
    labelsRemoved?: Array<{ message: GmailApiMessage; labelIds: string[] }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

/**
 * Service for interacting with the Gmail REST API.
 * All requests are made directly from the client to Gmail API.
 * Email content is never sent to Maple servers.
 */
@Injectable({ providedIn: 'root' })
export class GmailApiService {
  private readonly authService = inject(GmailAuthService);
  private readonly BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

  /**
   * List messages matching a query.
   */
  listMessages(
    options: {
      query?: string;
      labelIds?: string[];
      maxResults?: number;
      pageToken?: string;
    } = {},
  ): Observable<GmailMessageListResponse> {
    const params = new URLSearchParams();
    if (options.query) params.set('q', options.query);
    if (options.labelIds?.length) params.set('labelIds', options.labelIds.join(','));
    if (options.maxResults) params.set('maxResults', options.maxResults.toString());
    if (options.pageToken) params.set('pageToken', options.pageToken);

    return this.request<GmailMessageListResponse>(`/messages?${params.toString()}`);
  }

  /**
   * Get a single message by ID.
   */
  getMessage(
    messageId: string,
    format: 'full' | 'metadata' | 'minimal' = 'full',
  ): Observable<CachedEmail> {
    return this.request<GmailApiMessage>(`/messages/${messageId}?format=${format}`).pipe(
      map((message) => this.parseMessage(message)),
    );
  }

  /**
   * Get multiple messages by IDs (batched).
   */
  getMessages(messageIds: string[]): Observable<CachedEmail[]> {
    // Process in parallel with concurrency limit
    const batchSize = 10;
    const batches: string[][] = [];
    for (let i = 0; i < messageIds.length; i += batchSize) {
      batches.push(messageIds.slice(i, i + batchSize));
    }

    return from(this.fetchMessageBatches(batches));
  }

  private async fetchMessageBatches(batches: string[][]): Promise<CachedEmail[]> {
    const results: CachedEmail[] = [];

    for (const batch of batches) {
      const messages = await Promise.all(
        batch.map((id) =>
          this.getMessage(id)
            .toPromise()
            .catch(() => null),
        ),
      );
      results.push(...messages.filter((m): m is CachedEmail => m !== null));
    }

    return results;
  }

  /**
   * Get history of changes since a historyId.
   */
  getHistory(startHistoryId: string, pageToken?: string): Observable<GmailHistoryResponse> {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded,messageDeleted,labelAdded,labelRemoved',
    });
    if (pageToken) params.set('pageToken', pageToken);

    return this.request<GmailHistoryResponse>(`/history?${params.toString()}`);
  }

  /**
   * Send an email.
   */
  sendEmail(input: ComposeEmailInput): Observable<{ id: string; threadId: string }> {
    const raw = this.buildRawEmail(input);

    return this.request<{ id: string; threadId: string }>('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    });
  }

  /**
   * Modify message labels (mark read, star, archive, etc.).
   */
  modifyMessage(
    messageId: string,
    options: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Observable<GmailApiMessage> {
    return this.request<GmailApiMessage>(`/messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /**
   * Mark a message as read.
   */
  markAsRead(messageId: string): Observable<void> {
    return this.modifyMessage(messageId, { removeLabelIds: ['UNREAD'] }).pipe(map(() => undefined));
  }

  /**
   * Mark a message as unread.
   */
  markAsUnread(messageId: string): Observable<void> {
    return this.modifyMessage(messageId, { addLabelIds: ['UNREAD'] }).pipe(map(() => undefined));
  }

  /**
   * Star a message.
   */
  starMessage(messageId: string): Observable<void> {
    return this.modifyMessage(messageId, { addLabelIds: ['STARRED'] }).pipe(map(() => undefined));
  }

  /**
   * Unstar a message.
   */
  unstarMessage(messageId: string): Observable<void> {
    return this.modifyMessage(messageId, { removeLabelIds: ['STARRED'] }).pipe(
      map(() => undefined),
    );
  }

  /**
   * Archive a message (remove from inbox).
   */
  archiveMessage(messageId: string): Observable<void> {
    return this.modifyMessage(messageId, { removeLabelIds: ['INBOX'] }).pipe(map(() => undefined));
  }

  /**
   * Move message to trash.
   */
  trashMessage(messageId: string): Observable<void> {
    return this.request<void>(`/messages/${messageId}/trash`, { method: 'POST' });
  }

  /**
   * Permanently delete a message.
   */
  deleteMessage(messageId: string): Observable<void> {
    return this.request<void>(`/messages/${messageId}`, { method: 'DELETE' });
  }

  /**
   * Get an attachment.
   */
  getAttachment(messageId: string, attachmentId: string): Observable<Blob> {
    return this.request<{ size: number; data: string }>(
      `/messages/${messageId}/attachments/${attachmentId}`,
    ).pipe(
      map((response) => {
        const binaryString = atob(response.data.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes]);
      }),
    );
  }

  /**
   * List all labels.
   */
  listLabels(): Observable<Array<{ id: string; name: string; type: string }>> {
    return this.request<{ labels: Array<{ id: string; name: string; type: string }> }>(
      '/labels',
    ).pipe(map((response) => response.labels || []));
  }

  /**
   * Set up push notifications (watch).
   */
  watch(topicName: string): Observable<{ historyId: string; expiration: string }> {
    return this.request<{ historyId: string; expiration: string }>('/watch', {
      method: 'POST',
      body: JSON.stringify({
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include',
      }),
    });
  }

  /**
   * Stop push notifications.
   */
  stopWatch(): Observable<void> {
    return this.request<void>('/stop', { method: 'POST' });
  }

  /**
   * Make an authenticated request to Gmail API.
   */
  private request<T>(endpoint: string, options: RequestInit = {}): Observable<T> {
    return from(this.authService.getAccessToken()).pipe(
      switchMap((accessToken) =>
        from(
          fetch(`${this.BASE_URL}${endpoint}`, {
            ...options,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              ...options.headers,
            },
          }),
        ),
      ),
      switchMap((response) => {
        if (response.status === 204) {
          return from(Promise.resolve(undefined as unknown as T));
        }
        if (!response.ok) {
          return from(response.json()).pipe(
            switchMap((error: { error?: { message?: string; code?: number } }) => {
              const message = error.error?.message || `Gmail API error: ${response.status}`;
              const code = error.error?.code || response.status;

              // Handle rate limiting
              if (code === 429) {
                return throwError(() => new Error('Rate limited. Please try again later.'));
              }

              // Handle auth errors
              if (code === 401) {
                return throwError(
                  () => new Error('Gmail authentication expired. Please reconnect.'),
                );
              }

              return throwError(() => new Error(message));
            }),
          );
        }
        return from(response.json()) as Observable<T>;
      }),
      // Retry on transient errors (with exponential backoff)
      retry({
        count: 3,
        delay: (error, retryCount) => {
          // Only retry on network errors or 5xx errors
          if (error.message?.includes('fetch') || error.message?.includes('5')) {
            const delayMs = Math.pow(2, retryCount) * 1000;
            return from(new Promise((resolve) => setTimeout(resolve, delayMs)));
          }
          return throwError(() => error);
        },
      }),
    );
  }

  /**
   * Parse a Gmail API message into our CachedEmail format.
   */
  private parseMessage(message: GmailApiMessage): CachedEmail {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string): string => {
      return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    };

    const from = this.parseEmailAddress(getHeader('From'));
    const to = this.parseEmailAddresses(getHeader('To'));
    const cc = this.parseEmailAddresses(getHeader('Cc'));
    const replyTo = getHeader('Reply-To')
      ? this.parseEmailAddress(getHeader('Reply-To'))
      : undefined;

    const { bodyText, bodyHtml, attachments } = this.parsePayload(message.payload);

    const accountEmail = this.authService.connectedEmail() || '';

    return {
      id: message.id,
      threadId: message.threadId,
      accountEmail,
      from,
      to,
      cc: cc.length > 0 ? cc : undefined,
      replyTo,
      subject: getHeader('Subject') || '(no subject)',
      snippet: message.snippet || '',
      bodyText,
      bodyHtml,
      labelIds: message.labelIds || [],
      isRead: !message.labelIds?.includes('UNREAD'),
      isStarred: message.labelIds?.includes('STARRED') || false,
      hasAttachments: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : undefined,
      date: new Date(parseInt(message.internalDate || '0', 10)).toISOString(),
      internalDate: parseInt(message.internalDate || '0', 10),
      cachedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse email address from "Name <email>" format.
   */
  private parseEmailAddress(value: string): EmailAddress {
    const match = value.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
    if (match) {
      return {
        email: match[2].trim(),
        name: match[1]?.trim() || undefined,
      };
    }
    return { email: value.trim() };
  }

  /**
   * Parse comma-separated email addresses.
   */
  private parseEmailAddresses(value: string): EmailAddress[] {
    if (!value) return [];

    // Split by comma, but not commas inside quotes
    const addresses: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of value) {
      if (char === '"') {
        inQuotes = !inQuotes;
      }
      if (char === ',' && !inQuotes) {
        if (current.trim()) addresses.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) addresses.push(current.trim());

    return addresses.map((addr) => this.parseEmailAddress(addr));
  }

  /**
   * Parse message payload to extract body and attachments.
   */
  private parsePayload(payload?: GmailPayload): {
    bodyText?: string;
    bodyHtml?: string;
    attachments: EmailAttachment[];
  } {
    let bodyText: string | undefined;
    let bodyHtml: string | undefined;
    const attachments: EmailAttachment[] = [];

    const processPayload = (part: GmailPayload) => {
      if (part.mimeType === 'text/plain' && part.body?.data && !bodyText) {
        bodyText = this.decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data && !bodyHtml) {
        bodyHtml = this.decodeBase64Url(part.body.data);
      } else if (part.body?.attachmentId && part.filename) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }

      if (part.parts) {
        part.parts.forEach(processPayload);
      }
    };

    if (payload) {
      processPayload(payload);
    }

    return { bodyText, bodyHtml, attachments };
  }

  /**
   * Decode base64url encoded string.
   */
  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    try {
      return decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
    } catch {
      return atob(base64);
    }
  }

  /**
   * Build a raw RFC 2822 email message for sending.
   */
  private buildRawEmail(input: ComposeEmailInput): string {
    const boundary = `----=_Part_${Date.now()}`;
    const lines: string[] = [];

    lines.push(`To: ${input.to.join(', ')}`);
    if (input.cc?.length) lines.push(`Cc: ${input.cc.join(', ')}`);
    if (input.bcc?.length) lines.push(`Bcc: ${input.bcc.join(', ')}`);
    lines.push(`Subject: ${input.subject}`);
    lines.push('MIME-Version: 1.0');

    if (input.threadId) {
      lines.push(`References: <${input.replyToMessageId}>`);
      lines.push(`In-Reply-To: <${input.replyToMessageId}>`);
    }

    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');

    // Plain text version
    const plainText = this.htmlToPlainText(input.body);
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('');
    lines.push(plainText);
    lines.push('');

    // HTML version
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset=UTF-8');
    lines.push('');
    lines.push(input.body);
    lines.push('');

    lines.push(`--${boundary}--`);

    const rawMessage = lines.join('\r\n');
    return btoa(unescape(encodeURIComponent(rawMessage)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Convert HTML to plain text (simple implementation).
   */
  private htmlToPlainText(html: string): string {
    // Create a temporary element to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Replace <br> and block elements with newlines
    temp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    temp.querySelectorAll('p, div').forEach((el) => {
      el.insertAdjacentText('afterend', '\n\n');
    });

    return temp.textContent?.trim() || '';
  }
}
