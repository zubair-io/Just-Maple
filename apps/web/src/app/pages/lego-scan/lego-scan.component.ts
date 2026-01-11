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
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, switchMap, of } from 'rxjs';
import { BrowserCodeReader, BrowserMultiFormatReader, BarcodeFormat } from '@zxing/browser';
import { DecodeHintType } from '@zxing/library';
import { TagService } from '../../services/tag.service';
import { PaperService } from '../../services/paper.service';
import { CollectibleRegistryService } from '../../services/collectible-registry.service';
import type { Paper, CollectibleRegistry, PaperStatus } from '@maple/shared';

@Component({
  selector: 'app-lego-scan',
  standalone: true,
  imports: [CommonModule, FormsModule, ScrollingModule],
  templateUrl: './lego-scan.component.html',
  styleUrl: './lego-scan.component.scss',
})
export class LegoScanComponent implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly paperService = inject(PaperService);
  readonly registryService = inject(CollectibleRegistryService);

  private routeSubscription?: Subscription;
  private controls: { stop: () => void } | null = null;

  readonly tagId = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly cameraEnabled = signal(false);
  readonly isScanning = signal(false);
  readonly isSaving = signal<string | null>(null); // registryId being saved
  readonly openDropdown = signal<string | null>(null); // registryId with open dropdown

  // Computed signals reactively derive from store - no validation needed
  readonly selectedTag = computed(() => {
    const id = this.tagId();
    if (!id) return null;
    return this.tagService.tags().find((t) => t._id === id) || null;
  });

  // Reactively load papers when tagId changes, with proper subscription management
  private readonly paperLoader = toSignal(
    toObservable(this.tagId).pipe(
      switchMap((tagId) => (tagId ? this.paperService.loadPapers({ tagId }) : of(null))),
    ),
    { initialValue: null },
  );

  constructor() {}

  /** Map of registryId -> Paper for quick lookup */
  readonly papersMap = computed(() => {
    const tagId = this.tagId();
    if (!tagId) return new Map<string, Paper>();

    const papers = this.paperService.papers().filter((p) => p.tags.includes(tagId));
    const map = new Map<string, Paper>();

    for (const paper of papers) {
      if (paper.data.registryData) {
        map.set(paper.data.registryData, paper);
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

    // Sort alphabetically by title
    return [...filtered].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  });

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - effect handles loading
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.tagId.set(params['tagId'] || null);
    });

    // Initialize registry data
    this.registryService.initializeRegistry().subscribe();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.stopCamera();
  }

  goBack(): void {
    const tagId = this.tagId();
    if (tagId) {
      this.router.navigate(['/', tagId]);
    } else {
      this.router.navigate(['/']);
    }
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
    const tagId = this.tagId();
    if (tagId) {
      this.router.navigate(['/', tagId, 'collectible', registry._id]);
    }
  }

  isInCollection(registryId: string): boolean {
    const paper = this.papersMap().get(registryId);
    return paper !== undefined && paper.data.status !== 'none';
  }

  getCollectionStatus(registryId: string): PaperStatus | null {
    const paper = this.papersMap().get(registryId);
    return paper?.data.status ?? null;
  }

  toggleDropdown(event: Event, registryId: string): void {
    event.stopPropagation();
    if (this.openDropdown() === registryId) {
      this.openDropdown.set(null);
    } else {
      this.openDropdown.set(registryId);
    }
  }

  closeDropdown(): void {
    this.openDropdown.set(null);
  }

  setStatus(event: Event, registry: CollectibleRegistry, status: PaperStatus): void {
    event.stopPropagation();
    this.openDropdown.set(null);

    const tagId = this.tagId();
    if (!tagId) return;

    const existingPaper = this.papersMap().get(registry._id);
    this.isSaving.set(registry._id);

    if (existingPaper) {
      this.paperService.updatePaper(existingPaper._id, { data: { status } }).subscribe({
        next: () => this.isSaving.set(null),
        error: () => this.isSaving.set(null),
      });
    } else {
      this.paperService
        .createPaper({
          tags: [tagId],
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

    const tagId = this.tagId();
    if (!tagId) return;

    const existingPaper = this.papersMap().get(registry._id);
    this.isSaving.set(registry._id);

    if (existingPaper && existingPaper.data.status !== 'none') {
      // Mark as 'none' (soft remove from collection)
      this.paperService.updatePaper(existingPaper._id, { data: { status: 'none' } }).subscribe({
        next: () => this.isSaving.set(null),
        error: () => this.isSaving.set(null),
      });
    } else if (existingPaper) {
      // Paper exists with 'none' status - update to 'have'
      this.paperService.updatePaper(existingPaper._id, { data: { status: 'have' } }).subscribe({
        next: () => this.isSaving.set(null),
        error: () => this.isSaving.set(null),
      });
    } else {
      // Create new paper with "have" status
      this.paperService
        .createPaper({
          tags: [tagId],
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
