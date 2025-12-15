import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { PaperListItemComponent } from '../paper-list-item/paper-list-item.component';
import type { Paper } from '@maple/shared';

@Component({
  selector: 'app-paper-list',
  standalone: true,
  imports: [CommonModule, ScrollingModule, PaperListItemComponent],
  templateUrl: './paper-list.component.html',
  styleUrl: './paper-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaperListComponent {
  readonly papers = input.required<Paper[]>();
  readonly selectedPaperId = input<string | null>(null);

  readonly selectPaper = output<Paper>();

  trackByFn(index: number, paper: Paper): string {
    return paper._id;
  }

  onSelectPaper(paper: Paper): void {
    this.selectPaper.emit(paper);
  }
}
