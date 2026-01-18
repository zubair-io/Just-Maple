import {
  Component,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of } from 'rxjs';
import { BrowserCodeReader, BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import { NotebookService } from '../../services/notebook.service';
import { CollectableService } from '../../services/collectable.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import type { Collectable, CollectibleRegistry, CollectableStatus } from '@maple/shared';

@Component({
  selector: 'app-lego-scan',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule],
  templateUrl: './lego-scan.component.html',
  styleUrl: './lego-scan.component.scss',
})
export class LegoScanComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;

  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly notebookService = inject(NotebookService);
  readonly collectableService = inject(CollectableService);
  readonly registryService = inject(CollectibleRegistryService);

  private routeSubscription?: Subscription;
  private controls: { stop: () => void } | null = null;

  readonly notebookId = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly cameraEnabled = signal(false);
  readonly isScanning = signal(false);
  readonly isSaving = signal<string | null>(null); // registryId being saved
  readonly openDropdown = signal<string | null>(null); // registryId with open dropdown
  readonly dropdownPosition = signal<'above' | 'below'>('above'); // dropdown position

  // Computed signals reactively derive from store - no validation needed
  readonly selectedNotebook = computed(() => {
    const id = this.notebookId();
    if (!id) return null;
    return this.notebookService.notebooks().find((n) => n._id === id) || null;
  });

  // Reactively load collectables when notebookId changes, with proper subscription management
  private readonly collectableLoader = toSignal(
    toObservable(this.notebookId).pipe(
      switchMap((notebookId) =>
        notebookId ? this.collectableService.loadCollectables({ notebookId }) : of(null),
      ),
    ),
    { initialValue: null },
  );

  constructor() {}

  /** Map of registryId -> Collectable for quick lookup */
  readonly collectablesMap = computed(() => {
    const notebookId = this.notebookId();
    if (!notebookId) return new Map<string, Collectable>();

    // Use collectablesSignal directly for proper reactive tracking
    const allCollectables = this.collectableService.collectablesSignal() ?? [];
    const collectables = allCollectables.filter((c) => c.tags.includes(notebookId));
    const map = new Map<string, Collectable>();

    for (const collectable of collectables) {
      if (collectable.data.registryData) {
        map.set(collectable.data.registryData, collectable);
      }
    }

    return map;
  });

  /** Filtered registries based on search query */
  readonly filteredRegistries = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const all = this.registryService.registries();

    let filtered = all;

    if (query) {
      filtered = all.filter((r) => {
        const titleMatch = r.title?.toLowerCase().includes(query);
        const providerIdMatch = r.providerId?.toLowerCase().includes(query);
        const upcMatch = r.upc?.includes(query);
        return titleMatch || providerIdMatch || upcMatch;
      });
    }

    // Sort by newest first (by year tag if available, then by createdAt)
    return [...filtered].sort((a, b) => {
      // Try to extract year from tags
      const getYear = (registry: CollectibleRegistry) => {
        const yearTag = registry.tags.find((t) => /^\d{4}$/.test(t.value));
        return yearTag ? parseInt(yearTag.value, 10) : 0;
      };

      const yearA = getYear(a);
      const yearB = getYear(b);

      // Sort by year descending (newest first)
      if (yearA !== yearB) {
        return yearB - yearA;
      }

      // Fall back to createdAt descending
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      if (dateA !== dateB) {
        return dateB - dateA;
      }

      // Final fallback to alphabetical
      return (a.title || '').localeCompare(b.title || '');
    });
  });

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - effect handles loading
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.notebookId.set(params['tagId'] || null);
    });

    // Initialize registry data
    this.registryService.initializeRegistry().subscribe();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.stopCamera();
  }

  goBack(): void {
    this.location.back();
  }

  updateSearchQuery(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  async toggleCamera(): Promise<void> {
    if (this.cameraEnabled()) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  private async startCamera(): Promise<void> {
    this.cameraEnabled.set(true);
    this.isScanning.set(true);

    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A]);

      const codeReader = new BrowserMultiFormatReader(hints);
      const videoInputDevices = await BrowserCodeReader.listVideoInputDevices();

      if (videoInputDevices.length === 0) {
        throw new Error('No camera found');
      }

      const videoElement = this.videoElement?.nativeElement;
      if (!videoElement) {
        throw new Error('Video element not found');
      }

      const selectedDevice = this.getBestBarcodeCamera(videoInputDevices);

      this.controls = await codeReader.decodeFromVideoDevice(
        selectedDevice.deviceId,
        videoElement,
        (result) => {
          if (result) {
            const barcode = result.getText();
            this.onBarcodeDetected(barcode);
          }
          // Ignore errors (usually just "no barcode found")
        },
      );
    } catch (error) {
      console.error('Failed to start camera:', error);
      this.cameraEnabled.set(false);
      this.isScanning.set(false);
    }
  }

  private stopCamera(): void {
    this.controls?.stop();
    this.controls = null;
    this.cameraEnabled.set(false);
    this.isScanning.set(false);
  }

  private getBestBarcodeCamera(videoInputDevices: MediaDeviceInfo[]): MediaDeviceInfo {
    // Prefer back camera
    const backCamera = videoInputDevices.find(
      (d) =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('rear') ||
        d.label.toLowerCase().includes('environment'),
    );

    return backCamera || videoInputDevices[0];
  }

  private onBarcodeDetected(barcode: string): void {
    // Set the search query to the barcode
    this.searchQuery.set(barcode);

    // Optionally close camera after successful scan
    // this.stopCamera();
  }

  onSelectRegistry(registry: CollectibleRegistry): void {
    const notebookId = this.notebookId();
    if (notebookId) {
      this.router.navigate(['/', notebookId, 'collectible', registry._id]);
    }
  }

  isInCollection(registryId: string): boolean {
    const collectable = this.collectablesMap().get(registryId);
    return collectable !== undefined && collectable.data.status !== 'none';
  }

  getCollectionStatus(registryId: string): CollectableStatus | null {
    const collectable = this.collectablesMap().get(registryId);
    return collectable?.data.status ?? null;
  }

  toggleDropdown(event: Event, registryId: string): void {
    event.stopPropagation();
    if (this.openDropdown() === registryId) {
      this.openDropdown.set(null);
    } else {
      // Determine dropdown position based on button location
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const dropdownHeight = 180; // approximate height of dropdown

      // If there's not enough space below, open above
      if (rect.bottom + dropdownHeight > viewportHeight) {
        this.dropdownPosition.set('above');
      } else {
        this.dropdownPosition.set('below');
      }

      this.openDropdown.set(registryId);
    }
  }

  closeDropdown(): void {
    this.openDropdown.set(null);
  }

  setStatus(event: Event, registry: CollectibleRegistry, status: CollectableStatus): void {
    event.stopPropagation();
    this.openDropdown.set(null);

    const notebookId = this.notebookId();
    if (!notebookId) return;

    const existingCollectable = this.collectablesMap().get(registry._id);
    this.isSaving.set(registry._id);

    if (existingCollectable) {
      this.collectableService
        .updateCollectable(existingCollectable._id, { data: { status } })
        .subscribe({
          next: () => this.isSaving.set(null),
          error: () => this.isSaving.set(null),
        });
    } else {
      this.collectableService
        .createCollectable({
          tags: [notebookId],
          data: {
            itemId: registry.providerId,
            provider: registry.provider,
            registryData: registry._id,
            status,
            quantity: 1,
          },
        })
        .subscribe({
          next: () => this.isSaving.set(null),
          error: () => this.isSaving.set(null),
        });
    }
  }

  trackByRegistryId(_index: number, registry: CollectibleRegistry): string {
    return registry._id;
  }

  toggleCollection(event: Event, registry: CollectibleRegistry): void {
    event.stopPropagation(); // Prevent row click

    const notebookId = this.notebookId();
    if (!notebookId) return;

    const existingCollectable = this.collectablesMap().get(registry._id);
    this.isSaving.set(registry._id);

    if (existingCollectable && existingCollectable.data.status !== 'none') {
      // Mark as 'none' (soft remove from collection)
      this.collectableService
        .updateCollectable(existingCollectable._id, { data: { status: 'none' } })
        .subscribe({
          next: () => this.isSaving.set(null),
          error: () => this.isSaving.set(null),
        });
    } else if (existingCollectable) {
      // Collectable exists with 'none' status - update to 'have'
      this.collectableService
        .updateCollectable(existingCollectable._id, { data: { status: 'have' } })
        .subscribe({
          next: () => this.isSaving.set(null),
          error: () => this.isSaving.set(null),
        });
    } else {
      // Create new collectable with "have" status
      this.collectableService
        .createCollectable({
          tags: [notebookId],
          data: {
            itemId: registry.providerId,
            provider: registry.provider,
            registryData: registry._id,
            status: 'have',
            quantity: 1,
          },
        })
        .subscribe({
          next: () => this.isSaving.set(null),
          error: () => this.isSaving.set(null),
        });
    }
  }
}
