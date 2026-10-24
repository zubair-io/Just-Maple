import { Component, inject, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { PublicNotebookService } from '../../services/public-notebook.service';

@Component({
  selector: 'app-public-landing',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-landing.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './public-landing.component.scss',
})
export class PublicLandingComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly publicNotebookService = inject(PublicNotebookService);

  constructor() {
    // If a landing page is configured, redirect to it
    effect(() => {
      const notebook = this.publicNotebookService.notebook();
      const pages = this.publicNotebookService.sortedPages();
      if (!notebook || pages.length === 0) return;

      const notebookSlug = this.route.parent?.snapshot.paramMap.get('notebookSlug');
      if (!notebookSlug) return;

      // Find the landing page slug
      if (notebook.landingPageId) {
        const landingPage = pages.find((p) => p.id === notebook.landingPageId);
        if (landingPage) {
          this.router.navigate(['/', '!', notebookSlug, landingPage.slug], {
            replaceUrl: true,
          });
          return;
        }
      }

      // Default: redirect to first page
      if (pages.length > 0) {
        this.router.navigate(['/', '!', notebookSlug, pages[0].slug], {
          replaceUrl: true,
        });
      }
    });
  }
}
