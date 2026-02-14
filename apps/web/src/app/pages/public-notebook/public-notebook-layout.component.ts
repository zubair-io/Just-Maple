import { Component, inject, signal, OnDestroy, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  private readonly destroyRef = inject(DestroyRef);
  readonly publicNotebookService = inject(PublicNotebookService);

  readonly sidebarOpen = signal(false);
  readonly notebookSlug = signal<string>('');

  constructor() {
    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const slug = params['notebookSlug'] || '';
      if (slug && slug !== this.notebookSlug()) {
        this.notebookSlug.set(slug);
        this.publicNotebookService.loadNotebook(slug);
      }
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
