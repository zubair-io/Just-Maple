import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Editor } from '@tiptap/core';

type MenuMode = 'format' | 'todo';

interface ActiveTodo {
  id: string;
  priority: string | null;
  color: string | null;
  dueDate: string | null;
}

const PRIORITIES = [
  { value: 'high', icon: 'keyboard_double_arrow_up', title: 'High' },
  { value: 'medium', icon: 'remove', title: 'Medium' },
  { value: 'low', icon: 'keyboard_double_arrow_down', title: 'Low' },
] as const;

const COLORS = [
  { value: 'red', hex: '#EF4444' },
  { value: 'orange', hex: '#F97316' },
  { value: 'yellow', hex: '#EAB308' },
  { value: 'green', hex: '#22C55E' },
  { value: 'blue', hex: '#3B82F6' },
] as const;

@Component({
  selector: 'app-editor-bubble-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-bubble-menu.component.html',
  styleUrl: './editor-bubble-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorBubbleMenuComponent {
  readonly editor = input<Editor | null>(null);
  readonly stateVersion = input<number>(0);

  readonly mode = signal<MenuMode>('format');
  readonly priorities = PRIORITIES;
  readonly colors = COLORS;

  readonly isInTaskItem = computed(() => {
    // Track stateVersion so this recomputes on selection change
    this.stateVersion();
    const ed = this.editor();
    if (!ed) return false;
    return ed.isActive('taskItem');
  });

  readonly activeTodo = computed((): ActiveTodo | null => {
    this.stateVersion();
    const ed = this.editor();
    if (!ed) return null;

    const { $from } = ed.state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'taskItem') {
        return {
          id: n.attrs['id'],
          priority: n.attrs['priority'] || null,
          color: n.attrs['color'] || null,
          dueDate: n.attrs['dueDate'] || null,
        };
      }
    }
    return null;
  });

  readonly dueDateValue = computed(() => {
    const todo = this.activeTodo();
    if (!todo?.dueDate) return '';
    return new Date(todo.dueDate).toISOString().split('T')[0];
  });

  // Auto-switch to todo mode when entering a task item
  constructor() {
    effect(() => {
      if (this.isInTaskItem()) {
        this.mode.set('todo');
      } else {
        this.mode.set('format');
      }
    });
  }

  // ── Format actions ──

  isActive(name: string, attrs?: Record<string, unknown>): boolean {
    this.stateVersion();
    const ed = this.editor();
    if (!ed) return false;
    return ed.isActive(name, attrs);
  }

  toggleBold(): void {
    this.editor()?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor()?.chain().focus().toggleItalic().run();
  }

  toggleStrike(): void {
    this.editor()?.chain().focus().toggleStrike().run();
  }

  toggleCode(): void {
    this.editor()?.chain().focus().toggleCode().run();
  }

  // ── Todo actions ──

  setPriority(value: string): void {
    const todo = this.activeTodo();
    if (!todo) return;
    const newValue = todo.priority === value ? null : value;
    (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
      priority: newValue || undefined,
    });
  }

  setColor(value: string): void {
    const todo = this.activeTodo();
    if (!todo) return;
    const newValue = todo.color === value ? null : value;
    (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
      color: newValue || undefined,
    });
  }

  setDueDate(event: Event): void {
    const todo = this.activeTodo();
    if (!todo) return;
    const value = (event.target as HTMLInputElement).value;
    if (value) {
      const date = new Date(value + 'T00:00:00');
      (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
        dueDate: date.toISOString(),
      });
    } else {
      (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
        dueDate: undefined,
      });
    }
  }

  clearDueDate(): void {
    const todo = this.activeTodo();
    if (!todo) return;
    (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
      dueDate: undefined,
    });
  }

  toggleMode(): void {
    this.mode.update((m) => (m === 'format' ? 'todo' : 'format'));
  }
}
