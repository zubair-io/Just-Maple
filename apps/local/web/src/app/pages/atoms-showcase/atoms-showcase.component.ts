import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TextComponent } from '../../components/atoms/text/text.component';
import { StatComponent } from '../../components/atoms/stat/stat.component';
import { IconComponent } from '../../components/atoms/icon/icon.component';
import { BadgeComponent } from '../../components/atoms/badge/badge.component';
import { ImageComponent } from '../../components/atoms/image/image.component';
import { ProgressComponent } from '../../components/atoms/progress/progress.component';
import { TimestampComponent } from '../../components/atoms/timestamp/timestamp.component';
import { HrDividerComponent } from '../../components/atoms/divider/divider.component';
import { LinkComponent } from '../../components/atoms/link/link.component';
import { ListComponent } from '../../components/atoms/list/list.component';
import { CheckboxComponent } from '../../components/atoms/checkbox/checkbox.component';

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
  styleUrl: './atoms-showcase.component.scss',
})
export class AtomsShowcaseComponent {
  readonly now = new Date().toISOString();
  readonly yesterday = new Date(Date.now() - 86400000).toISOString();
  readonly listItems = ['First item', 'Second item', 'Third item'];
}
