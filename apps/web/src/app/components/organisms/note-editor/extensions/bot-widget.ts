import { Node, mergeAttributes } from '@tiptap/core';

export interface BotWidgetOptions {
  HTMLAttributes: Record<string, unknown>;
}

export interface BotWidgetAttrs {
  widgetId: string;
  botHandle: string;
  invocationId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output: string | null;
  error: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    botWidget: {
      insertBotWidget: (attrs: Partial<BotWidgetAttrs>) => ReturnType;
      updateBotWidget: (widgetId: string, attrs: Partial<BotWidgetAttrs>) => ReturnType;
    };
  }
}

export const BotWidget = Node.create<BotWidgetOptions>({
  name: 'botWidget',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      widgetId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-widget-id'),
        renderHTML: (attributes) => ({
          'data-widget-id': attributes['widgetId'],
        }),
      },
      botHandle: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-bot-handle'),
        renderHTML: (attributes) => ({
          'data-bot-handle': attributes['botHandle'],
        }),
      },
      invocationId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-invocation-id'),
        renderHTML: (attributes) => ({
          'data-invocation-id': attributes['invocationId'],
        }),
      },
      status: {
        default: 'pending',
        parseHTML: (element) => element.getAttribute('data-status'),
        renderHTML: (attributes) => ({
          'data-status': attributes['status'],
        }),
      },
      output: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-output'),
        renderHTML: (attributes) => ({
          'data-output': attributes['output'],
        }),
      },
      error: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-error'),
        renderHTML: (attributes) => ({
          'data-error': attributes['error'],
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-bot-widget]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        { 'data-bot-widget': '' },
        { class: 'bot-widget' },
        this.options.HTMLAttributes,
        HTMLAttributes,
      ),
      0,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.classList.add('bot-widget');
      dom.setAttribute('data-bot-widget', '');
      dom.setAttribute('data-widget-id', node.attrs['widgetId'] || '');
      dom.setAttribute('data-status', node.attrs['status'] || 'pending');

      const status = node.attrs['status'] as string;
      const output = node.attrs['output'] as string | null;
      const error = node.attrs['error'] as string | null;
      const botHandle = node.attrs['botHandle'] as string;

      if (status === 'pending' || status === 'running') {
        dom.innerHTML = `
                    <div class="bot-widget-loading">
                        <div class="bot-widget-header">
                            <span class="bot-icon">🤖</span>
                            <span class="bot-name">@${botHandle || 'bot'}</span>
                        </div>
                        <div class="bot-widget-spinner">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        <span class="bot-widget-status">Thinking...</span>
                    </div>
                `;
      } else if (status === 'failed') {
        dom.innerHTML = `
                    <div class="bot-widget-error">
                        <div class="bot-widget-header">
                            <span class="bot-icon">🤖</span>
                            <span class="bot-name">@${botHandle || 'bot'}</span>
                        </div>
                        <div class="bot-widget-error-message">
                            <span class="error-icon">⚠️</span>
                            <span>${error || 'An error occurred'}</span>
                        </div>
                    </div>
                `;
      } else if (status === 'completed' && output) {
        dom.innerHTML = `
                    <div class="bot-widget-output">
                        <div class="bot-widget-header">
                            <span class="bot-icon">🤖</span>
                            <span class="bot-name">@${botHandle || 'bot'}</span>
                        </div>
                        <div class="bot-widget-content">${output}</div>
                    </div>
                `;
      } else {
        dom.innerHTML = `
                    <div class="bot-widget-empty">
                        <div class="bot-widget-header">
                            <span class="bot-icon">🤖</span>
                            <span class="bot-name">@${botHandle || 'bot'}</span>
                        </div>
                        <span class="bot-widget-placeholder">No response</span>
                    </div>
                `;
      }

      return { dom };
    };
  },

  addCommands() {
    return {
      insertBotWidget:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              widgetId: attrs.widgetId || `widget-${Date.now()}`,
              botHandle: attrs.botHandle || 'bot',
              invocationId: attrs.invocationId || null,
              status: attrs.status || 'pending',
              output: attrs.output || null,
              error: attrs.error || null,
            },
          });
        },
      updateBotWidget:
        (widgetId, attrs) =>
        ({ tr, state, dispatch }) => {
          let found = false;
          state.doc.descendants((node, pos) => {
            if (node.type.name === this.name && node.attrs['widgetId'] === widgetId) {
              if (dispatch) {
                const newAttrs = { ...node.attrs, ...attrs };
                tr.setNodeMarkup(pos, undefined, newAttrs);
              }
              found = true;
              return false;
            }
            return true;
          });
          return found;
        },
    };
  },
});
