import {
  Component,
  inject,
  signal,
  computed,
  output,
  input,
  AfterViewChecked,
  ElementRef,
  ViewChildren,
  QueryList,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { BreakpointObserver } from '@angular/cdk/layout';
import type { ConnectedPosition } from '@angular/cdk/overlay';
import { FolderService } from '../../../services/folder.service';
import { PageService } from '../../../services/page.service';
import { NativeBridgeService } from '../../../services/native-bridge.service';
import { isLocalFolder } from '../../../providers/data-provider.interface';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, switchMap, filter, EMPTY } from 'rxjs';

interface Page {
  _id: string;
  id: string;
  userId: string;
  type: string;
  title: string;
  content: any;
  folderId?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  isTrashed?: boolean;
  createdAt: string;
  updatedAt: string;
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, DragDropModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements AfterViewChecked {
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);

  @ViewChildren('editInput') editInputs!: QueryList<ElementRef<HTMLInputElement>>;
  private shouldFocusInput = false;
  readonly folderService = inject(FolderService);
  readonly pageService = inject(PageService);
  private readonly nativeBridge = inject(NativeBridgeService);
  readonly isNativeApp = computed(() => this.nativeBridge.isNativeApp());

  readonly selectedFolderId = input<string | null>(null);
  readonly selectedPageId = toSignal(this.pageService.activeId$, { initialValue: null });

  readonly newPage = output<'memo'>();
  readonly selectPage = output<string>();
  readonly selectFolder = output<string>();
  readonly settings = output<void>();

