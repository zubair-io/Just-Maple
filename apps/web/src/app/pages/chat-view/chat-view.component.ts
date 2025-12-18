import { Component, inject, signal, computed, OnInit, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { NotificationService } from '../../services/notification.service';
import { ChatComponent } from '../../components';
import { DEFAULT_NOTE_CONTENT } from '@maple/shared';

@Component({
  selector: 'app-chat-view',
  standalone: true,
  imports: [CommonModule, ChatComponent],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.scss',
})
export class ChatViewComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly noteService = inject(NoteService);
  private readonly notificationService = inject(NotificationService);

  private routeSubscription?: Subscription;

  readonly selectedTagId = signal<string | null>(null);

  constructor() {
    // Track active tag for smart notification filtering
    effect(() => {
      const tagId = this.selectedTagId();
      this.notificationService.setActiveTag(tagId);
    });
  }

  // Computed signals reactively derive from store - no validation needed
  readonly selectedTag = computed(() => {
    const tagId = this.selectedTagId();
    if (!tagId) return null;
    return this.tagService.tags().find((t) => t._id === tagId) || null;
  });

  ngOnInit(): void {
    // Subscribe to route params and set ID directly - let computed handle the rest
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedTagId.set(params['tagId'] || null);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    // Clear active tag when leaving chat view
    this.notificationService.setActiveTag(null);
  }

  createNote(): void {
    const tagId = this.selectedTagId();

    this.noteService
      .createNote({
        title: 'Untitled',
        content: DEFAULT_NOTE_CONTENT,
        tagId: tagId || undefined,
      })
      .subscribe({
        next: (note) => {
          if (tagId) {
            this.router.navigate(['/', tagId, note._id]);
          }
        },
        error: (error) => {
          console.error('Failed to create note:', error);
        },
      });
  }
}
