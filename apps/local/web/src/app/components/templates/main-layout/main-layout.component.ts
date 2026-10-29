import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../../organisms/sidebar/sidebar.component';
import { UiStateService } from '../../../services/ui-state.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, SidebarComponent],
  templateUrl: './main-layout.component.html',
})
export class MainLayoutComponent {
  private readonly uiStateService = inject(UiStateService);

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Cmd+K (Mac) or Ctrl+K (Windows/Linux) to open search
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      // Search modal not yet implemented
    }
  }

  openSearchModal(): void {
    // Search modal not yet implemented
  }

  onNewPage(): void {
    // TODO: Implement page creation
  }

  onSelectPage(_pageId: string): void {
    // TODO: Navigate to page
  }

  onSelectFolder(_folderId: string): void {
    // TODO: Filter by folder
  }

  onCreateFolder(): void {
    // TODO: Show folder creation dialog
  }

  onSettings(): void {
    // TODO: Navigate to settings
  }
}
