import { Component, HostListener, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SidebarComponent } from '../../organisms';
import { DialogService } from '../../molecules';
import { UiStateService } from '../../../services/ui-state.service';
import { NotebookService } from '../../../services/notebook.service';
import { PageService } from '../../../services/page.service';
import type { PageType } from '@maple/shared';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, SidebarComponent],
  template: `
    <div class="h-screen flex overflow-hidden bg-[var(--color-bg)]">
      <app-sidebar
        [selectedNotebookId]="selectedNotebookId()"
        (newPage)="onNewPage($event)"
        (selectPage)="onSelectPage($event)"
        (selectNotebook)="onSelectNotebook($event)"
        (createNotebook)="onCreateNotebook()"
        (settings)="onSettings()"
      />
      <main class="flex-1 h-full overflow-y-auto flex flex-col relative">
        <ng-content />
      </main>
    </div>
  `,
})
export class MainLayoutComponent {
  private readonly uiStateService = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly notebookService = inject(NotebookService);
  private readonly pageService = inject(PageService);
  private readonly dialogService = inject(DialogService);

  readonly selectedNotebookId = signal<string | null>(null);

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to open search
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.uiStateService.openSearchModal();
    }
  }

  openSearchModal(): void {
    this.uiStateService.openSearchModal();
  }

  onNewPage(type: PageType = 'memo'): void {
    const notebookId = this.selectedNotebookId() ?? this.notebookService.notebooks()[0]?._id;
    const id = crypto.randomUUID();
    this.pageService
      .createPage({
        id,
        title: 'Untitled',
        content: { type: 'doc', content: [] },
        notebookId: notebookId || undefined,
        type,
      })
      .subscribe({
        next: (page) => {
          if (notebookId) {
            this.router.navigate(['/', notebookId, page.id]);
          } else {
            this.router.navigate(['/', page.id]);
          }
        },
        error: (error) => {
          console.error('Failed to create page:', error);
        },
      });
  }

  onSelectPage(pageId: string): void {
    const notebookId = this.selectedNotebookId();
    if (notebookId) {
      this.router.navigate(['/', notebookId, pageId]);
    } else {
      this.router.navigate(['/', pageId]);
    }
  }

  onSelectNotebook(notebookId: string): void {
    this.selectedNotebookId.set(notebookId);
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
      next: (notebook) => {
        this.selectedNotebookId.set(notebook._id);
      },
      error: (error) => {
        console.error('Failed to create notebook:', error);
      },
    });
  }

  onSettings(): void {
    this.router.navigate(['/settings']);
  }
}
