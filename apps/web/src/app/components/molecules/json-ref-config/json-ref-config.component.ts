import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageService } from '../../../services/page.service';
import { JsonDocumentService } from '../../../services/json-document.service';
import { firstValueFrom } from 'rxjs';
import type { Page } from '@maple/shared';

export interface JsonRefConfig {
  pageId: string;
  path: string;
  label: string;
}

export interface JsonLoopConfig {
  pageId: string;
  arrayPath: string;
  template: string;
  renderAs: 'list' | 'table';
  columns: string | null;
}

/**
 * JSON Reference Configuration Modal
 * Used to configure JSON data references and loop blocks in the editor.
 * Shows a page selector and data tree browser.
 */
@Component({
  selector: 'app-json-ref-config',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './json-ref-config.component.html',
  styleUrl: './json-ref-config.component.scss',
})
export class JsonRefConfigComponent implements OnInit {
  readonly mode = input<'ref' | 'loop'>('ref');
  readonly notebookId = input<string | null>(null);
  readonly initialConfig = input<Partial<JsonRefConfig & JsonLoopConfig> | null>(null);

  readonly confirmed = output<JsonRefConfig | JsonLoopConfig>();
  readonly cancelled = output<void>();

  private readonly pageService = inject(PageService);
  private readonly jsonDocService = inject(JsonDocumentService);

  readonly jsonPages = signal<Page[]>([]);
  readonly selectedPageId = signal<string | null>(null);
  readonly dataTree = signal<TreeNode[]>([]);
  readonly selectedPath = signal('');
  readonly isLoading = signal(false);

  // Loop mode settings
  readonly renderAs = signal<'list' | 'table'>('table');
  readonly template = signal('');
  readonly columns = signal<string>('');

  async ngOnInit(): Promise<void> {
    // Load JSON pages in the notebook
    const pages = this.pageService.pages();
    this.jsonPages.set(pages.filter((p) => p.type === 'json'));

    // Pre-select if editing existing
    const config = this.initialConfig();
    if (config?.pageId) {
      this.selectedPageId.set(config.pageId);
      await this.loadPageData(config.pageId);
      if (config.path) this.selectedPath.set(config.path);
      if (config.arrayPath) this.selectedPath.set(config.arrayPath);
      if (config.renderAs) this.renderAs.set(config.renderAs);
      if (config.template) this.template.set(config.template);
      if (config.columns) this.columns.set(config.columns);
    }
  }

  async onPageSelect(event: Event): Promise<void> {
    const pageId = (event.target as HTMLSelectElement).value;
    this.selectedPageId.set(pageId);
    this.selectedPath.set('');
    if (pageId) {
      await this.loadPageData(pageId);
    } else {
      this.dataTree.set([]);
    }
  }

  private async loadPageData(pageId: string): Promise<void> {
    this.isLoading.set(true);
    try {
      const doc = await firstValueFrom(this.jsonDocService.fetchDocument(pageId));
      this.dataTree.set(buildTree(doc.data, ''));
    } catch {
      this.dataTree.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  selectPath(path: string): void {
    this.selectedPath.set(path);
  }

  confirm(): void {
    const pageId = this.selectedPageId();
    if (!pageId) return;

    if (this.mode() === 'loop') {
      this.confirmed.emit({
        pageId,
        arrayPath: this.selectedPath(),
        template: this.template(),
        renderAs: this.renderAs(),
        columns: this.columns() || null,
      } satisfies JsonLoopConfig);
    } else {
      this.confirmed.emit({
        pageId,
        path: this.selectedPath(),
        label: this.selectedPath().split('.').pop() || '',
      } satisfies JsonRefConfig);
    }
  }

  cancel(): void {
    this.cancelled.emit();
  }
}

// ============================================
// Tree building helpers
// ============================================

interface TreeNode {
  key: string;
  path: string;
  type: string;
  children?: TreeNode[];
  isArray?: boolean;
}

function buildTree(data: unknown, parentPath: string, depth = 0): TreeNode[] {
  if (depth > 8) return [];
  if (data === null || data === undefined || typeof data !== 'object') return [];

  if (Array.isArray(data)) {
    return data.map((item, index) => {
      const path = parentPath ? `${parentPath}[${index}]` : `[${index}]`;
      return {
        key: `[${index}]`,
        path,
        type: getTypeLabel(item),
        children:
          typeof item === 'object' && item !== null ? buildTree(item, path, depth + 1) : undefined,
        isArray: Array.isArray(item),
      };
    });
  }

  return Object.entries(data as Record<string, unknown>).map(([key, value]) => {
    const path = parentPath ? `${parentPath}.${key}` : key;
    return {
      key,
      path,
      type: getTypeLabel(value),
      children:
        typeof value === 'object' && value !== null ? buildTree(value, path, depth + 1) : undefined,
      isArray: Array.isArray(value),
    };
  });
}

function getTypeLabel(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  const t = typeof value;
  if (t === 'object') return `object{${Object.keys(value as object).length}}`;
  return t;
}
