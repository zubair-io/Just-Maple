import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import { ContentRendererComponent } from '../../components';
import type { CollectibleRegistry, Paper, PaperStatus } from '@maple/shared';

@Component({
    selector: 'app-collectible-registry-view',
    standalone: true,
    imports: [CommonModule, ContentRendererComponent],
    templateUrl: './collectible-registry-view.component.html',
    styleUrl: './collectible-registry-view.component.scss',
})
export class CollectibleRegistryViewComponent implements OnInit {
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    readonly tagService = inject(TagService);
    readonly paperService = inject(PaperService);
    readonly registryService = inject(CollectibleRegistryService);

    readonly selectedTagId = signal<string | null>(null);
    readonly selectedRegistryId = signal<string | null>(null);
    readonly loading = signal(true);

    readonly selectedTag = computed(() => {
        const tagId = this.selectedTagId();
        if (!tagId) return null;
        return this.tagService.tags().find((t) => t._id === tagId) || null;
    });

    readonly registry = computed<CollectibleRegistry | null>(() => {
        const id = this.selectedRegistryId();
        if (!id) return null;
        // Access registries() signal to create reactive dependency on store changes
        const registries = this.registryService.registries();
        return registries.find((r) => r._id === id) || null;
    });

    // Find if user has a paper for this registry in this tag
    readonly paperForRegistry = computed<Paper | null>(() => {
        const tagId = this.selectedTagId();
        const registryId = this.selectedRegistryId();
        if (!tagId || !registryId) return null;

        return (
            this.paperService
                .papers()
                .find((p) => p.tags.includes(tagId) && p.data.registryData === registryId) || null
        );
    });

    readonly status = computed<PaperStatus | null>(() => {
        return this.paperForRegistry()?.data.status || null;
    });

    readonly quantity = computed(() => {
        return this.paperForRegistry()?.data.quantity || 1;
    });

    readonly isHave = computed(() => this.status() === 'have');
    readonly isWant = computed(() => this.status() === 'want');

    readonly title = computed(() => {
        return this.registry()?.title || 'Loading...';
    });

    readonly description = computed(() => {
        return this.registry()?.description || null;
    });

    readonly images = computed(() => {
        return this.registry()?.images || [];
    });

    readonly mainImage = computed(() => {
        return this.images()[0];
    });

    readonly tags = computed(() => {
        return this.registry()?.tags || [];
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
            this.selectedTagId.set(tagId);
        }

        if (registryId) {
            this.selectedRegistryId.set(registryId);
            this.loadRegistry(registryId);
            this.loadPapersForTag(tagId);
        }
    }

    private loadRegistry(id: string): void {
        this.loading.set(true);

        // First try to get from cache after initializing
        this.registryService.initializeRegistry().subscribe({
            next: () => {
                const cached = this.registryService.getCached(id);
                if (cached) {
                    this.loading.set(false);
                } else {
                    // If not in cache, fetch individually
                    this.registryService.getById(id).subscribe({
                        next: () => this.loading.set(false),
                        error: () => this.loading.set(false),
                    });
                }
            },
            error: () => {
                this.registryService.getById(id).subscribe({
                    next: () => this.loading.set(false),
                    error: () => this.loading.set(false),
                });
            },
        });
    }

    private loadPapersForTag(tagId: string): void {
        this.paperService.loadPapers({ tagId }).subscribe();
    }

    goBack(): void {
        const tagId = this.selectedTagId();
        if (tagId) {
            this.router.navigate(['/', tagId]);
        } else {
            this.router.navigate(['/']);
        }
    }

    setStatus(newStatus: PaperStatus): void {
        const currentStatus = this.status();
        const tagId = this.selectedTagId();
        const registryId = this.selectedRegistryId();
        const registry = this.registry();
        const paper = this.paperForRegistry();

        if (!tagId || !registryId || !registry) return;

        if (currentStatus === newStatus) {
            // Toggle off - delete the paper
            if (paper) {
                this.paperService.deletePaper(paper._id).subscribe({
                    error: (error) => {
                        console.error('Failed to delete paper:', error);
                    },
                });
            }
        } else if (paper) {
            // Update existing paper
            this.paperService.updatePaper(paper._id, { data: { status: newStatus } }).subscribe({
                error: (error) => {
                    console.error('Failed to update paper:', error);
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
                        status: newStatus,
                        quantity: 1,
                    },
                })
                .subscribe({
                    error: (error) => {
                        console.error('Failed to create paper:', error);
                    },
                });
        }
    }

    incrementQuantity(): void {
        const paper = this.paperForRegistry();
        if (!paper) return;

        this.paperService
            .updatePaper(paper._id, { data: { quantity: this.quantity() + 1 } })
            .subscribe({
                error: (error) => {
                    console.error('Failed to update quantity:', error);
                },
            });
    }

    decrementQuantity(): void {
        const paper = this.paperForRegistry();
        if (!paper || this.quantity() <= 1) return;

        this.paperService
            .updatePaper(paper._id, { data: { quantity: this.quantity() - 1 } })
            .subscribe({
                error: (error) => {
                    console.error('Failed to update quantity:', error);
                },
            });
    }
}
