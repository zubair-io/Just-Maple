import { ChangeDetectionStrategy, Component, input, output, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Paper, CollectibleRegistry, PaperStatus } from '@maple/shared';
import { CollectibleRegistryService } from '../../../services/collectible-registry.service';
import { ContentRendererComponent } from '../../atoms/content-renderer/content-renderer.component';

@Component({
  selector: 'app-collectible-item-view',
  standalone: true,
  imports: [CommonModule, ContentRendererComponent],
  templateUrl: './collectible-item-view.component.html',
  styleUrl: './collectible-item-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectibleItemViewComponent {
  private readonly registryService = inject(CollectibleRegistryService);

  readonly paper = input.required<Paper>();
  readonly statusChange = output<PaperStatus>();
  readonly quantityChange = output<number>();
  readonly delete = output<void>();
  readonly close = output<void>();

  readonly registryData = computed<CollectibleRegistry | undefined>(() => {
    const paper = this.paper();
    if (paper.data.registryData) {
      return this.registryService.getCached(paper.data.registryData);
    }
    return undefined;
  });

  readonly title = computed(() => {
    return this.registryData()?.title || this.paper().data.itemId;
  });

  readonly description = computed(() => {
    return this.registryData()?.description || null;
  });

  readonly images = computed(() => {
    return this.registryData()?.images || [];
  });

  readonly mainImage = computed(() => {
    return this.images()[0];
  });

  readonly tags = computed(() => {
    return this.registryData()?.tags || [];
  });

  readonly status = computed(() => this.paper().data.status);
  readonly quantity = computed(() => this.paper().data.quantity);
  readonly isHave = computed(() => this.status() === 'have');
  readonly isWant = computed(() => this.status() === 'want');

  setStatus(status: PaperStatus): void {
    if (this.status() === status) {
      // Toggle off - delete the paper
      this.delete.emit();
    } else {
      this.statusChange.emit(status);
    }
  }

  incrementQuantity(): void {
    this.quantityChange.emit(this.quantity() + 1);
  }

  decrementQuantity(): void {
    if (this.quantity() > 1) {
      this.quantityChange.emit(this.quantity() - 1);
    }
  }

  onClose(): void {
    this.close.emit();
  }
}
