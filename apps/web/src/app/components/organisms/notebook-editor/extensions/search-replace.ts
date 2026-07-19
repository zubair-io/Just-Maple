import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface SearchMatch {
  from: number;
  to: number;
}

interface SearchState {
  query: string;
  replaceTerm: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  activeIndex: number;
  decorations: DecorationSet;
}

export const searchReplacePluginKey = new PluginKey<SearchState>('searchReplace');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchTerm: (query: string, caseSensitive?: boolean) => ReturnType;
      setReplaceTerm: (replaceTerm: string) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: () => ReturnType;
      replaceAll: () => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

function findMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): SearchMatch[] {
  const results: SearchMatch[] = [];
  if (!query) return results;
  const needle = caseSensitive ? query : query.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const haystack = caseSensitive ? node.text : node.text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      results.push({ from: pos + index, to: pos + index + needle.length });
      index = haystack.indexOf(needle, index + needle.length);
    }
  });

  return results;
}

/**
 * In-document find & replace. Highlights every match with a ProseMirror
 * decoration, tracks the active match, and supports replace / replace-all.
 * No external dependency — a plain ProseMirror plugin.
 */
export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchReplacePluginKey,
        state: {
          init: () => ({
            query: '',
            replaceTerm: '',
            caseSensitive: false,
            matches: [],
            activeIndex: 0,
            decorations: DecorationSet.empty,
          }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(searchReplacePluginKey) as Partial<SearchState> | undefined;
            let next: SearchState = meta ? { ...value, ...meta } : value;

            if (meta !== undefined || tr.docChanged) {
              const matches = findMatches(newState.doc, next.query, next.caseSensitive);
              let activeIndex = next.activeIndex;
              if (activeIndex >= matches.length) activeIndex = 0;
              if (activeIndex < 0) activeIndex = 0;
              const decorations =
                matches.length === 0
                  ? DecorationSet.empty
                  : DecorationSet.create(
                      newState.doc,
                      matches.map((match, i) =>
                        Decoration.inline(match.from, match.to, {
                          class:
                            i === activeIndex
                              ? 'search-match search-match--active'
                              : 'search-match',
                        }),
                      ),
                    );
              next = { ...next, matches, activeIndex, decorations };
            }

            return next;
          },
        },
        props: {
          decorations(state) {
            return searchReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setSearchTerm:
        (query: string, caseSensitive = false) =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(
              state.tr.setMeta(searchReplacePluginKey, { query, caseSensitive, activeIndex: 0 }),
            );
          }
          return true;
        },

      setReplaceTerm:
        (replaceTerm: string) =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(state.tr.setMeta(searchReplacePluginKey, { replaceTerm }));
          }
          return true;
        },

      clearSearch:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(state.tr.setMeta(searchReplacePluginKey, { query: '', activeIndex: 0 }));
          }
          return true;
        },

      findNext:
        () =>
        ({ state, dispatch }) => {
          const search = searchReplacePluginKey.getState(state);
          if (!search || search.matches.length === 0) return false;
          const activeIndex = (search.activeIndex + 1) % search.matches.length;
          if (dispatch) {
            const match = search.matches[activeIndex];
            const tr = state.tr.setMeta(searchReplacePluginKey, { activeIndex });
            // Selecting the match makes scrollIntoView bring it into view.
            tr.setSelection(TextSelection.near(tr.doc.resolve(match.from)));
            tr.scrollIntoView();
            dispatch(tr);
          }
          return true;
        },

      findPrevious:
        () =>
        ({ state, dispatch }) => {
          const search = searchReplacePluginKey.getState(state);
          if (!search || search.matches.length === 0) return false;
          const activeIndex =
            (search.activeIndex - 1 + search.matches.length) % search.matches.length;
          if (dispatch) {
            const match = search.matches[activeIndex];
            const tr = state.tr.setMeta(searchReplacePluginKey, { activeIndex });
            tr.setSelection(TextSelection.near(tr.doc.resolve(match.from)));
            tr.scrollIntoView();
            dispatch(tr);
          }
          return true;
        },

      replaceCurrent:
        () =>
        ({ state, dispatch }) => {
          const search = searchReplacePluginKey.getState(state);
          if (!search || search.matches.length === 0) return false;
          const match = search.matches[search.activeIndex];
          if (!match) return false;
          if (dispatch) {
            const tr = state.tr.insertText(search.replaceTerm, match.from, match.to);
            // Re-run the search against the updated doc.
            tr.setMeta(searchReplacePluginKey, {});
            dispatch(tr);
          }
          return true;
        },

      replaceAll:
        () =>
        ({ state, dispatch }) => {
          const search = searchReplacePluginKey.getState(state);
          if (!search || search.matches.length === 0) return false;
          if (dispatch) {
            const tr = state.tr;
            // Replace from the last match backwards so earlier positions stay valid.
            for (let i = search.matches.length - 1; i >= 0; i--) {
              const match = search.matches[i];
              tr.insertText(search.replaceTerm, match.from, match.to);
            }
            tr.setMeta(searchReplacePluginKey, { activeIndex: 0 });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
