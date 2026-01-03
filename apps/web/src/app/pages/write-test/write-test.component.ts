import { Component, ElementRef, ViewChild, afterNextRender, OnDestroy } from '@angular/core';
import { Repo } from '@automerge/automerge-repo/slim';
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb';
import * as Automerge from '@automerge/automerge/slim';
import { automergeWasmBase64 } from '@automerge/automerge/automerge.wasm.base64';
import { init } from '@automerge/prosemirror';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { SimpleNetworkAdapter } from './simple-network-adapter';

@Component({
  selector: 'app-write-test',
  standalone: true,
  template: `
    <div class="p-4">
      <h1 class="text-2xl font-bold mb-4">Automerge Test - Shared Document</h1>
      <div class="border rounded p-4 bg-white">
        <div #editor class="prose max-w-none min-h-[400px] focus:outline-none"></div>
      </div>
      <p class="mt-2 text-sm text-gray-500">
        Open this page in multiple tabs to test collaboration
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
      // This ensures all tabs on this machine use the same document
      const STORAGE_KEY = 'automerge-test-doc-url';
      let handle;

      const storedUrl = localStorage.getItem(STORAGE_KEY);
      if (storedUrl) {
        console.log('[WriteTest] Loading existing document:', storedUrl);
        try {
          handle = await this.repo.find(storedUrl as any);
        } catch (error) {
          console.error('[WriteTest] Failed to load document, creating new one:', error);
          handle = this.repo.create();
          handle.change((doc: any) => {
            doc.text = '';
          });
          localStorage.setItem(STORAGE_KEY, handle.url);
        }
      } else {
        console.log('[WriteTest] Creating new document');
        handle = this.repo.create();
        handle.change((doc: any) => {
          doc.text = '';
        });
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

      // Use AutoMirror to create ProseMirror integration
      const { schema, pmDoc, plugin } = init(handle, ['text']);

      // Create ProseMirror state
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

      console.log('[WriteTest] Editor initialized with document:', handle.url);
    } catch (error) {
      console.error('[WriteTest] Failed to initialize:', error);
    }
  }

  ngOnDestroy() {
    this.editorView?.destroy();
    if (this.networkAdapter && this.repo) {
      this.repo.networkSubsystem.removeNetworkAdapter(this.networkAdapter);
      this.networkAdapter.disconnect();
    }
  }
}
