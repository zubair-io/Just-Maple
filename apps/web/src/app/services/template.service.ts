import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import type { Template, Page } from '@maple/shared';

interface TemplatesResponse {
  templates: Template[];
}

interface TemplateResponse {
  template: Template;
}

interface PageResponse {
  page: Page;
}

interface CreateTemplateInput {
  title: string;
  description?: string;
  category?: 'work' | 'personal' | 'planning' | 'custom';
  icon?: string;
  pageId?: string;
  content?: { type: string; content?: any[] };
}

interface UpdateTemplateInput {
  title?: string;
  description?: string;
  category?: 'work' | 'personal' | 'planning' | 'custom';
  icon?: string;
  content?: { type: string; content?: any[] };
}

interface ApplyTemplateInput {
  notebookId: string;
  title?: string;
  notebookName?: string;
}

@Injectable({
  providedIn: 'root',
})
export class TemplateService {
  private readonly http = inject(HttpClient);

  // Reactive state
  readonly templates = signal<Template[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * Fetch all templates (system + user's custom)
   */
  fetchTemplates(): Observable<Template[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<TemplatesResponse>('/api/templates').pipe(
      tap((response) => {
        this.templates.set(response.templates);
        this.isLoading.set(false);
      }),
      map((response) => response.templates),
    );
  }

  /**
   * Get a single template by ID
   */
  getTemplate(id: string): Observable<Template> {
    return this.http
      .get<TemplateResponse>(`/api/templates/${id}`)
      .pipe(map((response) => response.template));
  }

  /**
   * Create a custom template
   */
  createTemplate(data: CreateTemplateInput): Observable<Template> {
    return this.http.post<TemplateResponse>('/api/templates', data).pipe(
      tap((response) => {
        // Add new template to local state
        this.templates.update((templates) => [response.template, ...templates]);
      }),
      map((response) => response.template),
    );
  }

  /**
   * Create a template from an existing page
   */
  createTemplateFromPage(
    pageId: string,
    data: {
      title: string;
      description?: string;
      category?: 'work' | 'personal' | 'planning' | 'custom';
      icon?: string;
    },
  ): Observable<Template> {
    return this.createTemplate({ ...data, pageId });
  }

  /**
   * Update a template
   */
  updateTemplate(id: string, data: UpdateTemplateInput): Observable<Template> {
    return this.http.patch<TemplateResponse>(`/api/templates/${id}`, data).pipe(
      tap((response) => {
        // Update template in local state
        this.templates.update((templates) =>
          templates.map((t) => (t.id === id ? response.template : t)),
        );
      }),
      map((response) => response.template),
    );
  }

  /**
   * Delete a template
   */
  deleteTemplate(id: string): Observable<void> {
    return this.http.delete<{ success: boolean }>(`/api/templates/${id}`).pipe(
      tap(() => {
        // Remove template from local state
        this.templates.update((templates) => templates.filter((t) => t.id !== id));
      }),
      map(() => void 0),
    );
  }

  /**
   * Apply a template to create a new page
   */
  applyTemplate(templateId: string, data: ApplyTemplateInput): Observable<Page> {
    return this.http
      .post<PageResponse>(`/api/templates/${templateId}/apply`, data)
      .pipe(map((response) => response.page));
  }

  /**
   * Get system templates only
   */
  getSystemTemplates(): Template[] {
    return this.templates().filter((t) => t.isSystem);
  }

  /**
   * Get user's custom templates only
   */
  getCustomTemplates(): Template[] {
    return this.templates().filter((t) => !t.isSystem);
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: 'work' | 'personal' | 'planning' | 'custom'): Template[] {
    return this.templates().filter((t) => t.category === category);
  }
}
