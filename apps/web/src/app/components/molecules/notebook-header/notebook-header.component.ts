import {
  Component,
  input,
  output,
  computed,
  inject,
  signal,
  HostListener,
  TemplateRef,
  contentChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import type { Notebook, NotebookMember, PageType } from '@maple/shared';
import { MemberAvatarGroupComponent } from '../member-avatar-group/member-avatar-group.component';
import { UiStateService } from '../../../services/ui-state.service';

@Component({
  selector: 'app-notebook-header',
  standalone: true,
  imports: [CommonModule, MemberAvatarGroupComponent],
  templateUrl: './notebook-header.component.html',
  styleUrl: './notebook-header.component.scss',
})
export class NotebookHeaderComponent {
  private readonly router = inject(Router);
  private readonly uiStateService = inject(UiStateService);

  // Required inputs
  readonly notebook = input.required<Notebook>();

  // Optional inputs
  readonly members = input<NotebookMember[]>([]);
  readonly contextIcon = input<string>('chat'); // Icon for current context
  readonly contextLabel = input<string>('Messages'); // Label for current context
  readonly showNewButton = input<boolean>(true);

  // Outputs
  readonly shareClicked = output<void>();

  // Dropdown state for new page button
  readonly isDropdownOpen = signal(false);

  // Content projection for additional actions
  readonly additionalActions = contentChild<TemplateRef<unknown>>('additionalActions');

  createPage(type: PageType = 'memo'): void {
    const notebookId = this.notebook()._id;
    if (type === 'memo') {
      this.router.navigate(['/', notebookId, 'new']);
    } else {
      this.router.navigate(['/', notebookId, 'new'], { queryParams: { type } });
    }
    this.isDropdownOpen.set(false);
  }

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.isDropdownOpen.update((open) => !open);
  }

  openShareModal(): void {
    this.shareClicked.emit();
  }

  openSidebarOnMobile(): void {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      this.uiStateService.openSidebar();
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.isDropdownOpen.set(false);
  }
}
