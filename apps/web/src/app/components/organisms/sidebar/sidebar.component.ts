import { Component, inject, signal, computed, output, input, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { TagService } from '../../../services/tag.service';
import { NoteService } from '../../../services/note.service';
import { MessageService } from '../../../services/message.service';
import { NotificationService } from '../../../services/notification.service';
import { NetworkService } from '../../../services/network.service';
import { ProfileAvatarComponent } from '../../atoms';
import type { Note } from '@maple/shared';

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

  readonly selectedTagId = input<string | null>(null);
  readonly selectedNoteId = input<string | null>(null);

  readonly newNote = output<void>();
  readonly selectNote = output<string>();
  readonly selectTag = output<string>();
  readonly createTag = output<void>();
  readonly settings = output<void>();

  readonly searchQuery = signal('');
  readonly expandedTags = signal<Set<string>>(new Set());

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

  getNotesForTag(tagId: string): Note[] {
    return this.noteService.notes().filter((n) => n.tagId === tagId);
  }

  getNoteRouterLink(note: Note, tagId: string): string[] {
    // Use docUrl if available, fallback to _id for backward compatibility
    const urlParam = note.docUrl || note._id;
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
