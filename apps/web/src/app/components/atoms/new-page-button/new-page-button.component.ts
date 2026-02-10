import { Component, input, output, signal, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import type { PageType } from '@maple/shared';

@Component({
  selector: 'app-new-page-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './new-page-button.component.html',
  styleUrl: './new-page-button.component.scss',
})
export class NewPageButtonComponent {
  private readonly router = inject(Router);

  /** The notebook ID to create new pages in */
  readonly notebookId = input.required<string>();

  /** Whether to show the "New Conversation" option in the dropdown */
  readonly showConversation = input<boolean>(true);

  /** Whether to show the "New from Template" option in the dropdown */
  readonly showTemplate = input<boolean>(true);

  /** Whether this is a local notebook (only memo supported) */
  readonly isLocal = input<boolean>(false);

  /** Emits when "New from Template" is clicked */
  readonly newFromTemplate = output<void>();

  /** Dropdown state */
  readonly isDropdownOpen = signal(false);

  createPage(type: PageType = 'memo'): void {
    const notebookId = this.notebookId();
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

  onNewFromTemplate(): void {
    this.newFromTemplate.emit();
    this.isDropdownOpen.set(false);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.isDropdownOpen.set(false);
  }
}
