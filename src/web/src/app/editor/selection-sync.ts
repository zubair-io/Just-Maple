import { TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";

/**
 * Browser selectionchange is asynchronous. After collapsing a formatted range
 * with an arrow, a second rapid key can arrive before ProseMirror sees the caret.
 * Reconcile only this narrow case so Enter/typing cannot replace the old range.
 * Composition, node selections and focus outside actual editor text stay alone.
 */
export function syncCollapsedDOMSelection(
  view: EditorView,
  event: KeyboardEvent,
): boolean {
  if (
    event.isComposing ||
    view.composing ||
    !view.hasFocus() ||
    !(view.state.selection instanceof TextSelection) ||
    view.state.selection.empty
  )
    return false;
  const selection = view.dom.ownerDocument.getSelection();
  if (
    !selection?.isCollapsed ||
    !selection.focusNode ||
    !view.dom.contains(selection.focusNode)
  )
    return false;
  const element =
    selection.focusNode.nodeType === 1
      ? (selection.focusNode as Element)
      : selection.focusNode.parentElement;
  if (element?.closest('button,input,textarea,[contenteditable="false"]'))
    return false;
  try {
    const position = view.posAtDOM(selection.focusNode, selection.focusOffset);
    if (!view.state.doc.resolve(position).parent.isTextblock) return false;
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, position))
        .setMeta("addToHistory", false),
    );
    return true;
  } catch {
    // An intervening render may invalidate a DOM position; let PM reconcile it.
    return false;
  }
}
