import { Injectable, inject, signal } from '@angular/core';
import { Dialog, type DialogRef } from '@angular/cdk/dialog';
import type { TemplateGalleryDialogResult } from '../components/organisms/template-gallery-modal/template-gallery-modal.component';
import { NativeBridgeService } from './native-bridge.service';

/**
 * Options for opening the search modal with pre-configured state
 */
export interface SearchModalOptions {
  /** Initial search query */
  query?: string;
  /** Filter by tag name */
  tag?: string;
  /** Filter by notebook ID */
  notebookId?: string;
}

/**
 * Simple service for UI state that needs to be shared across components.
 */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  private readonly cdkDialog = inject(Dialog);
  private readonly nativeBridge = inject(NativeBridgeService);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private searchDialogRef: DialogRef<unknown, any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private templateGalleryDialogRef: DialogRef<unknown, any> | null = null;

  /** Signal indicating if a chat/message input is focused */
  readonly chatInputFocused = signal(false);

  /** Signal to trigger barcode scanner from footer */
  readonly showScanner = signal(false);

  /** Signal for sidebar open state (mobile) */
  readonly sidebarOpen = signal(false);

  /** Signal to show template gallery modal */
  readonly showTemplateGallery = signal(false);

  /** Signal to show search modal */
  readonly showSearchModal = signal(false);

  /** Signal for search modal initial options */
  readonly searchModalOptions = signal<SearchModalOptions | null>(null);

  setChatInputFocused(focused: boolean): void {
    this.chatInputFocused.set(focused);
  }

  openScanner(): void {
    this.showScanner.set(true);
  }

  closeScanner(): void {
    this.showScanner.set(false);
  }

  toggleSidebar(): void {
    if (this.nativeBridge.hasNativeSidebar()) {
      console.log('[UiState] toggleSidebar → native bridge');
      this.nativeBridge.toggleNativeSidebar();
      return;
    }
    console.log('[UiState] toggleSidebar → web sidebar');
    this.sidebarOpen.update((open) => !open);
  }

  openSidebar(): void {
    if (this.nativeBridge.hasNativeSidebar()) {
      console.log('[UiState] openSidebar → native bridge');
      this.nativeBridge.toggleNativeSidebar();
      return;
    }
    console.log('[UiState] openSidebar → web sidebar');
    this.sidebarOpen.set(true);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  async openTemplateGallery(data: {
    notebookId: string;
    notebookName: string;
  }): Promise<TemplateGalleryDialogResult | undefined> {
    if (this.templateGalleryDialogRef) return undefined;

    const { TemplateGalleryModalComponent } =
      await import('../components/organisms/template-gallery-modal/template-gallery-modal.component');

    const dialogRef = this.cdkDialog.open(TemplateGalleryModalComponent, {
      data,
      hasBackdrop: true,
      backdropClass: 'cdk-dialog-backdrop',
      panelClass: 'cdk-template-gallery-panel',
      autoFocus: false,
    });
    this.templateGalleryDialogRef = dialogRef;
    this.showTemplateGallery.set(true);

    return new Promise<TemplateGalleryDialogResult | undefined>((resolve) => {
      dialogRef.closed.subscribe((result) => {
        this.templateGalleryDialogRef = null;
        this.showTemplateGallery.set(false);
        resolve(result as TemplateGalleryDialogResult | undefined);
      });
    });
  }

  closeTemplateGallery(): void {
    this.templateGalleryDialogRef?.close();
    this.templateGalleryDialogRef = null;
    this.showTemplateGallery.set(false);
  }

  async openSearchModal(options?: SearchModalOptions): Promise<void> {
    if (this.searchDialogRef) return;
    this.searchModalOptions.set(options || null);

    const { SearchModalComponent } =
      await import('../components/organisms/search-modal/search-modal.component');

    const dialogRef = this.cdkDialog.open(SearchModalComponent, {
      data: options || null,
      hasBackdrop: true,
      backdropClass: 'cdk-dialog-backdrop',
      panelClass: 'cdk-search-modal-panel',
      autoFocus: false,
    });
    this.searchDialogRef = dialogRef;

    dialogRef.closed.subscribe(() => {
      this.searchDialogRef = null;
      this.searchModalOptions.set(null);
      this.showSearchModal.set(false);
    });
    this.showSearchModal.set(true);
  }

  closeSearchModal(): void {
    this.searchDialogRef?.close();
    this.searchDialogRef = null;
    this.showSearchModal.set(false);
    this.searchModalOptions.set(null);
  }
}
