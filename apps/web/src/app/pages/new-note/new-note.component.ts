import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NoteService } from '../../services/note.service';
import { NotebookDocumentService } from '../../services/notebook-document.service';
import type { NoteType } from '@maple/shared';

@Component({
  selector: 'app-new-note',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center justify-center h-full">
      <div class="text-[var(--color-text-muted)]">Creating note...</div>
    </div>
  `,
})
export class NewNoteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly noteService = inject(NoteService);
  private readonly notebookService = inject(NotebookDocumentService);

  ngOnInit(): void {
    const tagId = this.route.snapshot.paramMap.get('tagId');
    const type = (this.route.snapshot.queryParamMap.get('type') as NoteType) || 'notebook';

    this.createNote(tagId, type);
  }

  private async createNote(tagId: string | null, type: NoteType): Promise<void> {
    try {
      if (type === 'notebook') {
        // Create notebook using the offline-first notebook service
        const { note } = await this.notebookService.createNotebook(tagId || undefined);
        this.router.navigate(['/', tagId, note.documentId], { replaceUrl: true });
      } else {
        // Create other note types using the regular note service
        this.noteService
          .createNote({
            title: 'Untitled',
            content: { type: 'doc', content: [] },
            tagId: tagId || undefined,
            type,
          })
          .subscribe({
            next: (note) => {
              this.router.navigate(['/', tagId, note.documentId], { replaceUrl: true });
            },
            error: (err) => {
              console.error('Failed to create note:', err);
              this.router.navigate(['/', tagId], { replaceUrl: true });
            },
          });
      }
    } catch (err) {
      console.error('Failed to create note:', err);
      this.router.navigate(['/', tagId], { replaceUrl: true });
    }
  }
}
