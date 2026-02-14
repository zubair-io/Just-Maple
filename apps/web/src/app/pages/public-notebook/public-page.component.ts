import { Component, inject, signal, OnDestroy } from '@angular/core';
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
    this.route.params.subscribe((params) => {
      const slug = params['pageSlug'] || '';
      if (slug !== this.pageSlug()) {
        this.pageSlug.set(slug);
        this.tryLoadPage();
      }
    });

    this.route.parent?.params.subscribe((params) => {
      const slug = params['notebookSlug'] || '';
      if (slug !== this.notebookSlug()) {
        this.notebookSlug.set(slug);
        this.tryLoadPage();
      }
    });
  }

  private tryLoadPage(): void {
    const nb = this.notebookSlug();
    const pg = this.pageSlug();
    if (nb && pg) {
      this.publicNotebookService.loadPage(nb, pg);
    }
  }

  ngOnDestroy(): void {
    this.publicNotebookService.activePage.set(null);
    this.publicNotebookService.backlinks.set([]);
  }
}
