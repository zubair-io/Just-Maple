import { Component, inject, signal, computed, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, Subscription, filter, takeUntil } from 'rxjs';
import { TagService } from '../../services/tag.service';
import { NoteService } from '../../services/note.service';
import { BotService } from '../../services/bot.service';
import { RealtimeService } from '../../services/realtime.service';
import { NoteEditorComponent } from '../../components';
import { type NoteContent, DEFAULT_NOTE_CONTENT, extractText } from '@maple/shared';
import type { BotWidgetAttrs } from '../../components/organisms/note-editor/extensions/bot-widget';

/** Extract title text from the first H1 heading in content */
function extractTitleFromContent(content: NoteContent): string {
  const firstNode = content.content?.[0];
  if (firstNode?.type === 'heading' && firstNode.attrs?.level === 1) {
    const textNode = firstNode.content?.[0];
    return textNode?.text || 'Untitled';
  }
  return 'Untitled';
}

@Component({
  selector: 'app-note-view',
  standalone: true,
  imports: [CommonModule, NoteEditorComponent],
  templateUrl: './note-view.component.html',
  styleUrl: './note-view.component.scss',
})
export class NoteViewComponent implements OnInit, OnDestroy {
  @ViewChild(NoteEditorComponent) private noteEditor?: NoteEditorComponent;

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly tagService = inject(TagService);
  readonly noteService = inject(NoteService);
  private readonly botService = inject(BotService);
  private readonly realtimeService = inject(RealtimeService);

  private routeSubscription?: Subscription;
  private readonly destroy$ = new Subject<void>();

  // Track pending widget invocations by widgetId
  private readonly pendingWidgets = new Map<string, { botHandle: string; invocationId?: string }>();

  readonly selectedNoteId = signal<string | null>(null);
  readonly selectedTagId = signal<string | null>(null);

  // Computed signals reactively derive from store - no validation needed
  readonly selectedNote = computed(() => {
    const id = this.selectedNoteId();
    if (!id) return null;
    return this.noteService.notes().find((n) => n._id === id) || null;
  });

  readonly selectedTag = computed(() => {
    const tagId = this.selectedTagId();
    if (tagId) {
      return this.tagService.tags().find((t) => t._id === tagId) || null;
    }
    const note = this.selectedNote();
    if (note?.tagId) {
      return this.tagService.tags().find((t) => t._id === note.tagId) || null;
    }
    return null;
  });

  readonly formattedDate = computed(() => {
    const note = this.selectedNote();
    if (!note?.updatedAt) return '';
    return this.formatDateValue(note.updatedAt);
  });

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    // Subscribe to route params and set IDs directly - let computed handle the rest
    this.routeSubscription = this.route.params.subscribe((params) => {
      this.selectedTagId.set(params['tagId'] || null);
      this.selectedNoteId.set(params['noteId'] || null);
    });

    // Subscribe to bot events for widget updates
    this.subscribeToBotEvents();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private subscribeToBotEvents(): void {
    this.realtimeService.events$
      .pipe(
        filter((event) => this.isBotEvent(event)),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        this.handleBotEvent(event);
      });
  }

  private isBotEvent(event: { action: string }): boolean {
    return ['bot_started', 'bot_completed', 'bot_failed'].includes(event.action);
  }

  private handleBotEvent(event: { action: string; data: unknown }): void {
    const data = event.data as Record<string, unknown>;
    const invocationId = data['invocationId'] as string;

    // Find widget by invocationId
    let widgetId: string | null = null;
    for (const [wId, info] of this.pendingWidgets.entries()) {
      if (info.invocationId === invocationId) {
        widgetId = wId;
        break;
      }
    }

    if (!widgetId) return;

    switch (event.action) {
      case 'bot_started':
        this.noteEditor?.updateBotWidget(widgetId, { status: 'running' });
        break;
      case 'bot_completed': {
        const output = data['response'] as string;
        this.noteEditor?.updateBotWidget(widgetId, {
          status: 'completed',
          output,
        });
        this.pendingWidgets.delete(widgetId);
        break;
      }
      case 'bot_failed': {
        const error = (data['error'] as string) || 'Bot invocation failed';
        this.noteEditor?.updateBotWidget(widgetId, {
          status: 'failed',
          error,
        });
        this.pendingWidgets.delete(widgetId);
        break;
      }
    }
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
          this.selectedNoteId.set(note._id);
          if (tagId) {
            this.router.navigate(['/', tagId, note._id]);
          }
        },
        error: (error) => {
          console.error('Failed to create note:', error);
        },
      });
  }

  toggleFavorite(): void {
    const noteId = this.selectedNoteId();
    if (!noteId) return;

    this.noteService.toggleFavorite(noteId).subscribe({
      error: (error) => {
        console.error('Failed to toggle favorite:', error);
      },
    });
  }

  onContentChange(content: NoteContent): void {
    const title = extractTitleFromContent(content);
    this.debouncedSave({ content, title });
  }

  onBotInvoked(event: { botHandle: string; widgetId: string }): void {
    const tagId = this.selectedTagId();
    const noteId = this.selectedNoteId();
    const note = this.selectedNote();

    if (!tagId || !noteId) return;

    // Track this widget as pending
    this.pendingWidgets.set(event.widgetId, { botHandle: event.botHandle });

    // Build context from note content
    const context = {
      fullContent: this.extractNoteContext(note?.content),
      documentTitle: note?.title,
    };

    // Invoke the bot
    this.botService.invokeBot(tagId, event.botHandle, 'note', noteId, context).subscribe({
      next: (invocation) => {
        // Store the invocation ID for tracking real-time updates
        const pending = this.pendingWidgets.get(event.widgetId);
        if (pending) {
          pending.invocationId = invocation._id;
        }

        // Update widget to running state
        this.noteEditor?.updateBotWidget(event.widgetId, {
          invocationId: invocation._id,
          status: 'running',
        });
      },
      error: (err) => {
        // Update widget to error state
        this.noteEditor?.updateBotWidget(event.widgetId, {
          status: 'failed',
          error: err.message || 'Failed to invoke bot',
        });
        this.pendingWidgets.delete(event.widgetId);
      },
    });
  }

  private extractNoteContext(content: NoteContent | undefined): string {
    // Use shared utility with max length for context
    return extractText(content, { maxLength: 500, includeNewlines: false });
  }

  private debouncedSave(data: { title?: string; content?: NoteContent }): void {
    const noteId = this.selectedNoteId();
    if (!noteId) return;

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.noteService.updateNote(noteId, data).subscribe({
        error: (error) => {
          console.error('Failed to save note:', error);
        },
      });
    }, 500);
  }

  private formatDateValue(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }
}
