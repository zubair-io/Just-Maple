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

  // Search per text-block, concatenating all inline text so a query that spans
  // mark boundaries (e.g. "lo wor" across bold) still matches, while never
  // matching across block boundaries. A parallel `positions` array maps each
  // character back to its document position.
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) {
          const ch = child.text[i];
          text += caseSensitive ? ch : ch.toLowerCase();
          // Content starts at pos + 1 (inside the block node); offset is
          // relative to the content start.
          positions.push(pos + 1 + offset + i);
        }
      }
    });

    let index = text.indexOf(needle);
    while (index !== -1) {
      const from = positions[index];
      const last = positions[index + needle.length - 1];
      if (from !== undefined && last !== undefined) {
        results.push({ from, to: last + 1 });
      }
      index = text.indexOf(needle, index + needle.length);
    }

    // Inline content handled here; no need to recurse into this block's children.
    return false;
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
              // When the document changed without an explicit command (e.g. a
              // remote collaborator edit), map the currently-active match's
              // position forward so the highlight stays on the same target
              // instead of silently pointing at a different occurrence.
              const previousActiveFrom =
                meta === undefined && tr.docChanged
                  ? value.matches[value.activeIndex]?.from
                  : undefined;

              const matches = findMatches(newState.doc, next.query, next.caseSensitive);
              let activeIndex = next.activeIndex;

              if (previousActiveFrom !== undefined && matches.length > 0) {
                const mapped = tr.mapping.map(previousActiveFrom);
                const nearest = matches.findIndex((m) => m.from >= mapped);
                activeIndex = nearest === -1 ? matches.length - 1 : nearest;
              }

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
            // Advance past the replacement so we don't re-match inside it (which
            // happens when the replacement text itself contains the query, e.g.
            // replacing "cat" with "cats").
            const afterPos = match.from + search.replaceTerm.length;
            const newMatches = findMatches(tr.doc, search.query, search.caseSensitive);
            let activeIndex = newMatches.findIndex((m) => m.from >= afterPos);
            if (activeIndex === -1) activeIndex = 0;
            tr.setMeta(searchReplacePluginKey, { activeIndex });
            const nextMatch = newMatches[activeIndex];
            if (nextMatch) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(nextMatch.from)));
              tr.scrollIntoView();
            }
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
