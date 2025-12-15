import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import type { Paper, CollectibleRegistry, PaperStatus } from '@maple/shared';

@Component({
  selector: 'app-collectible-registry-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './collectible-registry-view.component.html',
  styleUrl: './collectible-registry-view.component.scss',
})
export class CollectibleRegistryViewComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly paperService = inject(PaperService);
  readonly registryService = inject(CollectibleRegistryService);

  readonly tagId = signal<string | null>(null);
  readonly registryId = signal<string | null>(null);
  readonly registry = signal<CollectibleRegistry | null>(null);
  readonly paper = signal<Paper | null>(null);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly selectedImageIndex = signal(0);

  readonly selectedTag = computed(() => {
    const id = this.tagId();
    if (!id) return null;
    return this.tagService.tags().find((t) => t._id === id) || null;
  });

  readonly collectionStatus = computed<PaperStatus | 'none'>(() => {
    const p = this.paper();
    if (!p) return 'none';
    return p.data.status;
  });

  readonly quantity = computed(() => {
    const p = this.paper();
    return p?.data.quantity ?? 0;
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
    const registryId = this.route.snapshot.params['registryId'];

    if (tagId) {
      this.tagId.set(tagId);
    }
    if (registryId) {
      this.registryId.set(registryId);
      this.loadData(registryId, tagId);
    }
  }

  private loadData(registryId: string, tagId: string): void {
    this.isLoading.set(true);

    // Load registry
    this.registryService.getById(registryId).subscribe({
      next: (registry) => {
        this.registry.set(registry);
      },
      error: () => {
        this.registry.set(null);
      },
    });

    // Load paper (collection status)
    this.paperService.loadPaperByRegistry(registryId, tagId).subscribe({
      next: (paper) => {
        this.paper.set(paper);
        this.isLoading.set(false);
      },
      error: () => {
        this.paper.set(null);
        this.isLoading.set(false);
      },
    });
  }

  goBack(): void {
    const tagId = this.tagId();
    if (tagId) {
      this.router.navigate(['/', tagId]);
    } else {
      this.router.navigate(['/']);
    }
  }

  setStatus(status: PaperStatus | 'none'): void {
    const registryId = this.registryId();
    const tagId = this.tagId();
    const currentPaper = this.paper();
    const registry = this.registry();

    if (!registryId || !tagId || !registry) return;

    this.isSaving.set(true);

    if (status === 'none') {
      // Delete the paper
      if (currentPaper) {
        this.paperService.deletePaper(currentPaper._id).subscribe({
          next: () => {
            this.paper.set(null);
            this.isSaving.set(false);
          },
          error: () => {
            this.isSaving.set(false);
          },
        });
      } else {
        this.isSaving.set(false);
      }
    } else if (currentPaper) {
      // Update existing paper
      this.paperService.updatePaper(currentPaper._id, { data: { status } }).subscribe({
        next: (updatedPaper) => {
          this.paper.set(updatedPaper);
          this.isSaving.set(false);
        },
        error: () => {
          this.isSaving.set(false);
        },
      });
    } else {
      // Create new paper
      this.paperService
        .createPaper({
          tags: [tagId],
          data: {
            itemId: registry.providerId,
            provider: registry.provider,
            registryData: registryId,
            status,
            quantity: 1,
          },
        })
        .subscribe({
          next: (newPaper) => {
            this.paper.set(newPaper);
            this.isSaving.set(false);
          },
          error: () => {
            this.isSaving.set(false);
          },
        });
    }
  }

  updateQuantity(delta: number): void {
    const currentPaper = this.paper();
    if (!currentPaper) return;

    const newQuantity = Math.max(0, (currentPaper.data.quantity ?? 1) + delta);

    this.isSaving.set(true);
    this.paperService.updatePaper(currentPaper._id, { data: { quantity: newQuantity } }).subscribe({
      next: (updatedPaper) => {
        this.paper.set(updatedPaper);
        this.isSaving.set(false);
      },
      error: () => {
        this.isSaving.set(false);
      },
    });
  }

  selectImage(index: number): void {
    this.selectedImageIndex.set(index);
  }

  getStatusLabel(status: PaperStatus | 'none'): string {
    switch (status) {
      case 'have':
        return 'Have';
      case 'want':
        return 'Want';
      case 'sold':
        return 'Sold';
      case 'none':
        return 'Not in collection';
    }
  }

  getStatusIcon(status: PaperStatus | 'none'): string {
    switch (status) {
      case 'have':
        return 'check_circle';
      case 'want':
        return 'favorite';
      case 'sold':
        return 'sell';
      case 'none':
        return 'remove_circle_outline';
    }
  }
}