  readonly expandedFolders = signal<Set<string>>(new Set());
  readonly isNewDropdownOpen = signal(false);
  readonly newDropdownPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  ];
  readonly dragHoverFolderId = signal<string | null>(null);
  readonly isSelectedFolderLocal = computed(() => isLocalFolder(this.selectedFolderId() ?? ''));

  readonly isMobile = toSignal(
    this.breakpointObserver.observe('(max-width: 767px)').pipe(map((result) => result.matches)),
    { initialValue: typeof window !== 'undefined' && window.innerWidth < 768 },
  );

  // Inline editing state
  readonly editingFolderId = signal<string | null>(null);
  readonly editingPageId = signal<string | null>(null);
  readonly editValue = signal<string>('');
  readonly isCreatingICloudFolder = signal(false);
  private iCloudFolderCreationTime = 0;
  getPagesForFolder = toSignal(
    this.pageService.pages$.pipe(
      map((pages) => {
        return pages
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .reduce(
            (acc, page) => {
              (acc[page.folderId || 'no_folder'] ??= []).push(page as unknown as Page);
              return acc;
            },
            {} as Record<string, Page[]>,
          );
      }),
    ),
    { initialValue: {} as Record<string, Page[]> },
  );

  // Auto-expand selected folder and load its pages
  private readonly _autoExpandFolder = toSignal(
    toObservable(this.selectedFolderId).pipe(
      filter((id): id is string => !!id),
      switchMap((folderId) => {
        this.expandedFolders.update((folders) => {
          const newFolders = new Set(folders);
          newFolders.add(folderId);
          return newFolders;
        });
        if (isLocalFolder(folderId)) {
          return this.pageService.loadLocalPages(folderId);
        }
        return EMPTY;
      }),
    ),
  );

  readonly groupedFolders = computed(() => {
    const all = this.folderService.folders();
    return {
      icloud: all.filter((nb) => isLocalFolder(nb._id) && this.folderService.isICloud(nb._id)),
      local: all.filter((nb) => isLocalFolder(nb._id) && !this.folderService.isICloud(nb._id)),
    };
  });

  ngAfterViewChecked(): void {
    if (this.shouldFocusInput && this.editInputs.length > 0) {
      const input = this.editInputs.first.nativeElement;
      input.focus();
      input.select();
      this.shouldFocusInput = false;
    }
  }

  toggleFolder(folderId: string): void {
    const isSelected = this.selectedFolderId() === folderId;
    const isExpanded = this.expandedFolders().has(folderId);

    // Only collapse if already selected and expanded
    if (isSelected && isExpanded) {
      this.expandedFolders.update((folders) => {
        const newFolders = new Set(folders);
        newFolders.delete(folderId);
        return newFolders;
      });
      return;
    }

    // Expand immediately if not yet expanded
    if (!isExpanded) {
      this.expandedFolders.update((folders) => {
        const newFolders = new Set(folders);
        newFolders.add(folderId);
        return newFolders;
      });
    }

    this.selectFolder.emit(folderId);
    this.pageService.setActivePageId(null);
    this.router.navigate(['/', folderId]);
  }

  /**
   * Open a local folder via file picker
   */
  onOpenLocalFolder(): void {
    this.isNewDropdownOpen.set(false);
    this.folderService.openLocalFolder().subscribe((folder) => {
      if (folder) {
        this.expandedFolders.update((folders) => {
          const updated = new Set(folders);
          updated.add(folder._id);
          return updated;
        });
        this.pageService.loadLocalPages(folder._id).subscribe();
        this.selectFolder.emit(folder._id);
        this.router.navigate(['/', folder._id]);
      }
    });
  }

  /**
   * Show inline input for creating a new iCloud folder
   */
  onCreateICloudFolder(): void {
    this.isCreatingICloudFolder.set(true);
    this.editValue.set('');
    this.editingFolderId.set(null);
    this.editingPageId.set(null);
    this.shouldFocusInput = true;
    this.iCloudFolderCreationTime = Date.now();
  }

  /**
   * Submit the new iCloud folder name
   */
  submitNewICloudFolder(): void {
    const name = this.sanitizeInput(this.editValue());
    this.isCreatingICloudFolder.set(false);
    this.editValue.set('');

    if (!name) return;

    this.folderService.createICloudFolder(name).subscribe((folder) => {
      if (folder) {
        this.expandedFolders.update((folders) => {
          const updated = new Set(folders);
          updated.add(folder._id);
          return updated;
        });
        this.selectFolder.emit(folder._id);
        this.router.navigate(['/', folder._id]);
      }
    });
  }

  getPageRouterLink(page: Page, folderId: string): string[] {
    const urlParam = page.id;
    return ['/', folderId, urlParam];
  }

  onNewPage(): void {
    this.isNewDropdownOpen.set(false);
    this.newPage.emit('memo');
  }

  toggleNewDropdown(): void {
    this.isNewDropdownOpen.update((v) => !v);
  }

  closeNewDropdown(): void {
    this.isNewDropdownOpen.set(false);
  }

  onSelectPage(page: Page): void {
    if (page.id === this.selectedPageId()) {
      this.startEditingPage(page.id, page.title, new Event('click'));
      return;
    }
    this.selectPage.emit(page.id);
  }

  onSettings(): void {
    this.settings.emit();
  }

  onDropListEntered(folderId: string): void {
    this.dragHoverFolderId.set(folderId);
  }

  onDropListExited(): void {
    this.dragHoverFolderId.set(null);
  }

  onPageDrop(event: CdkDragDrop<string, string, Page>): void {
    this.dragHoverFolderId.set(null);
    const page = event.item.data;
    const targetFolderId = event.container.data;
    const sourceFolderId = event.previousContainer.data;

    if (targetFolderId === sourceFolderId) return;

    this.pageService.updatePage(page.id, { folderId: targetFolderId }).subscribe();

    this.expandedFolders.update((folders) => {
      const updated = new Set(folders);
      updated.add(targetFolderId);
      return updated;
    });

    if (this.selectedPageId() === page.id) {
      this.router.navigate(['/', targetFolderId, page.id]);
    }
  }

  // Inline editing methods
  startEditingFolder(folderId: string, currentLabel: string, event: Event): void {
    event.stopPropagation();
    this.editingFolderId.set(folderId);
    this.editingPageId.set(null);
    this.editValue.set(currentLabel);
    this.shouldFocusInput = true;
  }

  startEditingPage(pageId: string, currentTitle: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.editingPageId.set(pageId);
    this.editingFolderId.set(null);
    this.editValue.set(currentTitle);
    this.shouldFocusInput = true;
  }

  onEditKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (this.isCreatingICloudFolder()) {
        this.submitNewICloudFolder();
      } else {
        this.saveEdit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (this.isCreatingICloudFolder()) {
        this.isCreatingICloudFolder.set(false);
        this.editValue.set('');
      } else {
        this.cancelEdit();
      }
    }
  }

  onEditBlur(): void {
    setTimeout(() => {
      if (this.isCreatingICloudFolder()) {
        // Ignore blur if the input was just created (prevents immediate dismiss)
        if (Date.now() - this.iCloudFolderCreationTime < 300) return;
        if (this.editValue().trim()) {
          this.submitNewICloudFolder();
        } else {
          this.isCreatingICloudFolder.set(false);
          this.editValue.set('');
        }
      } else if (this.editingFolderId() || this.editingPageId()) {
        this.saveEdit();
      }
    }, 100);
  }

  private sanitizeInput(value: string): string {
    return value
      .replace(/[\r\n]/g, ' ')
      .trim()
      .slice(0, 255);
  }

  saveEdit(): void {
    const sanitizedValue = this.sanitizeInput(this.editValue());

    if (!sanitizedValue) {
      this.cancelEdit();
      return;
    }

    const folderId = this.editingFolderId();
    const pageId = this.editingPageId();

    if (folderId) {
      const folder = this.folderService.folders().find((n: any) => n._id === folderId);
      if (folder && folder.label !== sanitizedValue) {
        this.folderService.updateFolder(folderId, { label: sanitizedValue }).subscribe();
      }
    } else if (pageId) {
      const pages = this.pageService.pages();
      const page = pages.find((p: any) => p.id === pageId);
      if (page && page.title !== sanitizedValue) {
        this.pageService.updatePage(page.id, { title: sanitizedValue }).subscribe();
      }
    }

    this.cancelEdit();
  }

  cancelEdit(): void {
    this.editingFolderId.set(null);
    this.editingPageId.set(null);
    this.editValue.set('');
  }

  onEditInputFocus(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    input.select();
  }
}
