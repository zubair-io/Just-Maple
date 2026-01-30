import { Component, input, output, inject, TemplateRef, contentChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Notebook, NotebookMember } from '@maple/shared';
import { MemberAvatarGroupComponent } from '../member-avatar-group/member-avatar-group.component';
import { NewPageButtonComponent } from '../../atoms/new-page-button/new-page-button.component';
import { UiStateService } from '../../../services/ui-state.service';

@Component({
  selector: 'app-notebook-header',
  standalone: true,
  imports: [CommonModule, MemberAvatarGroupComponent, NewPageButtonComponent],
  templateUrl: './notebook-header.component.html',
  styleUrl: './notebook-header.component.scss',
})
export class NotebookHeaderComponent {
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
    this.uiStateService.openTemplateGallery();
    this.newFromTemplate.emit();
  }
}
