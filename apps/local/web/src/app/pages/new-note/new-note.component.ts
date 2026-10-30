import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PageService } from '../../services/page.service';
import { generateUUID } from '../../utils/uuid';

@Component({
  selector: 'app-new-note',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './new-note.component.html',
})
export class NewNoteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageService = inject(PageService);

  ngOnInit(): void {
    const folderId = this.route.snapshot.paramMap.get('folderId');

    this.createPage(folderId);
  }

  private createPage(folderId: string | null): void {
    const id = generateUUID();
    this.pageService
      .createPage({
        id,
        title: 'Untitled',
        content: { type: 'doc', content: [] },
        folderId: folderId || undefined,
      })
      .subscribe({
        next: (page) => {
          this.router.navigate(['/', folderId, page.id], { replaceUrl: true });
        },
        error: (err: unknown) => {
          console.error('Failed to create page:', err);
          this.router.navigate(['/', folderId], { replaceUrl: true });
        },
      });
  }
}
