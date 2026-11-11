import {
  Component,
  inject,
  signal,
  computed,
  ElementRef,
  ViewChild,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FileSystemService } from '../../services/file-system.service';
import { AuthService } from '../../services/auth.service';
import { NativeBridgeService } from '../../services/native-bridge.service';
import { NotebookService } from '../../services/notebook.service';
import { PageService } from '../../services/page.service';
import { MessageService } from '../../services/message.service';
import { DialogService } from '../../components';
import { isLocalNotebook } from '../../providers/data-provider.interface';
import { OpenPagesService } from '../../services/open-pages.service';
import { deviceSourceInfo } from '../../utils/device-sources';
import { getPageTypeIcon, getPageTypeName } from '../../utils/page-types';
import {
  CARD_BAND_CLASS,
  CARD_CLASS,
  CIRCLE_BUTTON_CLASS,
  KICKER_CLASS,
  LIST_ROW_ACTIVE_CLASS,
  LIST_ROW_IDLE_CLASS,
} from '../../utils/shell-classes';
import type { Page } from '@maple/shared';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './welcome.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent {
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  private readonly fsService = inject(FileSystemService);
  private readonly authService = inject(AuthService);
  private readonly nativeBridge = inject(NativeBridgeService);
  readonly notebookService = inject(NotebookService);
  private readonly pageService = inject(PageService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly openPagesService = inject(OpenPagesService);

  readonly isFileSystemSupported = this.fsService.isSupported;
  readonly isAuthenticated = this.authService.isAuthenticated;
  readonly isNativeApp = computed(() => this.nativeBridge.isNativeApp());

  readonly searchQuery = signal<string>('');
  private readonly pinnedIds = signal<Set<string>>(this.loadPinnedIds());

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.searchInput?.nativeElement?.focus();
    }
  }

  private loadPinnedIds(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    const val = localStorage.getItem('maple-pinned-notebooks');
    if (!val) return new Set();
    try {
      return new Set(JSON.parse(val));
    } catch {
      return new Set();
    }
  }

  togglePin(notebookId: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.pinnedIds.update((set) => {
      const next = new Set(set);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('maple-pinned-notebooks', JSON.stringify([...next]));
      }
      return next;
    });
  }

  isPinned(notebookId: string): boolean {
    return this.pinnedIds().has(notebookId);
  }

  readonly kickerClass = KICKER_CLASS;
  readonly circleClass = CIRCLE_BUTTON_CLASS;
  readonly rowIdleClass = LIST_ROW_IDLE_CLASS;
  readonly rowActiveClass = LIST_ROW_ACTIVE_CLASS;
  readonly bandClass = CARD_BAND_CLASS;
  readonly ghostCardClass = `${CARD_CLASS} flex-none w-[440px] max-h-[560px] opacity-55`;

  /** The notebook under the pointer (or keyboard focus). */
  readonly hoveredId = signal<string | null>(null);

  readonly processedNotebooks = computed(() => {
    const all = this.notebookService.notebooks();
    const pages = this.pageService.pages();
    const query = this.searchQuery().trim().toLowerCase();

    const filtered = all.filter((nb) => !query || nb.label.toLowerCase().includes(query));

    return filtered.map((nb) => {
      const pagesCount = pages.filter((p) => p.notebookId === nb._id && !p.isTrashed).length;
      const local = isLocalNotebook(nb._id);
      const icloud = local && this.notebookService.isICloud(nb._id);
      const isPublic = !local && !!nb.sharing?.['isPublic'];
      return {
        ...nb,
        pinned: this.pinnedIds().has(nb._id),
        unreadCount: this.messageService.getUnreadCount(nb._id),
        pagesLabel: pagesCount === 1 ? '1 page' : `${pagesCount} pages`,
        icon: icloud ? 'cloud' : local ? 'folder' : isPublic ? 'public' : 'grid_view',
        group: icloud ? 'iCloud' : local ? 'Local' : isPublic ? 'Public' : 'Maple Cloud',
      };
    });
  });

  /** Pinned first, then where each notebook lives; empty groups are left out. */
  readonly notebookGroups = computed(() => {
    const all = this.processedNotebooks();
    const groups = [
      { label: 'Pinned', notebooks: all.filter((nb) => nb.pinned) },
      ...['Maple Cloud', 'Public', 'iCloud', 'Local'].map((label) => ({
        label,
        notebooks: all.filter((nb) => !nb.pinned && nb.group === label),
      })),
    ];
    return groups.filter((group) => group.notebooks.length > 0);
  });

  /** The notebook whose open pages show on the right: under the pointer, else the first with any. */
  readonly previewNotebookId = computed(() => {
    const hovered = this.hoveredId();
    const all = this.processedNotebooks();
    if (hovered && all.some((nb) => nb._id === hovered)) return hovered;
    return all.find((nb) => this.openPagesService.ids(nb._id).length > 0)?._id ?? null;
  });

  readonly previewPages = computed(() => {
    const notebookId = this.previewNotebookId();
    if (!notebookId) return [];
    const byId = new Map(this.pageService.pages().map((page) => [page.id, page]));
    return this.openPagesService
      .ids(notebookId)
      .map((id) => byId.get(id))
      .filter((page): page is Page => !!page && !page.isTrashed)
      .slice(0, 3)
      .map((page) => ({
        id: page.id,
        title: page.title || 'Untitled',
        typeName: getPageTypeName(page.type),
        icon:
          page.type === 'devicedata' && page.deviceSource
            ? deviceSourceInfo(page.deviceSource).icon
            : getPageTypeIcon(page.type),
      }));
  });

  async onCreateNotebook(): Promise<void> {
    const name = await this.dialogService.prompt({
      title: 'New Notebook',
      message: 'Enter a name for the notebook:',
      placeholder: 'Notebook name',
      confirmLabel: 'Create',
    });
    if (!name) return;

    this.notebookService.createNotebook({ label: name }).subscribe({
      error: (error) => {
        console.error('Failed to create notebook:', error);
      },
    });
  }

  openNotebook(notebookId: string): void {
    this.router.navigate(['/', notebookId]);
  }

  async openFolder(): Promise<void> {
    const folder = await import('rxjs').then(({ firstValueFrom }) =>
      firstValueFrom(this.fsService.openFolderPicker()),
    );

    if (folder) {
      this.router.navigate(['/', folder.id]);
    }
  }
}
