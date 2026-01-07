import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { RealtimeService } from '../../services/realtime.service';
import { UiStateService } from '../../services/ui-state.service';
import { EventStreamService } from '../../services/event-stream.service';
import { SidebarComponent } from '../../components';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly tagService = inject(TagService);
  readonly noteService = inject(NoteService);
  private readonly realtimeService = inject(RealtimeService);
  private readonly uiStateService = inject(UiStateService);
  private readonly eventStream = inject(EventStreamService);

  readonly selectedNoteId = signal<string | null>(null);
  readonly selectedTagId = signal<string | null>(null);
  readonly sidebarOpen = signal(false);
  readonly chatInputFocused = this.uiStateService.chatInputFocused;

  private routerSubscription?: Subscription;

  ngOnInit(): void {
    // Load tags and notes
    this.tagService.ensureDefaultTag().subscribe({
      next: () => {
        // Auto-select first tag if on root path
        this.autoSelectFirstTag();
      },
    });
    this.noteService.loadNotes().subscribe();

    // Connect to realtime service
    this.realtimeService.connect();

    // Connect to SSE event stream for real-time updates
    this.eventStream.connect();

    // Sync selected IDs from route
    this.syncFromRoute();

    // Listen for route changes
    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.syncFromRoute();
      });
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
    this.eventStream.disconnect();
  }

  private syncFromRoute(): void {
    const url = this.router.url;
    const segments = url.split('/').filter(Boolean);

    if (segments.length >= 1) {
      // First segment is tagId (if not a special route like 'favorites', 'trash')
      const firstSegment = segments[0];
      if (!['favorites', 'trash', 'login', 'verify'].includes(firstSegment)) {
        this.selectedTagId.set(firstSegment);
      }
    }

    if (segments.length >= 2) {
      // Second segment is documentId - find note by documentId and set selectedNoteId to _id
      const documentId = segments[1];
      const note = this.noteService.notes().find((n) => n.documentId === documentId);
      this.selectedNoteId.set(note?._id || null);
    }
  }

  private autoSelectFirstTag(): void {
    // Only redirect if on root path (no tag selected)
    const url = this.router.url;
    const segments = url.split('/').filter(Boolean);

    if (segments.length === 0) {
      const tags = this.tagService.tags();
      if (tags.length > 0) {
        this.router.navigate(['/', tags[0]._id]);
      }
    }
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  openLastNote(): void {
    const notes = this.noteService.notes();
    if (notes.length > 0) {
      // Get the most recently updated note
      const sortedNotes = [...notes].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const lastNote = sortedNotes[0];
      const urlParam = lastNote.documentId;
      if (lastNote.tagId) {
        this.router.navigate(['/', lastNote.tagId, urlParam]);
      } else {
        this.selectedNoteId.set(lastNote._id);
      }
    }
  }

  onNewNote(): void {
    // Will be handled by the note-view component
  }

  onSelectNote(noteId: string): void {
    this.selectedNoteId.set(noteId);
  }

  onSelectTag(tagId: string): void {
    this.selectedTagId.set(tagId);
  }

  onCreateTag(): void {
    const name = prompt('Enter tag name:');
    if (!name) return;

    this.tagService.createTag({ label: name }).subscribe({
      error: (error) => {
        console.error('Failed to create tag:', error);
      },
    });
  }

  onSettings(): void {
    this.router.navigate(['/settings']);
  }

  createNewNote(): void {
    const tagId = this.selectedTagId();
    // Create a new note and navigate to it
    this.noteService
      .createNote({
        title: 'Untitled',
        content: { type: 'doc', content: [] },
        tagId: tagId || undefined,
      })
      .subscribe({
        next: (note) => {
          const urlParam = note.documentId;
          if (tagId) {
            this.router.navigate(['/', tagId, urlParam]);
          } else {
            this.router.navigate(['/', urlParam]);
          }
        },
        error: (error) => {
          console.error('Failed to create note:', error);
        },
      });
  }
}
