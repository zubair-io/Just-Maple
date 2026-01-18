import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { CollectableListItemComponent } from '../paper-list-item/paper-list-item.component';
import type { Collectable } from '@maple/shared';

@Component({
  selector: 'app-paper-list',
  standalone: true,
  imports: [CommonModule, ScrollingModule, CollectableListItemComponent],
  templateUrl: './paper-list.component.html',
  styleUrl: './paper-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectableListComponent {
  readonly collectables = input.required<Collectable[]>();
  readonly selectedCollectableId = input<string | null>(null);

  readonly selectCollectable = output<Collectable>();

  trackByFn(index: number, collectable: Collectable): string {
    return collectable._id;
  }

  onSelectCollectable(collectable: Collectable): void {
    this.selectCollectable.emit(collectable);
  }
}
