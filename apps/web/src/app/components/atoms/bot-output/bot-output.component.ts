import { Component, input, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import type { BotInvocation } from '@maple/shared';

export interface UIComponent {
  id: string;
  type: 'text' | 'markdown' | 'code' | 'list' | 'status' | 'button' | 'divider' | 'card';
  props?: Record<string, unknown>;
  children?: UIComponent[];
}

@Component({
  selector: 'app-bot-output',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bot-output.component.html',
  styleUrl: './bot-output.component.scss',
})
export class BotOutputComponent {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  readonly invocationId = input.required<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly components = signal<UIComponent[]>([]);
  readonly data = signal<Record<string, unknown>>({});
  readonly rawOutput = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.invocationId();
      if (id) {
        this.loadInvocation(id);
      }
    });
  }

  loadInvocation(id: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<{ invocation: BotInvocation }>(`/api/invocations/${id}`).subscribe({
      next: (response) => {
        const inv = response.invocation;

        // Handle structured output with components
        if (inv.output?.components) {
          this.components.set(inv.output.components as UIComponent[]);
        }

        // Handle raw string output
        if (typeof inv.output === 'string') {
          this.rawOutput.set(inv.output);
        }

        // Store variables for interpolation
        if (inv.variables) {
          this.data.set(inv.variables);
        }

        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load bot response');
        this.loading.set(false);
      },
    });
  }

  interpolate(template: unknown): string {
    if (typeof template !== 'string') {
      return String(template || '');
    }
    const data = this.data();
    return template.replace(/\{\{(\$?\w+(?:\.\w+)*)\}\}/g, (_, path: string) => {
      const parts = path.split('.');
      let value: unknown = data;
      for (const part of parts) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[part];
        } else {
          return '';
        }
      }
      return value !== undefined ? String(value) : '';
    });
  }

  sanitizeHtml(html: unknown): SafeHtml {
    // Basic markdown-to-html conversion for simple cases
    const htmlString = typeof html === 'string' ? html : String(html || '');
    const converted = this.simpleMarkdownToHtml(htmlString);
    return this.sanitizer.bypassSecurityTrustHtml(converted);
  }

  private simpleMarkdownToHtml(text: string): string {
    return (
      text
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Code inline
        .replace(/`(.+?)`/g, '<code>$1</code>')
        // Links
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        // Line breaks
        .replace(/\n/g, '<br>')
    );
  }

  resolveArray(items: unknown): string[] {
    if (Array.isArray(items)) {
      return items.map((item) => String(item));
    }
    if (typeof items === 'string') {
      // Try to parse as JSON array
      try {
        const parsed = JSON.parse(items);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item));
        }
      } catch {
        // Not JSON, return as single item
        return [items];
      }
    }
    return [];
  }

  handleAction(action: unknown): void {
    if (!action || typeof action !== 'object') return;

    const actionObj = action as { type?: string; url?: string; data?: unknown };

    switch (actionObj.type) {
      case 'link':
        if (actionObj.url) {
          window.open(actionObj.url, '_blank', 'noopener');
        }
        break;
      case 'copy':
        if (actionObj.data) {
          navigator.clipboard.writeText(String(actionObj.data));
        }
        break;
      // Add more action types as needed
    }
  }

  getStatusClass(value: unknown): string {
    const status = String(value).toLowerCase();
    if (['success', 'complete', 'done', 'active'].includes(status)) return 'status-success';
    if (['error', 'failed', 'failure'].includes(status)) return 'status-error';
    if (['warning', 'pending', 'processing'].includes(status)) return 'status-warning';
    return 'status-default';
  }
}
