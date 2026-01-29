import { Component, HostListener, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent, SearchModalComponent } from '../../organisms';
import { AppVersionService } from '../../../services/app-version.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, SidebarComponent, SearchModalComponent],
  template: `
    <div class="h-screen flex overflow-hidden bg-[var(--color-bg)]">
      <app-sidebar
        (newPage)="onNewPage()"
        (selectPage)="onSelectPage($event)"
        (selectNotebook)="onSelectNotebook($event)"
        (createNotebook)="onCreateNotebook()"
        (settings)="onSettings()"
      />
      <main class="flex-1 h-full overflow-y-auto flex flex-col relative">
        <ng-content />
      </main>
    </div>

    @if (showSearchModal()) {
      <app-search-modal (closed)="closeSearchModal()" />
    }
  `,
})
export class MainLayoutComponent {
  // Initialize app version service to start version checking
  private readonly appVersionService = inject(AppVersionService);

  readonly showSearchModal = signal(false);

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to open search
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      this.showSearchModal.set(true);
    }
  }

  openSearchModal(): void {
    this.showSearchModal.set(true);
  }

  closeSearchModal(): void {
    this.showSearchModal.set(false);
  }
  onNewPage(): void {
    // TODO: Implement page creation
  }

  onSelectPage(_pageId: string): void {
    // TODO: Navigate to page
  }

  onSelectNotebook(_notebookId: string): void {
    // TODO: Filter by notebook
  }

  onCreateNotebook(): void {
    // TODO: Show notebook creation dialog
  }

  onSettings(): void {
    // TODO: Navigate to settings
  }
}
