import {
  Component,
  input,
  signal,
  effect,
  inject,
  ElementRef,
  ViewChild,
  OnDestroy,
  afterNextRender,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { BotInvocation, NoteContent } from '@maple/shared';

@Component({
  selector: 'app-bot-output',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './bot-output.component.html',
  styleUrl: './bot-output.component.scss',
})
export class BotOutputComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private readonly http = inject(HttpClient);

  readonly invocationId = input.required<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly status = signal<BotInvocation['status']>('pending');

  private editor: Editor | null = null;
  private viewReady = false;
  private pendingContent: NoteContent | null = null;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    afterNextRender(() => {
      this.initEditor();
      this.viewReady = true;

      // Apply pending content if it arrived before view was ready
      if (this.pendingContent) {
        this.setEditorContent(this.pendingContent);
        this.pendingContent = null;
      }
    });

    effect(() => {
      const id = this.invocationId();
      if (id) {
        this.loadInvocation(id);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
    }
    this.editor?.destroy();
  }

  private initEditor(): void {
    if (!this.editorRef?.nativeElement) return;

    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      extensions: [
        StarterKit.configure({
          // Disable features not needed for read-only display
          dropcursor: false,
          gapcursor: false,
        }) as any,
      ],
      editable: false,
      content: '',
    });
  }

  private setEditorContent(content: NoteContent): void {
    if (!this.editor) {
      // Store for later if editor not ready
      this.pendingContent = content;
      return;
    }

    try {
      this.editor.commands.setContent(content);
    } catch (e) {
      console.error('Failed to set editor content:', e);
      // Fallback: try to extract text and display as paragraph
      this.editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Failed to render content' }],
          },
        ],
      });
    }
  }

  loadInvocation(id: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<{ invocation: BotInvocation }>(`/api/invocations/${id}`).subscribe({
      next: (response) => {
        const inv = response.invocation;
        this.status.set(inv.status);

        if (inv.status === 'failed') {
          this.error.set(inv.error?.message || 'Bot execution failed');
          this.loading.set(false);
          return;
        }

        if (inv.status === 'pending' || inv.status === 'running') {
          // Poll for updates if still processing
          this.pollTimeoutId = setTimeout(() => this.loadInvocation(id), 1000);
          return;
        }

        // Handle NoteContent output
        if (inv.output && typeof inv.output === 'object' && inv.output.type === 'doc') {
          this.setEditorContent(inv.output as NoteContent);
        } else if (typeof inv.output === 'string') {
          // Legacy: Convert raw string to NoteContent
          this.setEditorContent({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: inv.output ? [{ type: 'text', text: inv.output }] : [],
              },
            ],
          });
        } else {
          // Fallback for other output types
          const textOutput = inv.variables?.['$response'] as string | undefined;
          this.setEditorContent({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: textOutput ? [{ type: 'text', text: textOutput }] : [],
              },
            ],
          });
        }

        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load bot response');
        this.loading.set(false);
      },
    });
  }
}
