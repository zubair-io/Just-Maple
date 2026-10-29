import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { lowlight, supportedLanguages } from './code-block-with-language';
import { parseApiYaml } from '../../../../utils/api-spec-parser';

// ─── API NodeView (thin event-dispatch shell) ────────────────────────

function createApiNodeView(
  node: ProseMirrorNode,
  _getPos: (() => number | undefined) | boolean,
  _editor: Editor,
) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('api-block-wrapper', 'my-3');

  const contentDOM = document.createElement('code');
  contentDOM.style.display = 'none';

  const mountPoint = document.createElement('div');
  wrapper.appendChild(mountPoint);

  let lastContent = node.textContent;
  const { result, error } = parseApiYaml(lastContent);

  // Mount event — Angular component will be injected into mountPoint
  setTimeout(() => {
    wrapper.dispatchEvent(
      new CustomEvent('api-block-mounted', {
        bubbles: true,
        detail: {
          element: mountPoint,
          editor: _editor,
          getPos: _getPos,
          parseResult: result,
          parseError: error,
          yamlContent: lastContent,
        },
      }),
    );
  }, 0);

  return {
    dom: wrapper,
    contentDOM,
    stopEvent: (event: Event) => {
      const target = event.target as HTMLElement;
      // Let ProseMirror handle events inside contentDOM (YAML source editing)
      if (contentDOM.contains(target)) return false;
      // Stop ProseMirror from intercepting events on form controls and buttons
      return true;
    },
    ignoreMutation: () => true,
    update: (updatedNode: ProseMirrorNode) => {
      if (updatedNode.type.name !== 'codeBlock') return false;
      if (updatedNode.attrs['language'] !== 'api') return false;

      const newContent = updatedNode.textContent;
      if (newContent === lastContent) return true;
      lastContent = newContent;

      const { result: newResult, error: newError } = parseApiYaml(newContent);
      wrapper.dispatchEvent(
        new CustomEvent('api-block-updated', {
          bubbles: true,
          detail: {
            element: mountPoint,
            parseResult: newResult,
            parseError: newError,
            yamlContent: newContent,
          },
        }),
      );
      return true;
    },
    destroy: () => {
      wrapper.dispatchEvent(
        new CustomEvent('api-block-unmounted', {
          bubbles: true,
          detail: { element: mountPoint },
        }),
      );
    },
  };
}

// ─── Default code block NodeView ─────────────────────────────────────

function createDefaultCodeBlockView(
  node: ProseMirrorNode,
  getPos: (() => number | undefined) | boolean,
  editor: Editor,
) {
  const container = document.createElement('div');
  container.classList.add('code-block-container');

  const select = document.createElement('select');
  select.classList.add('code-block-language');
  select.contentEditable = 'false';

  const allLanguages = [...supportedLanguages, { value: 'api', label: 'API' }];
  allLanguages.forEach((lang) => {
    const option = document.createElement('option');
    option.value = lang.value;
    option.textContent = lang.label;
    if (node.attrs['language'] === lang.value) option.selected = true;
    select.appendChild(option);
  });

  select.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos !== null && pos !== undefined) {
      editor.chain().focus().setCodeBlock({ language: target.value }).run();
    }
  });

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.classList.add(`language-${node.attrs['language'] || 'plaintext'}`);
  pre.appendChild(code);

  container.appendChild(select);
  container.appendChild(pre);

  return {
    dom: container,
    contentDOM: code,
    update: (updatedNode: ProseMirrorNode) => {
      if (updatedNode.type.name !== 'codeBlock') return false;
      if (updatedNode.attrs['language'] === 'api') return false;
      code.className = `language-${updatedNode.attrs['language'] || 'plaintext'}`;
      select.value = updatedNode.attrs['language'] || 'plaintext';
      return true;
    },
  };
}

// ─── Extension export ────────────────────────────────────────────────

export const ApiCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      if (node.attrs['language'] === 'api') {
        return createApiNodeView(node, getPos, editor);
      }
      return createDefaultCodeBlockView(node, getPos, editor);
    };
  },
}).configure({
  lowlight,
  defaultLanguage: 'plaintext',
});
