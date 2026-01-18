import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of, catchError, forkJoin } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { CollectableService } from '../../services/collectable.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import { RealtimeWSService } from '../../services/realtime-ws.service';
import type { CollectableStatus } from '@maple/shared';

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
  readonly notebookService = inject(NotebookService);
  readonly collectableService = inject(CollectableService);
  readonly registryService = inject(CollectibleRegistryService);

  private routeSubscription?: Subscription;

  readonly notebookId = signal<string | null>(null);
  readonly registryId = signal<string | null>(null);
  readonly isSaving = signal(false);
  readonly selectedImageIndex = signal(0);

  // Computed signals reactively derive from stores
  readonly selectedNotebook = computed(() => {
    const id = this.notebookId();
    if (!id) return null;
    return this.notebookService.notebooks().find((n) => n._id === id) || null;
  });

  readonly registry = computed(() => {
    const id = this.registryId();
    if (!id) return null;
    return this.registryService.registries().find((r) => r._id === id) || null;
  });

  readonly collectable = computed(() => {
    const registryId = this.registryId();
    const notebookId = this.notebookId();
    if (!registryId || !notebookId) return null;
    return (
      this.collectableService
        .collectables()
        .find((c) => c.data.registryData === registryId && c.tags.includes(notebookId)) || null
    );
  });

  readonly isLoading = computed(() => {
    return this.collectableService.isLoading() || !this.registry();
  });

  readonly collectionStatus = computed<CollectableStatus>(() => {
    const c = this.collectable();
    if (!c) return 'none';
    return c.data.status;
  });

  readonly quantity = computed(() => {
    const c = this.collectable();
    return c?.data.quantity ?? 0;
  });

  // Reactively load data when notebookId changes, with proper subscription management
  private readonly dataLoader = toSignal(
    toObservable(this.notebookId).pipe(
      switchMap((notebookId) =>
        notebookId
          ? forkJoin({
              collectables: this.collectableService.loadCollectables({ notebookId }),
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
      this.notebookId.set(params['tagId'] || null);
      this.registryId.set(params['collectibleId'] || null);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  goBack(): void {
    this.location.back();
  }

  setStatus(status: CollectableStatus): void {
    const registryId = this.registryId();
    const notebookId = this.notebookId();
    const currentCollectable = this.collectable();
    const registry = this.registry();

    if (!registryId || !notebookId || !registry) return;

    // Use WebSocket for real-time updates
    if (this.realtimeWS.isConnected()) {
      if (currentCollectable) {
        // Optimistic update first, then send via WebSocket
        this.collectableService.optimisticUpdate(currentCollectable._id, { status });
        this.realtimeWS.updateCollectable(currentCollectable._id, { status });
      } else {
        // Optimistic create, then send via WebSocket
        const collectableData = {
          itemId: registry.providerId,
          provider: registry.provider,
          registryData: registryId,
          status,
          quantity: 1,
        };
        this.collectableService.optimisticCreate([notebookId], collectableData as any);
        this.realtimeWS.createCollectable([notebookId], collectableData);
      }
    } else {
      // Fallback to HTTP if WebSocket not connected (already has optimistic updates)
      this.isSaving.set(true);

      if (currentCollectable) {
        this.collectableService
          .updateCollectable(currentCollectable._id, { data: { status } })
          .subscribe({
            next: () => this.isSaving.set(false),
            error: () => this.isSaving.set(false),
          });
      } else {
        this.collectableService
          .createCollectable({
            tags: [notebookId],
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
    const currentCollectable = this.collectable();
    if (!currentCollectable) return;

    const newQuantity = Math.max(0, (currentCollectable.data.quantity ?? 1) + delta);

    // Use WebSocket for real-time updates
    if (this.realtimeWS.isConnected()) {
      // Optimistic update first, then send via WebSocket
      this.collectableService.optimisticUpdate(currentCollectable._id, {
        quantity: newQuantity,
      });
      this.realtimeWS.updateCollectable(currentCollectable._id, { quantity: newQuantity });
    } else {
      // Fallback to HTTP (already has optimistic updates)
      this.isSaving.set(true);
      this.collectableService
        .updateCollectable(currentCollectable._id, { data: { quantity: newQuantity } })
        .subscribe({
          next: () => this.isSaving.set(false),
          error: () => this.isSaving.set(false),
        });
    }
  }

  selectImage(index: number): void {
    this.selectedImageIndex.set(index);
  }

  getStatusLabel(status: CollectableStatus): string {
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

  getStatusIcon(status: CollectableStatus): string {
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
