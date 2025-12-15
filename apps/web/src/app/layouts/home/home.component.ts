import { Component, inject, signal, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { RealtimeService } from '../../services/realtime.service';
import { UiStateService } from '../../services/ui-state.service';
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

  readonly selectedNoteId = signal<string | null>(null);
  readonly selectedTagId = signal<string | null>(null);
  readonly sidebarOpen = signal(false);
  readonly chatInputFocused = this.uiStateService.chatInputFocused;

  private routerSubscription?: Subscription;

  ngOnInit(): void {
    // Load tags and notes
    this.tagService.ensureDefaultTag().subscribe();
    this.noteService.loadNotes().subscribe();

    // Connect to realtime service
    this.realtimeService.connect();

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
      // Second segment is noteId
      this.selectedNoteId.set(segments[1]);
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
      if (lastNote.tagId) {
        this.router.navigate(['/', lastNote.tagId, lastNote._id]);
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
}
