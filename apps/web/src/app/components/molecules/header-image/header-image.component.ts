import { Component, input, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MemoImageService } from '../../../services/memo-image.service';
import { PageService } from '../../../services/page.service';

@Component({
  selector: 'app-header-image',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header-image.component.html',
  styleUrl: './header-image.component.scss',
})
export class HeaderImageComponent {
  private readonly memoImageService = inject(MemoImageService);
  private readonly pageService = inject(PageService);

  readonly pageId = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly editable = input<boolean>(true);

  readonly headerImageChanged = output<string | null>();

  readonly isUploading = signal(false);
  readonly isHovering = signal(false);

  readonly hasImage = computed(() => !!this.imageUrl());

  async onAddImage(): Promise<void> {
    const file = await this.memoImageService.selectImageFile();
    if (!file) return;

    this.isUploading.set(true);

    this.memoImageService.uploadHeaderImage(this.pageId(), file).subscribe({
      next: (result) => {
        this.isUploading.set(false);
        this.headerImageChanged.emit(result.url);
        // Refresh the page to get the updated header image
        this.pageService.getPage(this.pageId()).subscribe();
      },
      error: (err) => {
        this.isUploading.set(false);
        console.error('[HeaderImage] Failed to upload:', err);
      },
    });
  }

  onRemoveImage(): void {
    this.memoImageService.deleteHeaderImage(this.pageId()).subscribe({
      next: () => {
        this.headerImageChanged.emit(null);
        // Refresh the page to get the updated header image
        this.pageService.getPage(this.pageId()).subscribe();
      },
      error: (err) => {
        console.error('[HeaderImage] Failed to delete:', err);
      },
    });
  }

  onChangeImage(): void {
    this.onAddImage();
  }
}
