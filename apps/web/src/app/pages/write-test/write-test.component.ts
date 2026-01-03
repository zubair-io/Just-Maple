import { Component, ElementRef, ViewChild, afterNextRender, OnDestroy } from '@angular/core';
import { Repo } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { init, SchemaAdapter } from '@automerge/prosemirror';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { wrapInList, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { SimpleNetworkAdapter } from './simple-network-adapter';

// Create a rich text schema adapter for Automerge
function createRichTextSchemaAdapter(): SchemaAdapter {
  return new SchemaAdapter({
    nodes: {
      doc: {
        content: 'block+',
      },
      paragraph: {
        automerge: { block: 'paragraph', unknownBlock: true },
        content: 'inline*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0],
      },
      heading: {
        automerge: {
          block: 'heading',
          attrParsers: {
            fromAutomerge: (block: any) => ({ level: block.attrs?.level || 1 }),
            fromProsemirror: (node: any) => ({ level: node.attrs.level }),
          },
        },
        attrs: { level: { default: 1 } },
        content: 'inline*',
        group: 'block',
        defining: true,
        parseDOM: [
          { tag: 'h1', attrs: { level: 1 } },
          { tag: 'h2', attrs: { level: 2 } },
          { tag: 'h3', attrs: { level: 3 } },
        ],
        toDOM: (node: any) => ['h' + node.attrs.level, 0],
      },
      bullet_list: {
        automerge: { block: 'bullet-list' },
        content: 'list_item+',
        group: 'block',
        parseDOM: [{ tag: 'ul' }],
        toDOM: () => ['ul', 0],
      },
      ordered_list: {
        automerge: { block: 'ordered-list' },
        content: 'list_item+',
        group: 'block',
        parseDOM: [{ tag: 'ol' }],
        toDOM: () => ['ol', 0],
      },
      list_item: {
        content: 'paragraph block*',
        parseDOM: [{ tag: 'li' }],
        toDOM: () => ['li', 0],
        defining: true,
      },
      text: {
        group: 'inline',
      },
    },
    marks: {
      strong: {
        automerge: { markName: 'strong' },
        parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
        toDOM: () => ['strong', 0],
      },
      em: {
        automerge: { markName: 'em' },
        parseDOM: [{ tag: 'i' }, { tag: 'em' }],
        toDOM: () => ['em', 0],
      },
      code: {
        automerge: { markName: 'code' },
        parseDOM: [{ tag: 'code' }],
        toDOM: () => ['code', 0],
      },
    },
  });
}

@Component({
  selector: 'app-write-test',
  standalone: true,
  template: `
    <div class="p-4">
      <h1 class="text-2xl font-bold mb-4">Automerge Rich Text Collaboration</h1>

      <!-- Toolbar -->
      <div class="border rounded-t p-2 bg-gray-50 flex gap-2 flex-wrap">
        <div class="flex gap-1">
          <button
            (click)="toggleBold()"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Bold (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            (click)="toggleItalic()"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Italic (Ctrl+I)"
          >
            <em>I</em>
          </button>
          <button
            (click)="toggleCode()"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100 font-mono"
            title="Code (Ctrl+\`)"
          >
            &lt;&gt;
          </button>
        </div>

        <div class="border-l mx-1"></div>

        <div class="flex gap-1">
          <button
            (click)="setHeading(1)"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Heading 1"
          >
            H1
          </button>
          <button
            (click)="setHeading(2)"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Heading 2"
          >
            H2
          </button>
          <button
            (click)="setHeading(3)"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Heading 3"
          >
            H3
          </button>
          <button
            (click)="setParagraph()"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Paragraph"
          >
            P
          </button>
        </div>

        <div class="border-l mx-1"></div>

        <div class="flex gap-1">
          <button
            (click)="toggleBulletList()"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Bullet List"
          >
            • List
          </button>
          <button
            (click)="toggleOrderedList()"
            class="px-3 py-1 bg-white border rounded hover:bg-gray-100"
            title="Numbered List"
          >
            1. List
          </button>
        </div>
      </div>

      <!-- Editor -->
      <div class="border border-t-0 rounded-b p-4 bg-white">
        <div #editor class="prose max-w-none min-h-[400px] focus:outline-none"></div>
      </div>

      <p class="mt-2 text-sm text-gray-500">
        Open this page in multiple tabs to test rich text collaboration. Try bold (Ctrl+B), italic
        (Ctrl+I), headings, and lists!
      </p>
    </div>
  `,
})
export class WriteTestComponent implements OnDestroy {
  @ViewChild('editor', { static: false })
  private editorRef?: ElementRef<HTMLElement>;

  private repo: Repo | null = null;
  private editorView: EditorView | null = null;
  private networkAdapter: SimpleNetworkAdapter | null = null;

  constructor() {
    afterNextRender(() => {
      this.initializeEditor();
    });
  }

  private async initializeEditor() {
    try {
      // Initialize Wasm
      await Automerge.initializeBase64Wasm(automergeWasmBase64);

      // Create network adapter
      this.networkAdapter = new SimpleNetworkAdapter();

      // Create repo
      this.repo = new Repo({
        storage: new IndexedDBStorageAdapter('automerge-test'),
        network: [this.networkAdapter],
      });

      // Use a shared document URL stored in localStorage
      const STORAGE_KEY = 'automerge-test-doc-url';
      let handle;

      const storedUrl = localStorage.getItem(STORAGE_KEY);
      if (storedUrl) {
        console.log('[WriteTest] Loading existing document:', storedUrl);
        try {
          handle = await this.repo.find(storedUrl as any);
        } catch (error) {
          console.error('[WriteTest] Failed to load document, creating new one:', error);
          handle = this.repo.create({ text: '' });
          localStorage.setItem(STORAGE_KEY, handle.url);
        }
      } else {
        console.log('[WriteTest] Creating new document');
        handle = this.repo.create({ text: '' });
        localStorage.setItem(STORAGE_KEY, handle.url);
        console.log('[WriteTest] Stored document URL:', handle.url);
      }

      await handle.whenReady();

      // Initialize text field if needed
      handle.change((doc: any) => {
        if (!doc.text) {
          doc.text = '';
        }
      });

      // Create rich text schema adapter
      const schemaAdapter = createRichTextSchemaAdapter();

      // Use AutoMirror with rich text schema
      const { schema, pmDoc, plugin } = init(handle, ['text'], { schemaAdapter });

      // Create ProseMirror state with rich text support
      const state = EditorState.create({
        schema,
        doc: pmDoc,
        plugins: [
          plugin, // AutoMirror plugin first
          history(),
          keymap({
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
            'Mod-b': toggleMark(schema.marks['strong']),
            'Mod-i': toggleMark(schema.marks['em']),
            'Mod-`': toggleMark(schema.marks['code']),
            Tab: sinkListItem(schema.nodes['list_item']),
            'Shift-Tab': liftListItem(schema.nodes['list_item']),
          }),
          keymap(baseKeymap),
        ],
      });

      // Create ProseMirror view
      if (this.editorRef?.nativeElement) {
        this.editorView = new EditorView(this.editorRef.nativeElement, {
          state,
        });
      }

      console.log('[WriteTest] Rich text editor initialized with document:', handle.url);
    } catch (error) {
      console.error('[WriteTest] Failed to initialize:', error);
    }
  }

  // Toolbar actions
  toggleBold() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    toggleMark(state.schema.marks['strong'])(state, dispatch);
    this.editorView.focus();
  }

  toggleItalic() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    toggleMark(state.schema.marks['em'])(state, dispatch);
    this.editorView.focus();
  }

  toggleCode() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    toggleMark(state.schema.marks['code'])(state, dispatch);
    this.editorView.focus();
  }

  setHeading(level: number) {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    setBlockType(state.schema.nodes['heading'], { level })(state, dispatch);
    this.editorView.focus();
  }

  setParagraph() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    setBlockType(state.schema.nodes['paragraph'])(state, dispatch);
    this.editorView.focus();
  }

  toggleBulletList() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    wrapInList(state.schema.nodes['bullet_list'])(state, dispatch);
    this.editorView.focus();
  }

  toggleOrderedList() {
    if (!this.editorView) return;
    const { state, dispatch } = this.editorView;
    wrapInList(state.schema.nodes['ordered_list'])(state, dispatch);
    this.editorView.focus();
  }

  ngOnDestroy() {
    this.editorView?.destroy();
    if (this.networkAdapter && this.repo) {
      this.repo.networkSubsystem.removeNetworkAdapter(this.networkAdapter);
      this.networkAdapter.disconnect();
    }
  }
}
