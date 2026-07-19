import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, tap } from 'rxjs';
import { PageService } from '../../services/page.service';
import { NotebookService } from '../../services/notebook.service';
import { GmailAuthService } from '../../services/gmail/gmail-auth.service';
import { GmailStorageService } from '../../services/gmail/gmail-storage.service';
import { GmailSyncService } from '../../services/gmail/gmail-sync.service';
import { GmailApiService } from '../../services/gmail/gmail-api.service';
import type { CachedEmail, GmailFilter } from '@maple/shared';

@Component({
  selector: 'app-gmail-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gmail-view.component.html',
  styleUrl: './gmail-view.component.scss',
})
export class GmailViewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly pageService = inject(PageService);
  private readonly notebookService = inject(NotebookService);
  readonly authService = inject(GmailAuthService);
  readonly storageService = inject(GmailStorageService);
  readonly syncService = inject(GmailSyncService);
  private readonly apiService = inject(GmailApiService);

  private routeSubscription?: Subscription;

  // Route params
  readonly selectedNotebookId = signal<string | null>(null);
  readonly selectedPageId = signal<string | null>(null);

  // UI state
  readonly selectedEmailId = signal<string | null>(null);
  readonly activeFilterId = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly showSettings = signal(false);
  readonly showCompose = signal(false);

  // Compose state
  readonly composeTo = signal<string[]>([]);
  readonly composeCc = signal<string[]>([]);
  readonly composeSubject = signal('');
  readonly composeBody = signal('');
  readonly replyToEmail = signal<CachedEmail | null>(null);

  // Computed
  readonly selectedNotebook = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return null;
    return this.notebookService.notebooks().find((n) => n._id === notebookId) || null;
  });

  readonly selectedPage = computed(() => {
    const pageId = this.selectedPageId();
    if (!pageId) return null;
    return this.pageService.pages().find((p) => p.id === pageId) || null;
  });

  readonly filters = computed((): GmailFilter[] => {
    const page = this.selectedPage();
    const defaultFilter: GmailFilter = {
      id: 'all',
      name: 'All Mail',
      type: 'all',
      value: '',
      icon: 'all_inbox',
    };
    return [defaultFilter, ...(page?.gmailConfig?.filters || [])];
  });

  readonly activeFilter = computed(() => {
    const filterId = this.activeFilterId();
    return this.filters().find((f) => f.id === filterId) || this.filters()[0];
  });

  readonly filteredEmails = computed(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery().trim();

    let emails = filter
      ? this.storageService.getFilteredEmails(filter)
      : this.storageService.emails();

    if (query) {
      emails = this.storageService.searchEmails(query);
    }

    return emails;
  });

  readonly selectedEmail = computed(() => {
    const emailId = this.selectedEmailId();
    if (!emailId) return null;
    return this.storageService.getEmail(emailId) || null;
  });

  readonly threadEmails = computed(() => {
    const email = this.selectedEmail();
    if (!email) return [];
    return this.storageService.getEmailsByThread(email.threadId);
  });

  constructor() {
    // Initialize storage on component load
    effect(() => {
      if (this.authService.isConnected()) {
        this.storageService.initialize();
      }
    });
  }

  ngOnInit(): void {
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedNotebookId.set(params['notebookId'] || null);
      this.selectedPageId.set(params['id'] || null);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  // Actions
  connectGmail(): void {
    this.authService
      .authenticate()
      .pipe(
        tap(({ email }) => console.log('Connected to Gmail:', email)),
        switchMap(() => this.syncService.initialSync()),
      )
      .subscribe({
        error: (err) => {
          console.error('Gmail connection failed:', err);
        },
      });
  }

  async disconnectGmail(): Promise<void> {
    await this.authService.disconnect();
  }

  refreshEmails(): void {
    this.syncService.refresh().subscribe();
  }

  selectEmail(email: CachedEmail): void {
    this.selectedEmailId.set(email.id);

    // Mark as read if unread
    if (!email.isRead) {
      this.syncService.markAsRead(email.id).subscribe();
    }
  }

  selectFilter(filter: GmailFilter): void {
    this.activeFilterId.set(filter.id);
    this.selectedEmailId.set(null);
  }

  toggleStar(email: CachedEmail, event: Event): void {
    event.stopPropagation();
    if (email.isStarred) {
      this.syncService.unstarMessage(email.id).subscribe();
    } else {
      this.syncService.starMessage(email.id).subscribe();
    }
  }

  archiveEmail(email: CachedEmail): void {
    this.syncService.archiveMessage(email.id).subscribe(() => {
      this.selectedEmailId.set(null);
    });
  }

  trashEmail(email: CachedEmail): void {
    this.syncService.trashMessage(email.id).subscribe(() => {
      this.selectedEmailId.set(null);
    });
  }

  markAsUnread(email: CachedEmail): void {
    this.syncService.markAsUnread(email.id).subscribe();
  }

  // Compose
  openCompose(): void {
    this.resetCompose();
    this.showCompose.set(true);
  }

  openReply(email: CachedEmail, replyAll = false): void {
    this.resetCompose();
    this.replyToEmail.set(email);
    this.composeTo.set([email.from.email]);
    if (replyAll && email.cc) {
      this.composeCc.set(email.cc.map((a) => a.email));
    }
    this.composeSubject.set(
      email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
    );
    this.showCompose.set(true);
  }

  closeCompose(): void {
    this.showCompose.set(false);
    this.resetCompose();
  }

  private resetCompose(): void {
    this.composeTo.set([]);
    this.composeCc.set([]);
    this.composeSubject.set('');
    this.composeBody.set('');
    this.replyToEmail.set(null);
  }

  sendEmail(): void {
    const reply = this.replyToEmail();
    this.apiService
      .sendEmail({
        to: this.composeTo(),
        cc: this.composeCc().length > 0 ? this.composeCc() : undefined,
        subject: this.composeSubject(),
        body: this.composeBody(),
        replyToMessageId: reply?.id,
        threadId: reply?.threadId,
      })
      .subscribe({
        next: () => {
          this.closeCompose();
          this.syncService.refresh().subscribe();
        },
        error: (err) => {
          console.error('Failed to send email:', err);
        },
      });
  }

  // Settings
  openSettings(): void {
    this.showSettings.set(true);
  }

  closeSettings(): void {
    this.showSettings.set(false);
  }

  // Download attachment
  downloadAttachment(messageId: string, attachmentId: string, filename: string): void {
    this.apiService.getAttachment(messageId, attachmentId).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // Format helpers
  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  formatFullDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString([], {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatSender(email: CachedEmail): string {
    return email.from.name || email.from.email;
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  trackByEmailId(index: number, email: CachedEmail): string {
    return email.id;
  }

  trackByFilterId(index: number, filter: GmailFilter): string {
    return filter.id;
  }

  // Email list parsing helpers (for template)
  updateComposeTo(value: string): void {
    this.composeTo.set(this.parseEmailList(value));
  }

  updateComposeCc(value: string): void {
    this.composeCc.set(this.parseEmailList(value));
  }

  private parseEmailList(value: string): string[] {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
