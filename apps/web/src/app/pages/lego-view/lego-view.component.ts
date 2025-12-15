import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import { PaperListComponent } from '../../components';
import type { Paper, CollectibleRegistry, RegistryTag } from '@maple/shared';

@Component({
  selector: 'app-lego-view',
  standalone: true,
  imports: [CommonModule, FormsModule, PaperListComponent],
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
  readonly showFilterPanel = signal(false);
  readonly searchQuery = signal('');
  readonly selectedRegistryTags = signal<string[]>([]);

  readonly selectedTag = computed(() => {
    const tagId = this.selectedTagId();
    if (!tagId) return null;
    return this.tagService.tags().find((t) => t._id === tagId) || null;
  });

  /** Get all papers for the tag */
  private readonly allPapersForTag = computed(() => {
    const tagId = this.selectedTagId();
    if (!tagId) return [];
    return this.paperService.papers().filter((p) => p.tags.includes(tagId));
  });

  /** Get unique registry tags from all papers for filter options */
  readonly availableRegistryTags = computed(() => {
    const papers = this.allPapersForTag();
    const tagSet = new Map<string, RegistryTag>();

    for (const paper of papers) {
      const registry = this.getRegistryForPaper(paper);
      if (registry?.tags) {
        for (const tag of registry.tags) {
          tagSet.set(tag.value, tag);
        }
      }
    }

    return Array.from(tagSet.values()).sort((a, b) => a.value.localeCompare(b.value));
  });

  /** Filtered and sorted papers */
  readonly papersForTag = computed(() => {
    const papers = this.allPapersForTag();
    const query = this.searchQuery().toLowerCase().trim();
    const selectedTags = this.selectedRegistryTags();

    let filtered = papers;

    // Filter by search query (title or provider ID)
    if (query) {
      filtered = filtered.filter((paper) => {
        const registry = this.getRegistryForPaper(paper);
        if (!registry) return false;

        const titleMatch = registry.title?.toLowerCase().includes(query);
        const providerIdMatch = registry.providerId?.toLowerCase().includes(query);
        return titleMatch || providerIdMatch;
      });
    }

    // Filter by selected registry tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter((paper) => {
        const registry = this.getRegistryForPaper(paper);
        if (!registry?.tags) return false;

        return selectedTags.some((selectedTag) =>
          registry.tags.some((t) => t.value === selectedTag),
        );
      });
    }

    // Sort by newest first (by paper createdAt or registry data created)
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

  /** Get registry for a paper (cached lookup) */
  getRegistryForPaper(paper: Paper): CollectibleRegistry | undefined {
    if (!paper.data.registryData) return undefined;
    return this.registryService.getCached(paper.data.registryData);
  }

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
    const tagId = this.selectedTagId();
    if (tagId) {
      this.router.navigate(['/', tagId, 'scan']);
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
}
