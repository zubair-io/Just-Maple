import { Component, inject, effect, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PublicNotebookService } from '../../services/public-notebook.service';
import { ContentRendererComponent } from '../../components/atoms/content-renderer/content-renderer.component';

@Component({
  selector: 'app-public-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ContentRendererComponent],
  templateUrl: './public-page.component.html',
  styleUrl: './public-page.component.scss',
})
export class PublicPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly publicNotebookService = inject(PublicNotebookService);

  readonly notebookSlug = signal<string>('');
  readonly pageSlug = signal<string>('');

  constructor() {
    effect(() => {
      const notebookSlug = this.notebookSlug();
      const pageSlug = this.pageSlug();
      if (notebookSlug && pageSlug) {
        this.publicNotebookService.loadPage(notebookSlug, pageSlug);
      }
    });

    this.route.params.subscribe((params) => {
      this.pageSlug.set(params['pageSlug'] || '');
    });

    // Get notebookSlug from parent route
    this.route.parent?.params.subscribe((params) => {
      this.notebookSlug.set(params['notebookSlug'] || '');
    });
  }

  ngOnDestroy(): void {
    this.publicNotebookService.activePage.set(null);
    this.publicNotebookService.backlinks.set([]);
  }
}
