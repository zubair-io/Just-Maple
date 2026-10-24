import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-marketing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './marketing.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './marketing.component.scss',
})
export class MarketingComponent {
  readonly currentYear = new Date().getFullYear();
}
