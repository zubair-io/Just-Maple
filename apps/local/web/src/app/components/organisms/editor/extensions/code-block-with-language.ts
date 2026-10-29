import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

// Create lowlight instance with common languages
export const lowlight = createLowlight(common);

// List of supported languages for the dropdown
export const supportedLanguages = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'sql', label: 'SQL' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'scss', label: 'SCSS' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'bash', label: 'Bash' },
  { value: 'shell', label: 'Shell' },
  { value: 'dockerfile', label: 'Dockerfile' },
];

/**
 * Extended CodeBlockLowlight with language selector
 */
export const CodeBlockWithLanguage = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('div');
      container.classList.add('code-block-container');

      // Language selector
      const select = document.createElement('select');
      select.classList.add('code-block-language');
      select.contentEditable = 'false';

      supportedLanguages.forEach((lang) => {
        const option = document.createElement('option');
        option.value = lang.value;
        option.textContent = lang.label;
        if (node.attrs['language'] === lang.value) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      // Handle language change
      select.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) {
          editor.chain().focus().setCodeBlock({ language: target.value }).run();
        }
      });

      // Pre element for code
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.classList.add(`language-${node.attrs['language'] || 'plaintext'}`);
      pre.appendChild(code);

      container.appendChild(select);
      container.appendChild(pre);

      return {
        dom: container,
        contentDOM: code,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'codeBlock') {
            return false;
          }
          code.className = `language-${updatedNode.attrs['language'] || 'plaintext'}`;
          select.value = updatedNode.attrs['language'] || 'plaintext';
          return true;
        },
      };
    };
  },
}).configure({
  lowlight,
  defaultLanguage: 'plaintext',
});
