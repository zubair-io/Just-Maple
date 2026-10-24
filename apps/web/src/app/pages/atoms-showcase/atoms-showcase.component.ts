import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TextComponent,
  StatComponent,
  IconComponent,
  BadgeComponent,
  ImageComponent,
  ProgressComponent,
  TimestampComponent,
  HrDividerComponent,
  LinkComponent,
  ListComponent,
  CheckboxComponent,
} from '../../components/atoms';

@Component({
  selector: 'app-atoms-showcase',
  standalone: true,
  imports: [
    CommonModule,
    TextComponent,
    StatComponent,
    IconComponent,
    BadgeComponent,
    ImageComponent,
    ProgressComponent,
    TimestampComponent,
    HrDividerComponent,
    LinkComponent,
    ListComponent,
    CheckboxComponent,
  ],
  templateUrl: './atoms-showcase.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './atoms-showcase.component.scss',
})
export class AtomsShowcaseComponent {
  readonly now = new Date().toISOString();
  readonly yesterday = new Date(Date.now() - 86400000).toISOString();
  readonly listItems = ['First item', 'Second item', 'Third item'];
}
