import {
  Component,
  ElementRef,
  ViewChild,
  input,
  output,
  signal,
  effect,
  OnDestroy,
  AfterViewInit,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

/**
 * JSON Code Editor Component
 * CodeMirror-based JSON editor with syntax highlighting, validation, and formatting.
 */
@Component({
  selector: 'app-json-code-editor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './json-code-editor.component.html',
  styleUrl: './json-code-editor.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class JsonCodeEditorComponent implements AfterViewInit, OnDestroy {
  readonly data = input<unknown>();
  readonly schema = input<unknown>();
  readonly readonly = input(false);

  readonly dataChange = output<unknown>();

  readonly validationError = signal<string | null>(null);

  @ViewChild('editorHost') editorHostRef!: ElementRef<HTMLDivElement>;

  private editorView?: EditorView;
  private readonlyCompartment = new Compartment();
  private saveTimeout?: ReturnType<typeof setTimeout>;
  private isExternalUpdate = false;
  private lastEmittedJson: string | null = null;

  constructor() {
    effect(() => {
      const data = this.data();
      if (data !== undefined) {
        try {
          const formatted = JSON.stringify(data, null, 4);
          if (this.lastEmittedJson !== null && this.lastEmittedJson === formatted) {
            this.lastEmittedJson = null;
            return;
          }
          this.validationError.set(null);
          if (this.editorView) {
            const currentDoc = this.editorView.state.doc.toString();
            if (currentDoc !== formatted) {
              this.isExternalUpdate = true;
              this.editorView.dispatch({
                changes: {
                  from: 0,
                  to: this.editorView.state.doc.length,
                  insert: formatted,
                },
              });
              this.isExternalUpdate = false;
            }
          }
        } catch {
          // Can't format data
        }
      }
    });

    effect(() => {
      const ro = this.readonly();
      if (this.editorView) {
        this.editorView.dispatch({
          effects: this.readonlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
        });
      }
    });
  }

  ngAfterViewInit(): void {
    const initialData = this.data();
    let initialDoc = '{}';
    if (initialData !== undefined) {
      try {
        initialDoc = JSON.stringify(initialData, null, 4);
      } catch {
        initialDoc = String(initialData);
      }
    }

    const jsonHighlighting = HighlightStyle.define([
      { tag: tags.propertyName, color: '#9cdcfe' },
      { tag: tags.string, color: '#ce9178' },
      { tag: tags.number, color: '#b5cea8' },
      { tag: tags.bool, color: '#569cd6' },
      { tag: tags.null, color: '#569cd6' },
      { tag: tags.punctuation, color: '#808080' },
      { tag: tags.squareBracket, color: '#da70d6' },
      { tag: tags.brace, color: '#ffd700' },
    ]);

    const theme = EditorView.theme({
      '&': {
        flex: '1',
        height: '100%',
        fontSize: '13px',
      },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
        overflow: 'auto',
      },
      '.cm-content': {
        caretColor: 'var(--color-text-main)',
        padding: '12px 0',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--color-bg-elevated, var(--color-bg))',
        color: 'var(--color-text-muted)',
        borderRight: '1px solid var(--color-border)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--color-border)',
      },
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--color-border) 30%, transparent)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-text-main)',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent)',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'color-mix(in srgb, var(--color-primary) 25%, transparent)',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        opacity: '0.5',
        minWidth: '32px',
        padding: '0 8px 0 12px',
      },
    });

    this.editorView = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          highlightSelectionMatches(),
          json(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          syntaxHighlighting(jsonHighlighting),
          keymap.of([
            ...defaultKeymap,
            ...searchKeymap,
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                this.saveImmediately();
                return true;
              },
            },
          ]),
          this.readonlyCompartment.of(EditorState.readOnly.of(this.readonly())),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.isExternalUpdate) {
              this.onDocChange(update.state.doc.toString());
            }
          }),
          theme,
        ],
      }),
      parent: this.editorHostRef.nativeElement,
    });
  }

  private onDocChange(text: string): void {
    try {
      JSON.parse(text);
      this.validationError.set(null);
    } catch (err: any) {
      this.validationError.set(err.message || 'Invalid JSON');
      return;
    }

    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        const parsed = JSON.parse(text);
        this.lastEmittedJson = JSON.stringify(parsed, null, 4);
        this.dataChange.emit(parsed);
      } catch {
        // Already handled
      }
    }, 800);
  }

  private saveImmediately(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    if (!this.editorView) return;
    const text = this.editorView.state.doc.toString();
    try {
      const parsed = JSON.parse(text);
      this.validationError.set(null);
      this.lastEmittedJson = JSON.stringify(parsed, null, 4);
      this.dataChange.emit(parsed);
    } catch {
      // Invalid JSON, don't save
    }
  }

  formatJson(): void {
    if (!this.editorView) return;
    const text = this.editorView.state.doc.toString();
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 4);
      this.validationError.set(null);
      this.editorView.dispatch({
        changes: { from: 0, to: this.editorView.state.doc.length, insert: formatted },
      });
    } catch {
      // Can't format invalid JSON
    }
  }

  ngOnDestroy(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.editorView?.destroy();
  }
}
