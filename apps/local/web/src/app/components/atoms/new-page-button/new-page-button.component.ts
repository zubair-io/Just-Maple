import { Component, input, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import type { ConnectedPosition } from '@angular/cdk/overlay';
import type { PageType } from '@maple/shared';

interface DropdownItem {
  type: PageType;
  icon: string;
  label: string;
}

@Component({
  selector: 'app-new-page-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './new-page-button.component.html',
  styleUrl: './new-page-button.component.scss',
})
export class NewPageButtonComponent {
  private readonly router = inject(Router);

  /** The folder ID to create new pages in */
  readonly folderId = input.required<string>();

  /** Whether to show the "New Conversation" option in the dropdown */
  readonly showConversation = input<boolean>(true);

  /** Whether to show the "New from Template" option in the dropdown */
  readonly showTemplate = input<boolean>(true);

  /** Whether this is a local folder (only memo supported) */
  readonly isLocal = input<boolean>(false);

  /** Emits when "New from Template" is clicked */
  readonly newFromTemplate = output<void>();

  /** Dropdown state */
  readonly isDropdownOpen = signal(false);

  readonly dropdownItems: DropdownItem[] = [{ type: 'memo', icon: 'article', label: 'New Note' }];

  /** CDK overlay positions: below-right, then above-right */
  readonly dropdownPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  createPage(type: PageType = 'memo'): void {
    const folderId = this.folderId();
    if (type === 'memo') {
      this.router.navigate(['/', folderId, 'new']);
    } else {
      this.router.navigate(['/', folderId, 'new'], { queryParams: { type } });
    }
    this.isDropdownOpen.set(false);
  }

  toggleDropdown(): void {
    this.isDropdownOpen.update((open) => !open);
  }

  onNewFromTemplate(): void {
    this.newFromTemplate.emit();
    this.isDropdownOpen.set(false);
  }
}
