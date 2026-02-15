import { Component, computed, inject, signal, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription, firstValueFrom } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { JsonDocumentService } from '../../services/json-document.service';
import { NoteHeaderComponent } from '../../components';
import { JsonCodeEditorComponent } from '../../components/organisms/json-code-editor/json-code-editor.component';
import { JsonFormBuilderComponent } from '../../components/organisms/json-form-builder/json-form-builder.component';

type ViewMode = 'code' | 'form' | 'split';

@Component({
  selector: 'app-json-view',
  standalone: true,
  imports: [CommonModule, NoteHeaderComponent, JsonCodeEditorComponent, JsonFormBuilderComponent],
  templateUrl: './json-view.component.html',
  styleUrl: './json-view.component.scss',
})
export class JsonViewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  private readonly jsonDocService = inject(JsonDocumentService);

  private routeSubscription?: Subscription;

  readonly pageId = signal<string | null>(null);
  readonly notebookId = signal<string | null>(null);
  readonly viewMode = signal<ViewMode>('split');
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);

  // JSON document state
  readonly data = signal<unknown>({});
  readonly schema = signal<unknown | null>(null);
  readonly version = signal(0);

  // Page and notebook from store
  readonly selectedPage = toSignal(this.pageService.activePage$, { initialValue: null });
  readonly selectedNotebook = toSignal(this.notebookService.activeNotebook$, {
    initialValue: null,
  });

  constructor() {
    this.routeSubscription = this.route.params.subscribe((params) => {
      const id = params['id'] || null;
      const notebookId = params['notebookId'] || null;
      this.pageId.set(id);
      this.notebookId.set(notebookId);
      if (id) {
        this.loadDocument(id);
      }
    });
  }

  private async loadDocument(pageId: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const doc = await firstValueFrom(this.jsonDocService.fetchDocument(pageId));
      this.data.set(doc.data);
      this.schema.set(doc.schema);
      this.version.set(doc.version);
    } catch (err) {
      console.error('[JsonView] Failed to load document:', err);
      this.error.set('Failed to load JSON document');
    } finally {
      this.isLoading.set(false);
    }
  }

  async onDataChange(newData: unknown): Promise<void> {
    const pageId = this.pageId();
    if (!pageId) return;

    this.isSaving.set(true);
    this.error.set(null);

    try {
      const doc = await firstValueFrom(
        this.jsonDocService.replaceData(pageId, newData, this.version()),
      );
      this.data.set(doc.data);
      this.version.set(doc.version);
    } catch (err: any) {
      if (err?.status === 409) {
        this.error.set('Version conflict. Refreshing...');
        await this.loadDocument(pageId);
      } else if (err?.status === 422) {
        this.error.set('Data does not match schema');
      } else {
        this.error.set('Failed to save');
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  async onSchemaChange(newSchema: unknown): Promise<void> {
    const pageId = this.pageId();
    if (!pageId) return;

    try {
      const doc = await firstValueFrom(this.jsonDocService.setSchema(pageId, newSchema));
      this.schema.set(doc.schema);
    } catch {
      this.error.set('Failed to save schema');
    }
  }

  async removeSchema(): Promise<void> {
    const pageId = this.pageId();
    if (!pageId) return;

    try {
      await firstValueFrom(this.jsonDocService.removeSchema(pageId));
      this.schema.set(null);
    } catch {
      this.error.set('Failed to remove schema');
    }
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  toggleFavorite(): void {
    const page = this.selectedPage();
    if (!page) return;
    this.pageService.updatePage(page.id, { isFavorite: !page.isFavorite }).subscribe();
  }

  onTitleChanged(title: string): void {
    const page = this.selectedPage();
    if (!page) return;
    this.pageService.updatePage(page.id, { title }).subscribe();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    const pageId = this.pageId();
    if (pageId) {
      this.jsonDocService.clearCache(pageId);
    }
  }
}
