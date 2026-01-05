import {
  Component,
  inject,
  signal,
  computed,
  output,
  input,
  effect,
  OnInit,
  Signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { TagService } from '../../../services/tag.service';
import { NoteService } from '../../../services/note.service';
import { MessageService } from '../../../services/message.service';
import { NotificationService } from '../../../services/notification.service';
import { NetworkService } from '../../../services/network.service';
import { ProfileAvatarComponent } from '../../atoms';
import type { Note } from '@maple/shared';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, switchMap } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ProfileAvatarComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit {
  private readonly router = inject(Router);
  readonly authService = inject(AuthService);
  readonly tagService = inject(TagService);
  readonly noteService = inject(NoteService);
  readonly messageService = inject(MessageService);
  readonly notificationService = inject(NotificationService);
  readonly networkService = inject(NetworkService);
  readonly route = inject(ActivatedRoute);

  readonly selectedTagId = input<string | null>(null);
  readonly selectedNoteId = toSignal(this.noteService.activeId$, { initialValue: null });

  readonly newNote = output<void>();
  readonly selectNote = output<string>();
  readonly selectTag = output<string>();
  readonly createTag = output<void>();
  readonly settings = output<void>();

  readonly searchQuery = signal('');
  readonly expandedTags = signal<Set<string>>(new Set());
  getNotesForTag = toSignal(
    this.noteService.notes$.pipe(
      map((notes) => {
        return notes
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .reduce(
            (acc, note) => {
              (acc[note.tagId || 'no_tag'] ??= []).push(note);
              return acc;
            },
            {} as Record<string, Note[]>,
          );
      }),
    ),
    { initialValue: {} as Record<string, Note[]> },
  );

  // readonly selectedNoteId = toSignal(this.route.paramMap.pipe(switchMap(()=>{
  //   this.this.noteService.activeId$(),
  // })), { initialValue: null });

  constructor() {
    // Auto-expand tag when selectedTagId changes
    effect(() => {
      const tagId = this.selectedTagId();
      if (tagId) {
        this.expandedTags.update((tags) => {
          const newTags = new Set(tags);
          newTags.add(tagId);
          return newTags;
        });
      }
    });
  }

  // Reactive computed signals for user data
  readonly userInitials = computed(() => {
    const user = this.authService.user();
    if (!user) return '?';
    const name = user.displayName || user.email.split('@')[0];
    return name.slice(0, 2).toUpperCase();
  });

  readonly userName = computed(() => {
    const user = this.authService.user();
    if (!user) return 'Guest';
    return user.displayName || user.email.split('@')[0];
  });

  readonly notificationUnreadCount = computed(() => {
    return this.notificationService.unreadCount();
  });

  readonly isOnline = this.networkService.isOnline;

  readonly statusText = computed(() => {
    return this.networkService.isOnline() ? 'Online' : 'Offline';
  });

  readonly statusColor = computed(() => {
    return this.networkService.isOnline() ? 'bg-green-500' : 'bg-gray-400';
  });

  ngOnInit(): void {
    // Load unread counts when sidebar initializes
    this.messageService.loadUnreadCounts().subscribe();
  }

  getUnreadCount(tagId: string): number {
    return this.messageService.getUnreadCount(tagId);
  }

  toggleTag(tagId: string): void {
    this.expandedTags.update((tags) => {
      const newTags = new Set(tags);
      if (newTags.has(tagId)) {
        newTags.delete(tagId);
      } else {
        newTags.add(tagId);
      }
      return newTags;
    });
    this.selectTag.emit(tagId);
    this.router.navigate(['/', tagId]);
  }

  // getNotesForTag(tagId: string): Signal<Note[]> {
  //   return toSignal(this.noteService.notesByTag$(tagId), { initialValue: [] });
  // }

  getNoteRouterLink(note: Note, tagId: string): string[] {
    const urlParam = note.documentId;
    return ['/', tagId, urlParam];
  }

  onNewNote(): void {
    this.newNote.emit();
  }

  onSelectNote(note: Note, tagId: string): void {
    // Emit noteId for backward compatibility
    this.selectNote.emit(note._id);
  }

  onCreateTag(): void {
    this.createTag.emit();
  }

  onSettings(): void {
    this.settings.emit();
  }

  onNotifications(): void {
    this.router.navigate(['/notifications']);
  }
}
