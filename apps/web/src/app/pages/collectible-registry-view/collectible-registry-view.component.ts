import { Component, inject, signal, computed, effect, OnInit, OnDestroy } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of, catchError, forkJoin } from 'rxjs';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import { RealtimeWSService } from '../../services/realtime-ws.service';
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
  private readonly realtimeWS = inject(RealtimeWSService);
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

  readonly collectionStatus = computed<PaperStatus>(() => {
    const p = this.paper();
    if (!p) return 'none';
    return p.data.status;
  });

  readonly quantity = computed(() => {
    const p = this.paper();
    return p?.data.quantity ?? 0;
  });

  // Reactively load data when tagId changes, with proper subscription management
  private readonly dataLoader = toSignal(
    toObservable(this.tagId).pipe(
      switchMap((tagId) =>
        tagId
          ? forkJoin({
              papers: this.paperService.loadPapers({ tagId }),
              registry: this.registryService.initializeRegistry().pipe(catchError(() => of(null))),
            })
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  constructor() {}

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

  setStatus(status: PaperStatus): void {
    const registryId = this.registryId();
    const tagId = this.tagId();
    const currentPaper = this.paper();
    const registry = this.registry();

    if (!registryId || !tagId || !registry) return;

    // Use WebSocket for real-time updates
    if (this.realtimeWS.isConnected()) {
      if (currentPaper) {
        // Optimistic update first, then send via WebSocket
        this.paperService.optimisticUpdate(currentPaper._id, { status });
        this.realtimeWS.updatePaper(currentPaper._id, { status });
      } else {
        // Optimistic create, then send via WebSocket
        const paperData = {
          itemId: registry.providerId,
          provider: registry.provider,
          registryData: registryId,
          status,
          quantity: 1,
        };
        this.paperService.optimisticCreate([tagId], paperData as any);
        this.realtimeWS.createPaper([tagId], paperData);
      }
    } else {
      // Fallback to HTTP if WebSocket not connected (already has optimistic updates)
      this.isSaving.set(true);

      if (currentPaper) {
        this.paperService.updatePaper(currentPaper._id, { data: { status } }).subscribe({
          next: () => this.isSaving.set(false),
          error: () => this.isSaving.set(false),
        });
      } else {
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
  }

  updateQuantity(delta: number): void {
    const currentPaper = this.paper();
    if (!currentPaper) return;

    const newQuantity = Math.max(0, (currentPaper.data.quantity ?? 1) + delta);

    // Use WebSocket for real-time updates
    if (this.realtimeWS.isConnected()) {
      // Optimistic update first, then send via WebSocket
      this.paperService.optimisticUpdate(currentPaper._id, { quantity: newQuantity });
      this.realtimeWS.updatePaper(currentPaper._id, { quantity: newQuantity });
    } else {
      // Fallback to HTTP (already has optimistic updates)
      this.isSaving.set(true);
      this.paperService
        .updatePaper(currentPaper._id, { data: { quantity: newQuantity } })
        .subscribe({
          next: () => this.isSaving.set(false),
          error: () => this.isSaving.set(false),
        });
    }
  }

  selectImage(index: number): void {
    this.selectedImageIndex.set(index);
  }

  getStatusLabel(status: PaperStatus): string {
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

  getStatusIcon(status: PaperStatus): string {
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

  formatDescription(description: any): string {
    if (!description) return '';

    // If it's already a string, return it
    if (typeof description === 'string') {
      description = JSON.parse(description);
    }

    // If it's ProseMirror JSON, extract text
    if (description.type === 'doc' && description.content) {
      return this.extractTextFromProseMirror(description.content);
    }

    return '';
  }

  private extractTextFromProseMirror(content: any[]): string {
    let text = '';

    for (const node of content) {
      if (node.type === 'text') {
        text += node.text || '';
      } else if (node.content) {
        text += this.extractTextFromProseMirror(node.content);
      }

      // Add line breaks for block elements
      if (node.type === 'paragraph' || node.type === 'heading') {
        text += '\n';
      }
    }

    return text.trim();
  }
}
