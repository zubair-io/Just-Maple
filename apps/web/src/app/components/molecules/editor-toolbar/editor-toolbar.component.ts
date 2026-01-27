import {
  Component,
  input,
  computed,
  signal,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  effect,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { trigger, state, style, animate, transition } from '@angular/animations';
import type { Editor } from '@tiptap/core';
import type { TodoPriority, TodoColor } from '@maple/shared';

interface ToolbarButton {
  icon: string;
  label: string;
  action: () => void;
  isActive?: () => boolean;
  disabled?: () => boolean;
}

interface ActiveTaskItem {
  id: string;
  checked: boolean;
  priority?: TodoPriority;
  color?: TodoColor;
  dueDate?: string;
  pos: number;
}

@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor-toolbar.component.html',
  styleUrl: './editor-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('slideInOut', [
      transition(':enter', [
        style({ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }),
        animate(
          '150ms ease-out',
          style({ opacity: 1, height: '*', paddingTop: '6px', paddingBottom: '6px' }),
        ),
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 })),
      ]),
    ]),
  ],
})
export class EditorToolbarComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private unsubscribeEditor: (() => void) | null = null;

  readonly editor = input.required<Editor | null>();

  // Active task item when cursor is in a task
  readonly activeTaskItem = signal<ActiveTaskItem | null>(null);

  // Priority options
  readonly priorities: { value: TodoPriority; label: string; shortLabel: string }[] = [
    { value: 'high', label: 'High Priority', shortLabel: 'High' },
    { value: 'medium', label: 'Medium Priority', shortLabel: 'Med' },
    { value: 'low', label: 'Low Priority', shortLabel: 'Low' },
  ];

  // Color options
  readonly colors: { value: TodoColor; hex: string; label: string }[] = [
    { value: 'red', hex: '#EF4444', label: 'Red' },
    { value: 'orange', hex: '#F97316', label: 'Orange' },
    { value: 'yellow', hex: '#EAB308', label: 'Yellow' },
    { value: 'green', hex: '#22C55E', label: 'Green' },
    { value: 'blue', hex: '#3B82F6', label: 'Blue' },
  ];

  constructor() {
    // Subscribe to editor transactions to update toolbar state
    effect(() => {
      const ed = this.editor();

      // Cleanup previous subscription
      if (this.unsubscribeEditor) {
        this.unsubscribeEditor();
        this.unsubscribeEditor = null;
      }

      if (ed) {
        const handler = () => {
          this.updateActiveTaskItem(ed);
          this.cdr.markForCheck();
        };
        ed.on('transaction', handler);
        ed.on('selectionUpdate', handler);

        this.unsubscribeEditor = () => {
          ed.off('transaction', handler);
          ed.off('selectionUpdate', handler);
        };
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.unsubscribeEditor) {
        this.unsubscribeEditor();
      }
    });
  }

  /**
   * Check if cursor is in a task item and get its attributes
   */
  private updateActiveTaskItem(ed: Editor): void {
    const { $from } = ed.state.selection;

    // Walk up the document tree to find a taskItem
    for (let d = $from.depth; d >= 0; d--) {
      const node = $from.node(d);
      if (node.type.name === 'taskItem') {
        const pos = $from.before(d);
        this.activeTaskItem.set({
          id: node.attrs['id'],
          checked: node.attrs['checked'] || false,
          priority: node.attrs['priority'],
          color: node.attrs['color'],
          dueDate: node.attrs['dueDate'],
          pos,
        });
        return;
      }
    }

    // Not in a task item
    this.activeTaskItem.set(null);
  }

  /**
   * Set priority on the active task item
   */
  setPriority(priority: TodoPriority | null): void {
    const task = this.activeTaskItem();
    const ed = this.editor();
    if (!task || !ed) return;

    (ed.commands as any).updateTodoAttrs(task.id, { priority: priority || undefined });
  }

  /**
   * Set color on the active task item
   */
  setColor(color: TodoColor | null): void {
    const task = this.activeTaskItem();
    const ed = this.editor();
    if (!task || !ed) return;

    (ed.commands as any).updateTodoAttrs(task.id, { color: color || undefined });
  }

  /**
   * Set due date on the active task item
   */
  setDueDate(dateStr: string): void {
    const task = this.activeTaskItem();
    const ed = this.editor();
    if (!task || !ed) return;

    if (dateStr) {
      const date = new Date(dateStr + 'T00:00:00');
      (ed.commands as any).updateTodoAttrs(task.id, { dueDate: date.toISOString() });
    } else {
      (ed.commands as any).updateTodoAttrs(task.id, { dueDate: undefined });
    }
  }

  /**
   * Clear due date on the active task item
   */
  clearDueDate(): void {
    const task = this.activeTaskItem();
    const ed = this.editor();
    if (!task || !ed) return;

    (ed.commands as any).updateTodoAttrs(task.id, { dueDate: undefined });
  }

  /**
   * Get formatted date for the date input
   */
  getFormattedDate(): string {
    const task = this.activeTaskItem();
    if (!task?.dueDate) return '';
    const date = new Date(task.dueDate);
    return date.toISOString().split('T')[0];
  }

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
