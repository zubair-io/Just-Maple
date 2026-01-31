import { ChangeDetectionStrategy, Component, input, inject, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { switchMap, of } from 'rxjs';
import type { Collectable, CollectibleRegistry } from '@maple/shared';
import { CollectibleRegistryService } from '../../../services/collectible-registry.service';

@Component({
  selector: 'app-paper-list-item',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './paper-list-item.component.html',
  styleUrl: './paper-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectableListItemComponent {
  private readonly registryService = inject(CollectibleRegistryService);

  readonly collectable = input.required<Collectable>();
  readonly selected = input(false);

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

  readonly image = computed(() => {
    const registry = this.registryData();
    return registry?.images?.[0];
  });

  readonly tags = computed(() => {
    const registry = this.registryData();
    return registry?.tags || [];
  });

  readonly statusLabel = computed(() => {
    const status = this.collectable().data.status;
    switch (status) {
      case 'have':
        return 'Have';
      case 'want':
        return 'Want';
      case 'sold':
        return 'Sold';
      default:
        return '';
    }
  });

  readonly statusClass = computed(() => {
    const status = this.collectable().data.status;
    switch (status) {
      case 'have':
        return 'bg-green-500/20 text-green-600 dark:text-green-400';
      case 'want':
        return 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400';
      case 'sold':
        return 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]';
      default:
        return '';
    }
  });
}
