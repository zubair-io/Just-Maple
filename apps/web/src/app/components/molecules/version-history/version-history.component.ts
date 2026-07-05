import { Component, input, output, signal, inject, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as Y from 'yjs';
import { MemoVersionService, type MemoVersionFull } from '../../../services/memo-version.service';
import type { MemoVersionListItem, VersionTrigger } from '@maple/shared';

@Component({
  selector: 'app-version-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './version-history.component.html',
  styleUrl: './version-history.component.scss',
})
export class VersionHistoryComponent {
  private readonly versionService = inject(MemoVersionService);

  readonly noteId = input.required<string>();
  readonly isOpen = input<boolean>(false);

  readonly close = output<void>();
  readonly restored = output<void>();

  readonly versions = signal<MemoVersionListItem[]>([]);
  readonly isLoading = signal(false);
  readonly isRestoring = signal(false);
  readonly hasMore = signal(false);
  readonly selectedVersionId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  // Preview state
  readonly showPreview = signal(false);
  readonly isLoadingPreview = signal(false);
  readonly previewContent = signal<string | null>(null);
  readonly previewVersion = signal<MemoVersionFull | null>(null);

  readonly selectedVersion = computed(() => {
    const id = this.selectedVersionId();
    if (!id) return null;
    return this.versions().find((v) => v._id === id) ?? null;
  });

  constructor() {
    effect(() => {
      const noteId = this.noteId();
      const open = this.isOpen();
      if (open && noteId) {
        this.loadVersions();
      }
    });
  }

  loadVersions(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.versionService.getVersions(this.noteId()).subscribe({
      next: (response) => {
        this.versions.set(response.versions);
        this.hasMore.set(response.hasMore);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load versions:', err);
        this.error.set('Failed to load version history');
        this.isLoading.set(false);
      },
    });
  }

  loadMore(): void {
    const currentVersions = this.versions();
    if (currentVersions.length === 0 || !this.hasMore()) return;

    const oldestVersion = currentVersions[currentVersions.length - 1];
    const before = new Date(oldestVersion.createdAt);

    this.isLoading.set(true);

    this.versionService.getVersions(this.noteId(), 20, before).subscribe({
      next: (response) => {
        this.versions.update((v) => [...v, ...response.versions]);
        this.hasMore.set(response.hasMore);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  selectVersion(versionId: string): void {
    if (versionId === this.selectedVersionId()) {
      this.selectedVersionId.set(null);
      this.closePreview();
    } else {
      this.selectedVersionId.set(versionId);
      // Auto-open preview when selecting a version
      this.openPreview();
    }
  }

  openPreview(): void {
    const versionId = this.selectedVersionId();
    if (!versionId) return;

    this.showPreview.set(true);
    this.isLoadingPreview.set(true);

    this.versionService.getVersion(this.noteId(), versionId).subscribe({
      next: (version) => {
        this.previewVersion.set(version);
        const html = this.renderVersionAsHtml(version.state);
        // Rely on Angular's default DomSanitizer (applied automatically by [innerHTML])
        // instead of bypassSecurityTrustHtml, which would defeat that protection.
        this.previewContent.set(html);
        this.isLoadingPreview.set(false);
      },
      error: (err) => {
        console.error('Failed to load version preview:', err);
        this.error.set('Failed to load preview');
        this.isLoadingPreview.set(false);
      },
    });
  }

  closePreview(): void {
    this.showPreview.set(false);
    this.previewContent.set(null);
    this.previewVersion.set(null);
  }

  /**
   * Render Y.js state as simple HTML for preview
   */
  private renderVersionAsHtml(base64State: string): string {
    try {
      const binaryString = atob(base64State);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, bytes);

      const fragment = ydoc.getXmlFragment('prosemirror');
      const html = this.xmlFragmentToHtml(fragment);

      ydoc.destroy();
      return html || '<p class="text-[var(--color-text-muted)]">No content</p>';
    } catch (err) {
      console.error('Failed to render version:', err);
      return '<p class="text-red-500">Failed to render content</p>';
    }
  }

  /**
   * Convert Y.js XmlFragment to HTML string
   */
  private xmlFragmentToHtml(fragment: Y.XmlFragment): string {
    const parts: string[] = [];

    fragment.forEach((child) => {
      if (child instanceof Y.XmlText) {
        parts.push(this.escapeHtml(child.toString()));
      } else if (child instanceof Y.XmlElement) {
        parts.push(this.xmlElementToHtml(child));
      }
    });

    return parts.join('');
  }

  /**
   * Convert Y.js XmlElement to HTML string
   */
  private xmlElementToHtml(element: Y.XmlElement): string {
    const nodeName = element.nodeName;
    const attrs = element.getAttributes();

    // Map ProseMirror node types to HTML
    let tagName = 'div';
    let className = '';

    switch (nodeName) {
      case 'paragraph':
        tagName = 'p';
        className = 'mb-2';
        break;
      case 'heading':
        const level = Number(attrs['level']) || 1;
        tagName = `h${level}`;
        className = `font-bold mb-2 ${level === 1 ? 'text-xl' : level === 2 ? 'text-lg' : 'text-base'}`;
        break;
      case 'bulletList':
        tagName = 'ul';
        className = 'list-disc pl-4 mb-2';
        break;
      case 'orderedList':
        tagName = 'ol';
        className = 'list-decimal pl-4 mb-2';
        break;
      case 'listItem':
        tagName = 'li';
        break;
      case 'blockquote':
        tagName = 'blockquote';
        className = 'border-l-4 border-[var(--color-border)] pl-3 italic mb-2';
        break;
      case 'codeBlock':
        tagName = 'pre';
        className =
          'bg-[var(--color-surface-hover)] p-2 rounded text-sm font-mono mb-2 overflow-x-auto';
        break;
      case 'taskList':
        tagName = 'ul';
        className = 'mb-2';
        break;
      case 'taskItem':
        tagName = 'li';
        const checked = attrs['checked'];
        className = checked ? 'line-through opacity-50' : '';
        break;
      case 'hardBreak':
        return '<br>';
      case 'horizontalRule':
        return '<hr class="my-4 border-[var(--color-border)]">';
    }

    // Build children HTML
    const childrenHtml: string[] = [];
    element.forEach((child) => {
      if (child instanceof Y.XmlText) {
        childrenHtml.push(this.escapeHtml(child.toString()));
      } else if (child instanceof Y.XmlElement) {
        childrenHtml.push(this.xmlElementToHtml(child));
      }
    });

    const classAttr = className ? ` class="${className}"` : '';
    return `<${tagName}${classAttr}>${childrenHtml.join('')}</${tagName}>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async restoreVersion(): Promise<void> {
    const versionId = this.selectedVersionId();
    const noteId = this.noteId();
    if (!versionId || this.isRestoring()) return;

    this.isRestoring.set(true);

    this.versionService.restoreVersion(noteId, versionId).subscribe({
      next: async () => {
        // Clear IndexedDB cache for this document before reload
        // This ensures the restored version from server is loaded fresh
        try {
          await this.clearIndexedDBCache(noteId);
        } catch (err) {
          console.warn('Failed to clear IndexedDB cache:', err);
        }

        this.isRestoring.set(false);
        this.restored.emit();
        this.close.emit();
      },
      error: (err) => {
        console.error('Failed to restore version:', err);
        this.error.set('Failed to restore version');
        this.isRestoring.set(false);
      },
    });
  }

  /**
   * Clear IndexedDB cache for a document
   * This ensures restored versions are loaded fresh from server
   */
  private clearIndexedDBCache(noteId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const dbName = `ydoc-${noteId}`;
      const request = indexedDB.deleteDatabase(dbName);

      request.onsuccess = () => {
        console.log(`[VersionHistory] Cleared IndexedDB cache for ${noteId}`);
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };

      request.onblocked = () => {
        console.warn(`[VersionHistory] IndexedDB delete blocked for ${noteId}`);
        resolve(); // Still proceed even if blocked
      };
    });
  }

  formatTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  formatTrigger(trigger: VersionTrigger): string {
    switch (trigger) {
      case 'auto-interval':
        return 'Auto-save';
      case 'auto-idle':
        return 'Auto-save';
      case 'manual':
        return 'Checkpoint';
      case 'ai-edit':
        return 'Before AI edit';
      case 'significant-change':
        return 'Major change';
      case 'import':
        return 'Import';
      default:
        return 'Auto-save';
    }
  }

  getTriggerIcon(trigger: VersionTrigger): string {
    switch (trigger) {
      case 'manual':
        return 'bookmark';
      case 'ai-edit':
        return 'smart_toy';
      case 'significant-change':
        return 'edit_note';
      case 'import':
        return 'upload';
      default:
        return 'schedule';
    }
  }
}
