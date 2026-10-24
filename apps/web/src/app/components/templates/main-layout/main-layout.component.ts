import { Component, HostListener, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SidebarComponent } from '../../organisms';
import { DialogService } from '../../molecules';
import { UiStateService } from '../../../services/ui-state.service';
import { NotebookService } from '../../../services/notebook.service';
import type { PageType } from '@maple/shared';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, SidebarComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
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
    // Delegate creation to the ':notebookId/new' route (NewNoteComponent), the same
    // path HomeComponent uses — every page route requires a notebookId segment, so
    // there's no route to navigate to when the user has no notebook yet.
    const notebookId = this.selectedNotebookId() ?? this.notebookService.notebooks()[0]?._id;
    if (notebookId) {
      this.router.navigate(['/', notebookId, 'new'], { queryParams: { type } });
    }
  }

  onSelectPage(_pageId: string): void {
    // No-op: the sidebar already navigates via [routerLink] using each page's own
    // notebookId, and highlights the active page from PageService.activeId$ directly.
    // Re-navigating here with this component's separately-tracked selectedNotebookId
    // would risk sending the user to the wrong notebook/page pair.
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
