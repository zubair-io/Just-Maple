import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import { PaperListComponent, BarcodeScannerComponent } from '../../components';
import type { Paper, CollectibleRegistry } from '@maple/shared';

@Component({
  selector: 'app-lego-view',
  standalone: true,
  imports: [CommonModule, PaperListComponent, BarcodeScannerComponent],
  templateUrl: './lego-view.component.html',
  styleUrl: './lego-view.component.scss',
})
export class LegoViewComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly paperService = inject(PaperService);
  readonly registryService = inject(CollectibleRegistryService);

  readonly selectedTagId = signal<string | null>(null);
  readonly showScanner = signal(false);

  readonly selectedTag = computed(() => {
    const tagId = this.selectedTagId();
    if (!tagId) return null;
    return this.tagService.tags().find((t) => t._id === tagId) || null;
  });

  readonly papersForTag = computed(() => {
    const tagId = this.selectedTagId();
    if (!tagId) return [];
    return this.paperService.papers().filter((p) => p.tags.includes(tagId));
  });

  private initialized = false;

  constructor() {
    effect(() => {
      const tags = this.tagService.tags();
      if (tags.length === 0) return;
      if (this.initialized) return;

      this.initialized = true;
      this.syncFromRoute();
    });
  }

  ngOnInit(): void {
    this.route.params.subscribe(() => {
      if (this.initialized) {
        this.syncFromRoute();
      }
    });
  }

  private syncFromRoute(): void {
    const tagId = this.route.snapshot.params['tagId'];

    if (tagId) {
      const tag = this.tagService.tags().find((t) => t._id === tagId);
      if (tag) {
        this.selectedTagId.set(tagId);
        this.loadPapersForTag(tagId);
      }
    }
  }

  private loadPapersForTag(tagId: string): void {
    this.registryService.initializeRegistry().subscribe({
      next: () => {
        this.paperService.loadPapers({ tagId }).subscribe();
      },
      error: () => {
        this.paperService.loadPapers({ tagId }).subscribe();
      },
    });
  }

  onSelectPaper(paper: Paper): void {
    const tagId = this.selectedTagId();
    if (tagId && paper.data.registryData) {
      this.router.navigate(['/', tagId, paper.data.registryData]);
    }
  }

  openScanner(): void {
    this.showScanner.set(true);
  }

  closeScanner(): void {
    this.showScanner.set(false);
  }

  onBarcodeScanned(registry: CollectibleRegistry): void {
    this.showScanner.set(false);
    const tagId = this.selectedTagId();
    if (tagId) {
      // Navigate to the registry view
      this.router.navigate(['/', tagId, registry._id]);
    }
  }

  onBarcodeNotFound(_barcode: string): void {
    // TODO: Show notification that barcode was not found
  }
}
