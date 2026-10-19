import { AppHeaderComponent } from '../../components/organisms/app-header/app-header.component';
import {
  Component,
  inject,
  signal,
  computed,
  ElementRef,
  ViewChild,
  HostListener,
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

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, AppHeaderComponent, FormsModule, RouterLink],
  templateUrl: './welcome.component.html',
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

  readonly processedNotebooks = computed(() => {
    const all = this.notebookService.notebooks();
    const pages = this.pageService.pages();
    const query = this.searchQuery().trim().toLowerCase();

    const filtered = all.filter((nb) => !query || nb.label.toLowerCase().includes(query));

    return filtered.map((nb) => {
      const nbPages = pages.filter((p) => p.notebookId === nb._id);
      const uniqueTypes = [...new Set(nbPages.map((p) => p.type))];
      const unreadCount = this.messageService.getUnreadCount(nb._id);
      const pinned = this.pinnedIds().has(nb._id);

      let activity = 'recently';
      if (nb.updatedAt) {
        activity = this.formatTimeAgo(new Date(nb.updatedAt));
      }

      return {
        ...nb,
        pinned,
        unreadCount,
        pageTypes: uniqueTypes,
        pagesCount: nbPages.length,
        activity,
      };
    });
  });

  readonly groupedNotebooks = computed(() => {
    const all = this.processedNotebooks();
    return {
      pinned: all.filter((nb) => nb.pinned),
      public: all.filter(
        (nb) => !nb.pinned && !isLocalNotebook(nb._id) && nb.sharing?.['isPublic'],
      ),
      cloud: all.filter(
        (nb) => !nb.pinned && !isLocalNotebook(nb._id) && !nb.sharing?.['isPublic'],
      ),
      icloud: all.filter(
        (nb) => !nb.pinned && isLocalNotebook(nb._id) && this.notebookService.isICloud(nb._id),
      ),
      local: all.filter(
        (nb) => !nb.pinned && isLocalNotebook(nb._id) && !this.notebookService.isICloud(nb._id),
      ),
    };
  });

  getPageTypeIcon(type: string): string {
    switch (type) {
      case 'collectable':
        return 'brick';
      case 'memo':
        return 'description';
      case 'whiteboard':
        return 'draw';
      case 'kanban':
        return 'view_kanban';
      case 'message':
        return 'chat';
      case 'json':
        return 'data_object';
      case 'canvas':
        return 'dashboard';
      default:
        return 'article';
    }
  }

  getPageTypeLabel(type: string): string {
    switch (type) {
      case 'collectable':
        return 'Collectible';
      case 'memo':
        return 'Note';
      case 'whiteboard':
        return 'Whiteboard';
      case 'kanban':
        return 'Kanban';
      case 'message':
        return 'Chat';
      case 'json':
        return 'JSON';
      case 'canvas':
        return 'Canvas';
      default:
        return 'Page';
    }
  }

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

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
}
