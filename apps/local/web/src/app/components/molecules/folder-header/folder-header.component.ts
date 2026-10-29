import { Component, input, output, inject, TemplateRef, contentChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Folder, FolderMember } from '@maple/shared';
import { NewPageButtonComponent } from '../../atoms/new-page-button/new-page-button.component';
import { UiStateService } from '../../../services/ui-state.service';

@Component({
  selector: 'app-folder-header',
  standalone: true,
  imports: [CommonModule, NewPageButtonComponent],
  templateUrl: './folder-header.component.html',
  styleUrl: './folder-header.component.scss',
})
export class FolderHeaderComponent {
  private readonly uiStateService = inject(UiStateService);

  // Required inputs
  readonly folder = input.required<Folder>();

  // Optional inputs
  readonly members = input<FolderMember[]>([]);
  readonly contextIcon = input<string>('chat'); // Icon for current context
  readonly contextLabel = input<string>('Messages'); // Label for current context
  readonly showNewButton = input<boolean>(true);
  readonly isLocal = input<boolean>(false);

  // Outputs
  readonly shareClicked = output<void>();
  readonly newFromTemplate = output<void>();

  // Content projection for additional actions
  readonly additionalActions = contentChild<TemplateRef<unknown>>('additionalActions');

  openShareModal(): void {
    this.shareClicked.emit();
  }

  openSidebarOnMobile(): void {
    this.uiStateService.openSidebar();
  }

  onNewFromTemplate(): void {
    this.newFromTemplate.emit();
  }
}
