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
      navigator.userAgent.includes('JapaneseMaple')
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
      {
        icon: '🖍',
        label: 'Highlight',
        action: () => (ed.chain().focus() as any).toggleHighlight().run(),
        isActive: () => ed.isActive('highlight'),
      },
    ];
  });

  readonly blockButtons = computed<ToolbarButton[]>(() => {
    // Depend on state version so active states recompute per transaction.
    this.editorStateVersion();
    const ed = this.editor();
    if (!ed) return [];

    // Headings are already exposed via textTypeButtons; this group covers the
    // block types that have no other toolbar control.
    return [
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
    this.editorStateVersion();
    const ed = this.editor();
    if (!ed) return [];

    return [
      {
        icon: '🔗',
        label: 'Link',
        action: () => this.editLink(ed),
        isActive: () => ed.isActive('link'),
      },
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

  /**
   * Minimal link insert/edit flow: prompt for a URL, applying it to the current
   * selection (or the whole link under the cursor). An empty value removes the
   * link. The Link mark validates the protocol, so javascript: URLs are dropped.
   */
  private editLink(ed: Editor): void {
    const previousUrl = (ed.getAttributes('link')?.['href'] as string) || '';
    const url = window.prompt('Link URL', previousUrl);
    if (url === null) {
      return; // cancelled
    }
    if (url.trim() === '') {
      (ed.chain().focus() as any).extendMarkRange('link').unsetLink().run();
      return;
    }
    (ed.chain().focus() as any).extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  readonly historyButtons = computed<ToolbarButton[]>(() => {
    this.editorStateVersion();
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
