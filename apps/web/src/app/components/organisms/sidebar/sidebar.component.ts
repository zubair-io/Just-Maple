import {
  Component,
  inject,
  signal,
  computed,
  output,
  input,
  effect,
  OnInit,
  Signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { NotebookService } from '../../../services/notebook.service';
import { PageService } from '../../../services/page.service';
import { MessageService } from '../../../services/message.service';
import { NotificationService } from '../../../services/notification.service';
import { NetworkService } from '../../../services/network.service';
import { ProfileAvatarComponent } from '../../atoms';
import type { Page } from '@maple/shared';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, switchMap } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ProfileAvatarComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly notebookService = inject(NotebookService);
  readonly pageService = inject(PageService);
  readonly messageService = inject(MessageService);
  readonly notificationService = inject(NotificationService);
  readonly networkService = inject(NetworkService);
  readonly route = inject(ActivatedRoute);

  readonly selectedNotebookId = input<string | null>(null);
  readonly selectedPageId = toSignal(this.pageService.activeId$, { initialValue: null });

  readonly newPage = output<void>();
  readonly selectPage = output<string>();
  readonly selectNotebook = output<string>();
  readonly createNotebook = output<void>();
  readonly settings = output<void>();

  readonly searchQuery = signal('');
  readonly expandedNotebooks = signal<Set<string>>(new Set());
  getPagesForNotebook = toSignal(
    this.pageService.pages$.pipe(
      map((pages) => {
        return pages
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .reduce(
            (acc, page) => {
              (acc[page.tagId || 'no_notebook'] ??= []).push(page);
              return acc;
            },
            {} as Record<string, Page[]>,
          );
      }),
    ),
    { initialValue: {} as Record<string, Page[]> },
  );

  constructor() {
    // Auto-expand notebook when selectedNotebookId changes
    effect(() => {
      const notebookId = this.selectedNotebookId();
      if (notebookId) {
        this.expandedNotebooks.update((notebooks) => {
          const newNotebooks = new Set(notebooks);
          newNotebooks.add(notebookId);
          return newNotebooks;
        });
      }
    });
  }

  // Reactive computed signals for user data
  readonly userInitials = computed(() => {
    const user = this.authService.user();
    if (!user) return '?';
    const name = user.displayName || user.email.split('@')[0];
    return name.slice(0, 2).toUpperCase();
  });

  readonly userName = computed(() => {
    const user = this.authService.user();
    if (!user) return 'Guest';
    return user.displayName || user.email.split('@')[0];
  });

  readonly notificationUnreadCount = computed(() => {
    return this.notificationService.unreadCount();
  });

  readonly isOnline = this.networkService.isOnline;

  readonly statusText = computed(() => {
    return this.networkService.isOnline() ? 'Online' : 'Offline';
  });

  readonly statusColor = computed(() => {
    return this.networkService.isOnline() ? 'bg-green-500' : 'bg-gray-400';
  });

  ngOnInit(): void {
    // Load unread counts when sidebar initializes
    this.messageService.loadUnreadCounts().subscribe();
  }

  getUnreadCount(notebookId: string): number {
    return this.messageService.getUnreadCount(notebookId);
  }

  toggleNotebook(notebookId: string): void {
    this.expandedNotebooks.update((notebooks) => {
      const newNotebooks = new Set(notebooks);
      if (newNotebooks.has(notebookId)) {
        newNotebooks.delete(notebookId);
      } else {
        newNotebooks.add(notebookId);
      }
      return newNotebooks;
    });
    this.selectNotebook.emit(notebookId);
    this.router.navigate(['/', notebookId]);
  }

  getPageRouterLink(page: Page, notebookId: string): string[] {
    const urlParam = page.documentId;
    return ['/', notebookId, urlParam];
  }

  onNewPage(): void {
    this.newPage.emit();
  }

  onSelectPage(page: Page, notebookId: string): void {
    // Emit pageId for backward compatibility
    this.selectPage.emit(page._id);
  }

  onCreateNotebook(): void {
    this.createNotebook.emit();
  }

  onSettings(): void {
    this.settings.emit();
  }

  onNotifications(): void {
    this.router.navigate(['/notifications']);
  }
}
