/**
 * Imperative YAML editor modal using CodeMirror 6.
 * Framework-agnostic — appends directly to document.body.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
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

export function createYamlEditorModal(currentYaml: string, onSave: (yaml: string) => void): void {
  const yamlHighlighting = HighlightStyle.define([
    { tag: tags.propertyName, color: '#9cdcfe' },
    { tag: tags.string, color: '#ce9178' },
    { tag: tags.number, color: '#b5cea8' },
    { tag: tags.bool, color: '#569cd6' },
    { tag: tags.null, color: '#569cd6' },
    { tag: tags.punctuation, color: '#808080' },
    { tag: tags.comment, color: '#6a9955' },
    { tag: tags.keyword, color: '#c586c0' },
  ]);

  const cmTheme = EditorView.theme({
    '&': {
      flex: '1',
      fontSize: '13px',
      height: '100%',
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

  // ── Backdrop ──
  const backdrop = document.createElement('div');
  backdrop.classList.add('yaml-modal-backdrop');
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '9999',
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    animation: 'yaml-modal-enter 0.15s ease-out',
  });

  // ── Panel ──
  const panel = document.createElement('div');
  panel.classList.add('yaml-modal-panel');
  Object.assign(panel.style, {
    width: '700px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: '12px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    overflow: 'hidden',
    animation: 'yaml-modal-panel-enter 0.15s ease-out',
  });

  // ── Header ──
  const headerEl = document.createElement('div');
  Object.assign(headerEl.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-bg-secondary)',
  });
  const title = document.createElement('span');
  title.textContent = 'Edit API Spec';
  Object.assign(title.style, {
    fontWeight: '600',
    fontSize: '14px',
    color: 'var(--color-text-main)',
  });
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 20px;">close</span>`;
  Object.assign(closeBtn.style, {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
  });
  headerEl.appendChild(title);
  headerEl.appendChild(closeBtn);
  panel.appendChild(headerEl);

  // ── Editor host ──
  const editorHost = document.createElement('div');
  Object.assign(editorHost.style, {
    flex: '1',
    overflow: 'auto',
    minHeight: '200px',
    maxHeight: 'calc(80vh - 110px)',
  });
  panel.appendChild(editorHost);

  // ── Footer ──
  const footer = document.createElement('div');
  Object.assign(footer.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '12px 16px',
    borderTop: '1px solid var(--color-border)',
    background: 'var(--color-bg-secondary)',
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '6px 16px',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    background: 'var(--color-bg)',
    color: 'var(--color-text-main)',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  Object.assign(saveBtn.style, {
    padding: '6px 16px',
    border: 'none',
    borderRadius: '6px',
    background: 'var(--color-primary)',
    color: 'white',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  panel.appendChild(footer);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  // ── CodeMirror instance ──
  let cmView: EditorView | null = new EditorView({
    state: EditorState.create({
      doc: currentYaml,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        yamlLang(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(yamlHighlighting),
        keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
        cmTheme,
      ],
    }),
    parent: editorHost,
  });

  // Focus the editor
  cmView.focus();

  // ── Close helper ──
  function close(): void {
    cmView?.destroy();
    cmView = null;
    backdrop.remove();
  }

  // ── Event handlers ──
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  saveBtn.addEventListener('click', () => {
    if (!cmView) return;
    const newYaml = cmView.state.doc.toString();
    close();
    onSave(newYaml);
  });
}
