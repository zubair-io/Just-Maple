import { Component, inject, signal, computed, effect, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import type { PaperStatus } from '@maple/shared';

@Component({
    selector: 'app-collectible-registry-view',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './collectible-registry-view.component.html',
    styleUrl: './collectible-registry-view.component.scss',
})
export class CollectibleRegistryViewComponent implements OnInit, OnDestroy {
    private readonly location = inject(Location);
    private readonly route = inject(ActivatedRoute);
    readonly tagService = inject(TagService);
    readonly paperService = inject(PaperService);
    readonly registryService = inject(CollectibleRegistryService);

    private routeSubscription?: Subscription;

    readonly tagId = signal<string | null>(null);
    readonly registryId = signal<string | null>(null);
    readonly isSaving = signal(false);
    readonly selectedImageIndex = signal(0);

    // Computed signals reactively derive from stores
    readonly selectedTag = computed(() => {
        const id = this.tagId();
        if (!id) return null;
        return this.tagService.tags().find((t) => t._id === id) || null;
    });

    readonly registry = computed(() => {
        const id = this.registryId();
        if (!id) return null;
        return this.registryService.registries().find((r) => r._id === id) || null;
    });

    readonly paper = computed(() => {
        const registryId = this.registryId();
        const tagId = this.tagId();
        if (!registryId || !tagId) return null;
        return (
            this.paperService
                .papers()
                .find((p) => p.data.registryData === registryId && p.tags.includes(tagId)) || null
        );
    });

    readonly isLoading = computed(() => {
        return this.paperService.isLoading() || !this.registry();
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

    constructor() {
        // Load data when tagId changes
        effect(() => {
            const tagId = this.tagId();
            if (tagId) {
                // Load all papers for this tag
                this.paperService.loadPapers({ tagId }).subscribe();
                // Initialize registry (loads all registries)
                this.registryService.initializeRegistry().subscribe();
            }
        });
    }

    ngOnInit(): void {
        // Subscribe to route params and set IDs directly - computed signals handle the rest
        this.routeSubscription = this.route.params.subscribe((params) => {
            this.tagId.set(params['tagId'] || null);
            this.registryId.set(params['collectibleId'] || null);
        });
    }

    ngOnDestroy(): void {
        this.routeSubscription?.unsubscribe();
    }

  goBack(): void {
    this.location.back();
  }

    setStatus(status: PaperStatus | 'none'): void {
        const registryId = this.registryId();
        const tagId = this.tagId();
        const currentPaper = this.paper();
        const registry = this.registry();

        if (!registryId || !tagId || !registry) return;

        this.isSaving.set(true);

        if (status === 'none') {
            // Delete the paper - store update will clear computed
            if (currentPaper) {
                this.paperService.deletePaper(currentPaper._id).subscribe({
                    next: () => this.isSaving.set(false),
                    error: () => this.isSaving.set(false),
                });
            } else {
                this.isSaving.set(false);
            }
        } else if (currentPaper) {
            // Update existing paper - store update will refresh computed
            this.paperService.updatePaper(currentPaper._id, { data: { status } }).subscribe({
                next: () => this.isSaving.set(false),
                error: () => this.isSaving.set(false),
            });
        } else {
            // Create new paper - store update will populate computed
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
                    next: () => this.isSaving.set(false),
                    error: () => this.isSaving.set(false),
                });
        }
    }

    updateQuantity(delta: number): void {
        const currentPaper = this.paper();
        if (!currentPaper) return;

        const newQuantity = Math.max(0, (currentPaper.data.quantity ?? 1) + delta);

        this.isSaving.set(true);
        this.paperService.updatePaper(currentPaper._id, { data: { quantity: newQuantity } }).subscribe({
            next: () => this.isSaving.set(false),
            error: () => this.isSaving.set(false),
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
