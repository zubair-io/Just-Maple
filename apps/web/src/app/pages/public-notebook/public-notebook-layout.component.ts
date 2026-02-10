import { Component, inject, effect, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { PublicNotebookService } from '../../services/public-notebook.service';

@Component({
  selector: 'app-public-notebook-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './public-notebook-layout.component.html',
  styleUrl: './public-notebook-layout.component.scss',
})
export class PublicNotebookLayoutComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly publicNotebookService = inject(PublicNotebookService);

  readonly sidebarOpen = signal(false);
  readonly notebookSlug = signal<string>('');

  constructor() {
    effect(() => {
      const slug = this.notebookSlug();
      if (slug) {
        this.publicNotebookService.loadNotebook(slug);
      }
    });

    this.route.params.subscribe((params) => {
      this.notebookSlug.set(params['notebookSlug'] || '');
    });
  }

  ngOnDestroy(): void {
    this.publicNotebookService.reset();
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
