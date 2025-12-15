import {
    Component,
    input,
    output,
    signal,
    effect,
    ElementRef,
    ViewChild,
    OnDestroy,
    AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatComponent } from '../chat/chat.component';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Highlight from '@tiptap/extension-highlight';
import Typography from '@tiptap/extension-typography';
import { EmojiReplacer } from './extensions/emoji-replacer';
import type { Note, Tag, NoteContent } from '@maple/shared';

@Component({
    selector: 'app-note-editor',
    standalone: true,
    imports: [CommonModule, ChatComponent],
    templateUrl: './note-editor.component.html',
    styleUrl: './note-editor.component.scss',
})
export class NoteEditorComponent implements AfterViewInit, OnDestroy {
    @ViewChild('editorElement', { static: false })
    private editorRef?: ElementRef<HTMLElement>;

    @ViewChild('titleInput', { static: false })
    private titleInputRef?: ElementRef<HTMLInputElement>;

    readonly note = input<Note | null>(null);
    readonly tag = input<Tag | null>(null);
    readonly editable = input<boolean>(true);

    readonly titleChange = output<string>();
    readonly contentChange = output<NoteContent>();

    readonly title = signal('');
    readonly isFocused = signal(false);

    private editor: Editor | null = null;
    private lastNoteId: string | null = null;
    private isUpdatingFromNote = false;

    constructor() {
        effect(() => {
            const currentNote = this.note();
            if (currentNote && currentNote._id !== this.lastNoteId) {
                this.lastNoteId = currentNote._id;
                this.title.set(currentNote.title);
                // Initialize editor if not yet done
                if (!this.editor && this.editorRef) {
                    this.initEditor();
                }
                this.updateEditorContent(currentNote.content);
            } else if (!currentNote) {
                this.lastNoteId = null;
                this.title.set('');
                this.updateEditorContent(null);
            }
        });

        effect(() => {
            const isEditable = this.editable();
            if (this.editor) {
                this.editor.setEditable(isEditable);
            }
        });
    }

    ngAfterViewInit(): void {
        // Only initialize if note is already set and we have the element
        if (this.note() && this.editorRef) {
            this.initEditor();
        }
    }

    ngOnDestroy(): void {
        this.editor?.destroy();
    }

    private initEditor(): void {
        if (!this.editorRef?.nativeElement) return;

        const CustomDocument = Document.extend({
            content: 'block+',
        });

        this.editor = new Editor({
            element: this.editorRef.nativeElement,
            editable: this.editable(),
            extensions: [
                CustomDocument,
                StarterKit.configure({
                    document: false,
                }),
                TaskItem.configure({
                    nested: true,
                }),
                TaskList,
                Highlight,
                Typography,
                EmojiReplacer,
                Placeholder.configure({
                    placeholder: 'Start writing...',
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
        const currentNote = this.note();
        if (currentNote) {
            this.updateEditorContent(currentNote.content);
        }
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

    onTitleChange(event: Event): void {
        const input = event.target as HTMLInputElement;
        this.title.set(input.value);
        this.titleChange.emit(input.value);
    }

    onTitleKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            this.editor?.commands.focus('start');
        }
    }

    focusTitle(): void {
        this.titleInputRef?.nativeElement?.focus();
    }

    focusEditor(): void {
        this.editor?.commands.focus();
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
