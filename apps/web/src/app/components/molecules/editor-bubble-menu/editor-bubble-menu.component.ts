import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Editor } from '@tiptap/core';
import { IconComponent } from '../../atoms/icon/icon.component';

interface BubbleButton {
  icon: string;
  label: string;
  action: () => void;
  isActive: () => boolean;
}

@Component({
  selector: 'app-editor-bubble-menu',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './editor-bubble-menu.component.html',
  styleUrl: './editor-bubble-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorBubbleMenuComponent implements OnDestroy {
  readonly editor = input<Editor | null>(null);
  readonly openAIMenu = output<void>();

  // Bumped on every editor transaction/selection change so the active states of
  // the formatting buttons recompute (the component is OnPush).
  private readonly editorStateVersion = signal(0);
  private editorUnsubscribe?: () => void;

  constructor() {
    effect(() => {
      const ed = this.editor();

      if (this.editorUnsubscribe) {
        this.editorUnsubscribe();
        this.editorUnsubscribe = undefined;
      }

      if (ed) {
        const handler = () => this.editorStateVersion.update((v) => v + 1);
        ed.on('selectionUpdate', handler);
        ed.on('transaction', handler);
        this.editorUnsubscribe = () => {
          ed.off('selectionUpdate', handler);
          ed.off('transaction', handler);
        };
      }
    });
  }

  ngOnDestroy(): void {
    this.editorUnsubscribe?.();
  }

  readonly formattingButtons = computed<BubbleButton[]>(() => {
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
      {
        icon: '🔗',
        label: 'Link',
        action: () => this.editLink(ed),
        isActive: () => ed.isActive('link'),
      },
    ];
  });

  /**
   * Minimal link insert/edit flow: prompt for a URL applied to the current
   * selection (or the link under the cursor). Empty removes the link; the Link
   * mark validates the protocol so javascript: URLs are dropped.
   */
  private editLink(ed: Editor): void {
    const previousUrl = (ed.getAttributes('link')?.['href'] as string) || '';
    const url = window.prompt('Link URL', previousUrl);
    if (url === null) return;
    if (url.trim() === '') {
      (ed.chain().focus() as any).extendMarkRange('link').unsetLink().run();
      return;
    }
    (ed.chain().focus() as any).extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  onOpenAIMenu(): void {
    this.openAIMenu.emit();
  }
}
