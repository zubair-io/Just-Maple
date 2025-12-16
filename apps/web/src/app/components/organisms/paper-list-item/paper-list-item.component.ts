import { ChangeDetectionStrategy, Component, input, inject, computed } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { switchMap, of } from 'rxjs';
import type { Paper, CollectibleRegistry } from '@maple/shared';
import { CollectibleRegistryService } from '../../../services/collectible-registry.service';

@Component({
  selector: 'app-paper-list-item',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './paper-list-item.component.html',
  styleUrl: './paper-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperListItemComponent {
  private readonly registryService = inject(CollectibleRegistryService);

  readonly paper = input.required<Paper>();
  readonly selected = input(false);

  private readonly registryData$ = toObservable(this.paper).pipe(
    switchMap((paper) =>
      paper.data.registryData
        ? this.registryService.select(paper.data.registryData)
        : of(undefined),
    ),
  );
  readonly registryData = toSignal(this.registryData$);

  readonly title = computed(() => {
    return this.registryData()?.title || this.paper().data.itemId;
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
    const status = this.paper().data.status;
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
    const status = this.paper().data.status;
    switch (status) {
      case 'have':
        return 'bg-green-100 text-green-800';
      case 'want':
        return 'bg-yellow-100 text-yellow-800';
      case 'sold':
        return 'bg-gray-100 text-gray-800';
      default:
        return '';
    }
  });
}
