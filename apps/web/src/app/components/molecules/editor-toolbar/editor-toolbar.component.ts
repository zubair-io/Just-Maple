import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Editor } from '@tiptap/core';

interface ToolbarButton {
  icon: string;
  label: string;
  action: () => void;
  isActive?: () => boolean;
  disabled?: () => boolean;
}

@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-toolbar.component.html',
  styleUrl: './editor-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorToolbarComponent {
  readonly editor = input.required<Editor | null>();

  readonly formattingButtons = computed<ToolbarButton[]>(() => {
    const ed = this.editor();
    if (!ed) return [];

    return [
      {
        icon: 'B',
        label: 'Bold',
        action: () => (ed.chain().focus() as any).toggleBold().run(),
        isActive: () => ed.isActive('bold'),
      },
      {
        icon: 'I',
        label: 'Italic',
        action: () => (ed.chain().focus() as any).toggleItalic().run(),
        isActive: () => ed.isActive('italic'),
      },
      {
        icon: 'U',
        label: 'Underline',
        action: () => (ed.chain().focus() as any).toggleUnderline().run(),
        isActive: () => ed.isActive('underline'),
      },
      {
        icon: 'S',
        label: 'Strikethrough',
        action: () => (ed.chain().focus() as any).toggleStrike().run(),
        isActive: () => ed.isActive('strike'),
      },
      {
        icon: '</>',
        label: 'Code',
        action: () => (ed.chain().focus() as any).toggleCode().run(),
        isActive: () => ed.isActive('code'),
      },
    ];
  });

  readonly blockButtons = computed<ToolbarButton[]>(() => {
    const ed = this.editor();
    if (!ed) return [];

    return [
      {
        icon: 'H1',
        label: 'Heading 1',
        action: () => (ed.chain().focus() as any).toggleHeading({ level: 1 }).run(),
        isActive: () => ed.isActive('heading', { level: 1 }),
      },
      {
        icon: 'H2',
        label: 'Heading 2',
        action: () => (ed.chain().focus() as any).toggleHeading({ level: 2 }).run(),
        isActive: () => ed.isActive('heading', { level: 2 }),
      },
      {
        icon: 'H3',
        label: 'Heading 3',
        action: () => (ed.chain().focus() as any).toggleHeading({ level: 3 }).run(),
        isActive: () => ed.isActive('heading', { level: 3 }),
      },
      {
        icon: '•',
        label: 'Bullet List',
        action: () => (ed.chain().focus() as any).toggleBulletList().run(),
        isActive: () => ed.isActive('bulletList'),
      },
      {
        icon: '1.',
        label: 'Numbered List',
        action: () => (ed.chain().focus() as any).toggleOrderedList().run(),
        isActive: () => ed.isActive('orderedList'),
      },
      {
        icon: '☑',
        label: 'Task List',
        action: () => (ed.chain().focus() as any).toggleTaskList().run(),
        isActive: () => ed.isActive('taskList'),
      },
      {
        icon: '"',
        label: 'Quote',
        action: () => (ed.chain().focus() as any).toggleBlockquote().run(),
        isActive: () => ed.isActive('blockquote'),
      },
      {
        icon: '—',
        label: 'Divider',
        action: () => (ed.chain().focus() as any).setHorizontalRule().run(),
      },
    ];
  });

  readonly insertButtons = computed<ToolbarButton[]>(() => {
    const ed = this.editor();
    if (!ed) return [];

    return [
      {
        icon: '▦',
        label: 'Table',
        action: () =>
          (ed.chain().focus() as any).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        icon: '{ }',
        label: 'Code Block',
        action: () => (ed.chain().focus() as any).toggleCodeBlock().run(),
        isActive: () => ed.isActive('codeBlock'),
      },
    ];
  });

  readonly historyButtons = computed<ToolbarButton[]>(() => {
    const ed = this.editor();
    if (!ed) return [];

    return [
      {
        icon: '↩',
        label: 'Undo',
        action: () => ed.chain().focus().undo().run(),
        disabled: () => !ed.can().undo(),
      },
      {
        icon: '↪',
        label: 'Redo',
        action: () => ed.chain().focus().redo().run(),
        disabled: () => !ed.can().redo(),
      },
    ];
  });
}
