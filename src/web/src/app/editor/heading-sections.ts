import { Extension } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";

export interface HeadingSection {
  id: string;
  pos: number;
  body: number;
  end: number;
  level: number;
  title: string;
  blocks: number;
}
/** Heading ranges follow Markdown outline rules without wrapping or moving nodes. */
export function headingSections(doc: ProseMirrorNode): HeadingSection[] {
  const sections: HeadingSection[] = [],
    stack: HeadingSection[] = [];
  let blockIndex = 0;
  const starts = new Map<HeadingSection, number>();
  doc.forEach((node, pos) => {
    if (node.type.name === "heading") {
      const level = Number(node.attrs["level"]);
      while (stack.length && stack[stack.length - 1].level >= level) {
        const closed = stack.pop()!;
        closed.end = pos;
        closed.blocks = blockIndex - starts.get(closed)! - 1;
      }
      const section = {
        id: node.attrs["maple"]?.id ?? `position:${pos}`,
        pos,
        body: pos + node.nodeSize,
        end: doc.content.size,
        level,
        title: node.textContent.trim() || "Untitled heading",
        blocks: 0,
      };
      sections.push(section);
      stack.push(section);
      starts.set(section, blockIndex);
    }
    blockIndex++;
  });
  for (const section of stack)
    section.blocks = blockIndex - starts.get(section)! - 1;
  return sections;
}
interface SectionState {
  folded: Set<string>;
  sections: HeadingSection[];
  decorations: DecorationSet;
}
export const headingSectionsKey = new PluginKey<SectionState>(
  "mapleHeadingSections",
);

export function toggleHeadingSection(
  view: EditorView,
  id: string,
  folded?: boolean,
) {
  const state = headingSectionsKey.getState(view.state);
  const section = state?.sections.find((s) => s.id === id);
  if (!state || !section || !section.blocks) return false;
  const close = folded ?? !state.folded.has(id);
  const tr = view.state.tr
    .setMeta(headingSectionsKey, { id, folded: close })
    .setMeta("addToHistory", false);
  // Never leave a selection inside content we are about to hide.
  if (
    close &&
    view.state.selection.to >= section.body &&
    view.state.selection.from < section.end
  )
    tr.setSelection(TextSelection.create(tr.doc, section.body - 1));
  const keyboardFocus =
    view.dom.ownerDocument.activeElement?.classList.contains(
      "maple-section-toggle",
    );
  view.dispatch(tr);
  if (keyboardFocus)
    (view.nodeDOM(section.pos) as HTMLElement | null)
      ?.querySelector<HTMLButtonElement>(".maple-section-toggle")
      ?.focus();
  return true;
}
function decorations(
  doc: ProseMirrorNode,
  sections: HeadingSection[],
  folded: Set<string>,
) {
  const items: Decoration[] = [];
  let hiddenUntil = -1;
  const byPosition = new Map(sections.map((s) => [s.pos, s]));
  doc.forEach((node, pos) => {
    if (pos < hiddenUntil) {
      items.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: "maple-section-hidden",
          "aria-hidden": "true",
        }),
      );
      return;
    }
    const section = byPosition.get(pos);
    if (!section) return;
    const closed = folded.has(section.id) && section.blocks > 0;
    if (closed) hiddenUntil = section.end;
    items.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: `maple-section-heading${closed ? " is-folded" : ""}`,
        "aria-label": section.title,
      }),
    );
    if (!section.blocks) return;
    items.push(
      Decoration.widget(
        pos + 1,
        (view) => {
          const button = view.dom.ownerDocument.createElement("button");
          button.type = "button";
          button.className = "maple-section-toggle";
          button.contentEditable = "false";
          button.setAttribute(
            "aria-label",
            `${closed ? "Expand" : "Collapse"} section: ${section.title}`,
          );
          button.setAttribute("aria-expanded", String(!closed));
          button.title = `${closed ? "Expand" : "Collapse"} section · ${section.blocks} ${section.blocks === 1 ? "block" : "blocks"}`;
          button.innerHTML =
            '<span aria-hidden="true" class="maple-station-dot"></span>';
          button.onmousedown = (e) => e.preventDefault();
          button.onclick = (e) => {
            e.preventDefault();
            toggleHeadingSection(view, section.id);
          };
          button.onkeydown = (e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              view.focus();
            }
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              toggleHeadingSection(view, section.id, e.key === "ArrowLeft");
            }
          };
          return button;
        },
        {
          key: `${section.id}:${closed}:${section.title}:${section.blocks}`,
          side: -1,
          stopEvent: () => true,
        },
      ),
    );
  });
  return DecorationSet.create(doc, items);
}
export const HeadingSections = Extension.create({
  name: "headingSections",
  addKeyboardShortcuts() {
    const set = (fold: boolean) => {
      const view = this.editor.view,
        state = headingSectionsKey.getState(view.state);
      const at = view.state.selection.from;
      const section = state?.sections
        .filter(
          (s) =>
            s.pos < at &&
            s.end >= at &&
            s.blocks &&
            (!fold ? state.folded.has(s.id) : true),
        )
        .at(-1);
      return section ? toggleHeadingSection(view, section.id, fold) : false;
    };
    return {
      "Mod-Alt-ArrowLeft": () => set(true),
      "Mod-Alt-ArrowRight": () => set(false),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<SectionState>({
        key: headingSectionsKey,
        state: {
          init: (_, state) => {
            const sections = headingSections(state.doc);
            return {
              sections,
              folded: new Set(),
              decorations: decorations(state.doc, sections, new Set()),
            };
          },
          apply(tr, old) {
            const action = tr.getMeta(headingSectionsKey) as
              { id?: string; folded?: boolean; reveal?: string[] } | undefined;
            if (!tr.docChanged && !action) return old;
            const sections = tr.docChanged
              ? headingSections(tr.doc)
              : old.sections;
            const ids = new Set(sections.map((s) => s.id));
            const folded = new Set([...old.folded].filter((id) => ids.has(id)));
            if (action?.id) {
              if (action.folded) folded.add(action.id);
              else folded.delete(action.id);
            }
            action?.reveal?.forEach((id) => folded.delete(id));
            return {
              sections,
              folded,
              decorations: decorations(tr.doc, sections, folded),
            };
          },
        },
        props: {
          decorations: (state) =>
            headingSectionsKey.getState(state)?.decorations,
        },
        appendTransaction(transactions, _, state) {
          if (!transactions.some((tr) => tr.selectionSet || tr.docChanged))
            return null;
          const value = headingSectionsKey.getState(state)!;
          // Keyboard navigation, search and undo may put the caret in a folded range.
          // Reveal its containing sections so typing never edits invisible content.
          const reveal = value.sections
            .filter(
              (s) =>
                value.folded.has(s.id) &&
                state.selection.from >= s.body &&
                state.selection.from < s.end,
            )
            .map((s) => s.id);
          return reveal.length
            ? state.tr
                .setMeta(headingSectionsKey, { reveal })
                .setMeta("addToHistory", false)
            : null;
        },
      }),
    ];
  },
});
