import {
  Component,
  input,
  effect,
  ElementRef,
  ViewChild,
  OnDestroy,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Highlight from '@tiptap/extension-highlight';
import { Mention } from '../../organisms/chat/extensions/mention';
import type { PageContent } from '@maple/shared';

@Component({
  selector: 'app-content-renderer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './content-renderer.component.html',
  styleUrl: './content-renderer.component.scss',
})
export class ContentRendererComponent implements AfterViewInit, OnDestroy {
  @ViewChild('editorElement', { static: true })
  private editorRef!: ElementRef<HTMLElement>;

  readonly content = input<PageContent | string | null>(null);

  private editor: Editor | null = null;

  constructor() {
    effect(() => {
      const content = this.content();
      if (this.editor) {
        this.editor.commands.setContent(this.normalizeContent(content));
      }
    });
  }

  /**
   * Normalize content to a format TipTap can render
   * Handles: ProseMirror JSON, plain strings, or null
   */
  private normalizeContent(content: PageContent | string | null): PageContent | string {
    if (!content) {
      return '';
    }
    // Already ProseMirror JSON format
    if (typeof content === 'object' && 'type' in content) {
      return content;
    }
    // Plain text string - TipTap can handle this directly
    if (typeof content === 'string') {
      return JSON.parse(content);
    }
    return '';
  }

  ngAfterViewInit(): void {
    this.initEditor();
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
  }

  private initEditor(): void {
    this.editor = new Editor({
      element: this.editorRef.nativeElement,
      editable: false,
      extensions: [
        StarterKit as any,
        TaskItem.configure({
          nested: true,
        }) as any,
        TaskList as any,
        Highlight as any,
        Mention.configure({
          HTMLAttributes: {
            class: 'mention',
          },
        }) as any,
      ],
      content: '',
    });

    // Load initial content
    const initialContent = this.content();
    this.editor.commands.setContent(this.normalizeContent(initialContent));
  }
}
