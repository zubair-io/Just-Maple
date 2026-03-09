import { Component, inject, signal, computed, effect, OnInit, OnDestroy } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of, catchError } from 'rxjs';
import { NotebookService } from '../../services/notebook.service';
import { CollectableService } from '../../services/collectable.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import { UiStateService } from '../../services/ui-state.service';
import { NativeBridgeService } from '../../services/native-bridge.service';
import { PaperListComponent } from '../../components';
import type { Collectable, CollectibleRegistry, RegistryTag } from '@maple/shared';

@Component({
  selector: 'app-lego-view',
  standalone: true,
  imports: [CommonModule, FormsModule, PaperListComponent],
  templateUrl: './lego-view.component.html',
  styleUrl: './lego-view.component.scss',
})
export class LegoViewComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly notebookService = inject(NotebookService);
  readonly collectableService = inject(CollectableService);
  readonly registryService = inject(CollectibleRegistryService);
  private readonly uiStateService = inject(UiStateService);
  private readonly nativeBridge = inject(NativeBridgeService);

  private routeSubscription?: Subscription;

  readonly selectedNotebookId = signal<string | null>(null);
  readonly showFilterPanel = signal(false);
  readonly searchQuery = signal('');
  readonly selectedRegistryTags = signal<string[]>([]);

  // Computed signals reactively derive from store - no validation needed
  readonly selectedNotebook = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return null;
    return this.notebookService.notebooks().find((n) => n._id === notebookId) || null;
  });

  // Computed map for O(1) registry lookups (reactive to store changes)
  private readonly registriesMap = computed(() => {
    const registries = this.registryService.registries();
    return new Map(registries.map((r) => [r._id, r]));
  });

  // Reactively load collectables when notebookId changes, with proper subscription management
  private readonly collectableLoader = toSignal(
    toObservable(this.selectedNotebookId).pipe(
      switchMap((notebookId) =>
        notebookId
          ? this.registryService.initializeRegistry().pipe(
              catchError(() => of(null)), // Continue even if registry init fails
              switchMap(() => this.collectableService.loadCollectables({ notebookId })),
            )
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  constructor() {
    console.log('LegoViewComponent initialized');
  }

  /** Get all collectables for the notebook (excluding 'none' status) */
  private readonly allCollectablesForNotebook = computed(() => {
    const notebookId = this.selectedNotebookId();
    if (!notebookId) return [];
    // Use collectablesSignal directly for proper reactive tracking
    const collectables = this.collectableService.collectablesSignal() ?? [];
    return collectables.filter((c) => c.tags.includes(notebookId) && c.data.status !== 'none');
  });

  /** Get unique registry tags from all collectables for filter options */
  readonly availableRegistryTags = computed(() => {
    const collectables = this.allCollectablesForNotebook();
    const tagSet = new Map<string, RegistryTag>();

    for (const collectable of collectables) {
      const registry = this.getRegistryForCollectable(collectable);
      if (registry?.tags) {
        for (const tag of registry.tags) {
          // Only include string tags without dashes, not purely numeric, and not ending in "+"
          if (
            typeof tag.value === 'string' &&
            !tag.value.includes('-') &&
            !tag.value.endsWith('+') &&
            isNaN(Number(tag.value))
          ) {
            tagSet.set(tag.value, tag);
          }
        }
      }
    }

    return Array.from(tagSet.values()).sort((a, b) => a.value.localeCompare(b.value));
  });

  /** Filtered and sorted collectables */
  readonly collectablesForNotebook = computed(() => {
    const collectables = this.allCollectablesForNotebook();
    const query = this.searchQuery().toLowerCase().trim();
    const selectedTags = this.selectedRegistryTags();

    let filtered = collectables;

    // Filter by search query (title or provider ID)
    if (query) {
      filtered = filtered.filter((collectable) => {
        const registry = this.getRegistryForCollectable(collectable);
        if (!registry) return false;

        const titleMatch = registry.title?.toLowerCase().includes(query);
        const providerIdMatch = registry.providerId?.toLowerCase().includes(query);
        return titleMatch || providerIdMatch;
      });
    }

    // Filter by selected registry tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter((collectable) => {
        const registry = this.getRegistryForCollectable(collectable);
        if (!registry?.tags) return false;

        return selectedTags.some((selectedTag) =>
          registry.tags.some((t) => t.value === selectedTag),
        );
      });
    }

    // Sort by newest first (by collectable createdAt or registry data created)
    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.data.created || a.createdAt).getTime();
      const dateB = new Date(b.data.created || b.createdAt).getTime();
      return dateB - dateA;
    });
  });

  /** Check if any filters are active */
  readonly hasActiveFilters = computed(() => {
    return this.searchQuery().trim().length > 0 || this.selectedRegistryTags().length > 0;
  });

  /** Get registry for a collectable (reactive O(1) lookup) */
  getRegistryForCollectable(collectable: Collectable): CollectibleRegistry | undefined {
    if (!collectable.data.registryData) return undefined;
    return this.registriesMap().get(collectable.data.registryData);
  }

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - effect handles loading
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedNotebookId.set(params['notebookId'] || null);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  onSelectCollectable(collectable: Collectable): void {
    const notebookId = this.selectedNotebookId();
    if (notebookId && collectable.data.registryData) {
      this.router.navigate(['/', notebookId, 'collectible', collectable.data.registryData]);
    }
  }

  openScanner(): void {
    const notebookId = this.selectedNotebookId();
    if (notebookId) {
      this.router.navigate(['/', notebookId, 'scan']);
    }
  }

  toggleFilterPanel(): void {
    this.showFilterPanel.update((v) => !v);
  }

  closeFilterPanel(): void {
    this.showFilterPanel.set(false);
  }

  updateSearchQuery(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  toggleRegistryTag(tagValue: string): void {
    this.selectedRegistryTags.update((tags) => {
      if (tags.includes(tagValue)) {
        return tags.filter((t) => t !== tagValue);
      } else {
        return [...tags, tagValue];
      }
    });
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.selectedRegistryTags.set([]);
  }

  openSidebarOnMobile(): void {
    if (
      this.nativeBridge.hasNativeSidebar() ||
      (typeof window !== 'undefined' && window.innerWidth < 768)
    ) {
      this.uiStateService.openSidebar();
    }
  }
}
