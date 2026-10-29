import {
  Component,
  input,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkOverlayOrigin, CdkConnectedOverlay } from '@angular/cdk/overlay';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import type { Editor } from '@tiptap/core';

type ToolbarMode = 'format' | 'todo';

interface ToolbarButton {
  icon: string;
  label: string;
  action: () => void;
  isActive?: () => boolean;
  disabled?: () => boolean;
}

interface ActiveTodo {
  id: string;
  priority: string | null;
  color: string | null;
  dueDate: string | null;
}

const TODO_PRIORITIES = [
  { value: 'high', icon: 'keyboard_double_arrow_up', title: 'High' },
  { value: 'medium', icon: 'remove', title: 'Medium' },
  { value: 'low', icon: 'keyboard_double_arrow_down', title: 'Low' },
] as const;

const TODO_COLORS = [
  { value: 'red', hex: '#EF4444' },
  { value: 'orange', hex: '#F97316' },
  { value: 'yellow', hex: '#EAB308' },
  { value: 'green', hex: '#22C55E' },
  { value: 'blue', hex: '#3B82F6' },
] as const;

@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  imports: [CommonModule, MatDatepickerModule, CdkOverlayOrigin, CdkConnectedOverlay],
  providers: [provideNativeDateAdapter()],
  templateUrl: './editor-toolbar.component.html',
  styleUrl: './editor-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.bottom]': 'toolbarBottom()',
  },
})
export class EditorToolbarComponent implements OnInit, OnDestroy {
  readonly editor = input.required<Editor | null>();

  // Signal to track editor state updates (increments on each transaction)
  private readonly editorStateVersion = signal(0);

  // Keyboard offset for mobile browsers (not iOS native app)
  readonly keyboardOffset = signal(0);

  // Store cleanup function for editor listener
  private editorUnsubscribe?: () => void;

  constructor() {
    // Listen to editor changes and update state version
    effect(() => {
      const ed = this.editor();

      // Cleanup previous listener
      if (this.editorUnsubscribe) {
        this.editorUnsubscribe();
        this.editorUnsubscribe = undefined;
      }

      if (ed) {
        // Subscribe to editor updates
        const handler = () => {
          this.editorStateVersion.update((v) => v + 1);
        };
        ed.on('selectionUpdate', handler);
        ed.on('transaction', handler);

        this.editorUnsubscribe = () => {
          ed.off('selectionUpdate', handler);
          ed.off('transaction', handler);
        };
      }
    });
  }

  // Computed bottom position
  readonly toolbarBottom = computed(() => {
    const offset = this.keyboardOffset();
    if (offset > 0) {
      return `${offset}px`;
    }
    return `calc(1rem + env(safe-area-inset-bottom))`;
  });

  // Check if running in iOS native app (WebView)
  private isNativeApp(): boolean {
    // Check for native bridge or specific markers set by the native app
    return (
      !!(window as any).webkit?.messageHandlers?.nativeBridge ||
      navigator.userAgent.includes('SugarMaple')
    );
  }

  // Check if mobile browser
  private isMobileBrowser(): boolean {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !this.isNativeApp();
  }

  private handleViewportResize = (): void => {
    if (!this.isMobileBrowser()) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    // Calculate keyboard height
    const keyboardHeight = window.innerHeight - viewport.height;

    // Only apply offset if keyboard is likely open (height > 100px)
    if (keyboardHeight > 100) {
      this.keyboardOffset.set(keyboardHeight);
    } else {
      this.keyboardOffset.set(0);
    }
  };

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.visualViewport && this.isMobileBrowser()) {
      window.visualViewport.addEventListener('resize', this.handleViewportResize);
      window.visualViewport.addEventListener('scroll', this.handleViewportResize);
    }
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.handleViewportResize);
      window.visualViewport.removeEventListener('scroll', this.handleViewportResize);
    }

    // Cleanup editor listener
    if (this.editorUnsubscribe) {
      this.editorUnsubscribe();
    }
  }

  // ── Mode switching ──

  readonly mode = signal<ToolbarMode>('format');
  readonly priorities = TODO_PRIORITIES;
  readonly colors = TODO_COLORS;

  readonly isInTaskItem = computed(() => {
    this.editorStateVersion();
    const ed = this.editor();
    if (!ed) return false;
    return ed.isActive('taskItem');
  });

  readonly activeTodo = computed((): ActiveTodo | null => {
    this.editorStateVersion();
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

  readonly colorPickerOpen = signal(false);

  readonly activeColorHex = computed(() => {
    const todo = this.activeTodo();
    if (!todo?.color) return null;
    return TODO_COLORS.find((c) => c.value === todo.color)?.hex ?? null;
  });

  readonly dueDateAsDate = computed((): Date | null => {
    const todo = this.activeTodo();
    if (!todo?.dueDate) return null;
    return new Date(todo.dueDate);
  });

  readonly dueDateLabel = computed(() => {
    const todo = this.activeTodo();
    if (!todo?.dueDate) return 'Due date';
    const date = new Date(todo.dueDate);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  // Auto-switch mode based on cursor position
  private readonly _autoSwitchMode = effect(() => {
    if (this.isInTaskItem()) {
      this.mode.set('todo');
    } else {
      this.mode.set('format');
    }
  });

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
    this.colorPickerOpen.set(false);
  }

  onDateSelected(date: Date | null): void {
    const todo = this.activeTodo();
    if (!todo || !date) return;
    (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
      dueDate: date.toISOString(),
    });
  }

  clearDueDate(event: Event): void {
    event.stopPropagation();
    const todo = this.activeTodo();
    if (!todo) return;
    (this.editor()?.commands as any).updateTodoAttrs(todo.id, {
      dueDate: undefined,
    });
  }

  toggleMode(): void {
    this.mode.update((m) => (m === 'format' ? 'todo' : 'format'));
  }

  // ── Format buttons ──

  readonly textTypeButtons = computed<ToolbarButton[]>(() => {
    // Depend on state version to trigger recalculation
    this.editorStateVersion();
    const ed = this.editor();
    if (!ed) return [];

    return [
      {
        icon: '¶',
        label: 'Paragraph',
        action: () => (ed.chain().focus() as any).setParagraph().run(),
        isActive: () => ed.isActive('paragraph') && !ed.isActive('heading'),
      },
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
    ];
  });

  readonly formattingButtons = computed<ToolbarButton[]>(() => {
    // Depend on state version to trigger recalculation
    this.editorStateVersion();
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
