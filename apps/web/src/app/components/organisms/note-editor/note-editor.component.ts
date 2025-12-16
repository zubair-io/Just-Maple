import {
  Component,
  input,
  output,
  signal,
  effect,
  ElementRef,
  ViewChild,
  OnDestroy,
  afterNextRender,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import { EmojiReplacer } from './extensions/emoji-replacer';
import { CodeEnterHandler } from './extensions/code-enter-handler';
import type { Note, Tag, NoteContent } from '@maple/shared';

@Component({
  selector: 'app-note-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './note-editor.component.html',
  styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent implements OnDestroy {
  @ViewChild('editorElement', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  readonly note = input<Note | null>(null);
  readonly tag = input<Tag | null>(null);
  readonly editable = input<boolean>(true);

  readonly contentChange = output<NoteContent>();

  readonly isFocused = signal(false);

  private editor: Editor | null = null;
  private lastNoteId: string | null = null;
  private isUpdatingFromNote = false;
  private readonly viewReady = signal(false);

  constructor() {
    // Initialize editor after view is ready
    afterNextRender(() => {
      this.initEditor();
      this.viewReady.set(true);
    });

    // Handle note changes (initial load + updates)
    effect(() => {
      const currentNote = this.note();
      if (!this.viewReady() || !this.editor) return;

      if (currentNote?._id !== this.lastNoteId) {
        this.lastNoteId = currentNote?._id ?? null;
        this.updateEditorContent(currentNote?.content ?? null);
      }
    });

    // Update editable state
    effect(() => {
      const isEditable = this.editable();
      this.editor?.setEditable(isEditable);
    });
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  private initEditor(): void {
    if (!this.editorRef?.nativeElement) return;

    // Document schema: must start with heading, then any blocks
    const TitleDocument = Document.extend({
      content: 'heading block*',
    });

    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      editable: this.editable(),
      extensions: [
        TitleDocument,
        StarterKit.configure({
          document: false,
          heading: false, // Use custom Heading below
        }),
        Heading.configure({
          levels: [1, 2, 3],
        }),
        TaskItem.configure({
          nested: true,
        }),
        TaskList,
        Highlight,
        Typography,
        EmojiReplacer,
        CodeEnterHandler,
        Placeholder.configure({
          placeholder: ({ node }) => {
            if (node.type.name === 'heading' && node.attrs['level'] === 1) {
              return 'Untitled';
            }
            return 'Start writing...';
          },
        }),
      ],
      content: '',
      onUpdate: ({ editor }) => {
        if (!this.isUpdatingFromNote) {
          const json = editor.getJSON() as NoteContent;
          this.contentChange.emit(json);
        }
      },
      onFocus: () => {
        this.isFocused.set(true);
      },
      onBlur: () => {
        this.isFocused.set(false);
      },
    });

    // Load initial content if note exists
  }

  private updateEditorContent(content: NoteContent | null | undefined): void {
    if (!this.editor) return;

    this.isUpdatingFromNote = true;
    try {
      if (content && typeof content === 'object') {
        this.editor.commands.setContent(content);
      } else {
        this.editor.commands.setContent('');
      }
    } finally {
      this.isUpdatingFromNote = false;
    }
  }

  focusEditor(): void {
    this.editor?.commands.focus();
  }

  focusTitle(): void {
    // Focus at the start (the H1 title)
    this.editor?.commands.focus('start');
  }

  // Toolbar commands
  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleHeading(level: 1 | 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  toggleTaskList(): void {
    this.editor?.chain().focus().toggleTaskList().run();
  }

  toggleBlockquote(): void {
    this.editor?.chain().focus().toggleBlockquote().run();
  }

  toggleCode(): void {
    this.editor?.chain().focus().toggleCode().run();
  }

  toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  // Check if format is active
  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    return this.editor?.isActive(name, attrs) ?? false;
  }
}
