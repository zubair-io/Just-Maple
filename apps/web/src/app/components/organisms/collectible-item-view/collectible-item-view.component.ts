import { ChangeDetectionStrategy, Component, input, output, inject, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { switchMap, of } from 'rxjs';
import type { Collectable, CollectibleRegistry, CollectableStatus } from '@maple/shared';
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

  readonly collectable = input.required<Collectable>();
  readonly statusChange = output<CollectableStatus>();
  readonly quantityChange = output<number>();
  readonly delete = output<void>();
  readonly close = output<void>();

  private readonly registryData$ = toObservable(this.collectable).pipe(
    switchMap((collectable) =>
      collectable.data.registryData
        ? this.registryService.select(collectable.data.registryData)
        : of(undefined),
    ),
  );
  readonly registryData = toSignal(this.registryData$);

  readonly title = computed(() => {
    return this.registryData()?.title || this.collectable().data.itemId;
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

  readonly status = computed(() => this.collectable().data.status);
  readonly quantity = computed(() => this.collectable().data.quantity);
  readonly isHave = computed(() => this.status() === 'have');
  readonly isWant = computed(() => this.status() === 'want');

  setStatus(status: CollectableStatus): void {
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
