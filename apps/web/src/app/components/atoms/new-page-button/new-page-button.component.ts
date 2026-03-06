import { Component, input, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import type { PageType } from '@maple/shared';

interface DropdownItem {
  type: PageType;
  icon: string;
  label: string;
}

@Component({
  selector: 'app-new-page-button',
  standalone: true,
  imports: [CommonModule, CdkOverlayOrigin, CdkConnectedOverlay],
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

  readonly dropdownItems: DropdownItem[] = [
    { type: 'memo', icon: 'article', label: 'New Note' },
    { type: 'whiteboard', icon: 'draw', label: 'New Whiteboard' },
    { type: 'json', icon: 'data_object', label: 'New JSON Page' },
    { type: 'canvas', icon: 'dashboard', label: 'New Canvas' },
  ];

  /** CDK overlay positions: below-right, then above-right */
  readonly dropdownPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  createPage(type: PageType = 'memo'): void {
    const notebookId = this.notebookId();
    if (type === 'memo') {
      this.router.navigate(['/', notebookId, 'new']);
    } else {
      this.router.navigate(['/', notebookId, 'new'], { queryParams: { type } });
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
