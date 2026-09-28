import { Editor } from "@tiptap/core";
import { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";

export interface DailyInteractionCallbacks {
  onSource: () => void;
  onMaple: () => void;
  onAttachment?: () => void;
  onClear?: (blockID: string) => void;
  onMoveToNextDay?: (blockID: string) => void;
  onCopyToNextDay?: (blockID: string) => void;
  onError?: (message: string) => void;
}
export type BlockConversion =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "blockquote"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "codeBlock";
export function topLevelBlocks(editor: Editor) {
  const blocks: { node: ProseMirrorNode; pos: number; id: string }[] = [];
  editor.state.doc.forEach((node, pos) =>
    blocks.push({ node, pos, id: node.attrs["maple"]?.id ?? "" }),
  );
  return blocks;
}
export function selectedBlockID(editor: Editor): string {
  const position = editor.state.selection.from;
  return (
    topLevelBlocks(editor).find(
      ({ node, pos }) => position >= pos && position < pos + node.nodeSize,
    )?.id ?? ""
  );
}
/** Destination is an insertion boundary in the original top-level block array. */
export function moveBlockTo(
  editor: Editor,
  id: string,
  destination: number,
): boolean {
  if (!editor.isEditable) return false;
  const blocks = topLevelBlocks(editor),
    index = blocks.findIndex((b) => b.id === id);
  if (
    index < 0 ||
    destination < 0 ||
    destination > blocks.length ||
    destination === index ||
    destination === index + 1
  )
    return false;
  const { node, pos } = blocks[index];
  const target =
    destination === blocks.length
      ? editor.state.doc.content.size
      : blocks[destination].pos;
  const tr = closeHistory(editor.state.tr).delete(pos, pos + node.nodeSize);
  const insertion = target > pos ? target - node.nodeSize : target;
  tr.insert(insertion, node);
  tr.setSelection(Selection.near(tr.doc.resolve(insertion + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
export function moveBlock(
  editor: Editor,
  id: string,
  direction: -1 | 1,
): boolean {
  const index = topLevelBlocks(editor).findIndex((b) => b.id === id);
  return (
    index >= 0 && moveBlockTo(editor, id, direction < 0 ? index - 1 : index + 2)
  );
}
/** Copies retain evidence/task links, but never reuse document/run/action identities. */
export function copyWithFreshIDs(node: ProseMirrorNode): ProseMirrorNode {
  if (node.isText) return node;
  const attrs = { ...node.attrs };
  if (attrs["maple"]) {
    const {
      runID: _run,
      taskCommandID: _taskCommand,
      ...meta
    } = attrs["maple"];
    attrs["maple"] = {
      ...meta,
      id: crypto.randomUUID(),
      ...(meta.requestID ? { requestID: crypto.randomUUID() } : {}),
    };
  }
  return node.type.create(
    attrs,
    Fragment.fromArray(node.content.content.map(copyWithFreshIDs)),
    node.marks,
  );
}
export function duplicateBlock(editor: Editor, id: string): boolean {
  if (!editor.isEditable) return false;
  const block = topLevelBlocks(editor).find((b) => b.id === id);
  if (!block) return false;
  const insertion = block.pos + block.node.nodeSize;
  const tr = closeHistory(editor.state.tr).insert(
    insertion,
    copyWithFreshIDs(block.node),
  );
  tr.setSelection(Selection.near(tr.doc.resolve(insertion + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
export function deleteBlock(
  editor: Editor,
  id: string,
  onClear?: DailyInteractionCallbacks["onClear"],
): boolean {
  if (!editor.isEditable) return false;
  const block = topLevelBlocks(editor).find((b) => b.id === id);
  if (!block) return false;
  if (onClear) {
    onClear(id);
    return true;
  }
  if (["linkedTask", "sourceReference"].includes(block.node.type.name))
    return false;
  const tr = closeHistory(editor.state.tr).delete(
    block.pos,
    block.pos + block.node.nodeSize,
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
/** Converts ordinary text blocks without touching canonical source/task atoms. */
export function convertBlock(
  editor: Editor,
  id: string,
  kind: BlockConversion,
): boolean {
  if (!editor.isEditable) return false;
  const block = topLevelBlocks(editor).find((b) => b.id === id);
  if (!block) return false;
  const node = block.node,
    schema = editor.schema,
    meta = node.attrs["maple"];
  if (
    ["linkedTask", "sourceReference", "table", "horizontalRule"].includes(
      node.type.name,
    )
  )
    return false;
  const listNames = ["bulletList", "orderedList", "taskList"];
  const isList = listNames.includes(node.type.name);
  let inline: Fragment;
  if (node.isTextblock) inline = node.content;
  else if (
    node.type.name === "blockquote" &&
    node.childCount === 1 &&
    node.firstChild?.isTextblock
  )
    inline = node.firstChild.content;
  else if (!isList || !listNames.includes(kind)) return false;
  else inline = Fragment.empty;
  let replacement: ProseMirrorNode;
  if (listNames.includes(kind)) {
    const itemType =
      schema.nodes[kind === "taskList" ? "taskItem" : "listItem"];
    if (!itemType || !schema.nodes[kind]) return false;
    const items = isList
      ? node.content.content.map((item) =>
          itemType.create(
            { ...item.attrs, checked: item.attrs["checked"] ?? false },
            item.content,
          ),
        )
      : [
          itemType.create(
            { maple: { v: 1, id: crypto.randomUUID() }, checked: false },
            schema.nodes["paragraph"].create(null, inline!),
          ),
        ];
    replacement = schema.nodes[kind].create({ maple: meta }, items);
  } else if (kind === "blockquote") {
    replacement = schema.nodes["blockquote"].create(
      { maple: meta },
      schema.nodes["paragraph"].create(null, inline!),
    );
  } else if (kind === "codeBlock") {
    replacement = schema.nodes["codeBlock"].create(
      { maple: meta },
      node.textContent ? schema.text(node.textContent) : undefined,
    );
  } else {
    const heading = kind.startsWith("heading");
    replacement = schema.nodes[heading ? "heading" : "paragraph"].create(
      { maple: meta, ...(heading ? { level: Number(kind.slice(-1)) } : {}) },
      inline!,
    );
  }
  if (!replacement.type.validContent(replacement.content)) return false;
  const tr = closeHistory(editor.state.tr).replaceWith(
    block.pos,
    block.pos + node.nodeSize,
    replacement,
  );
  tr.setSelection(Selection.near(tr.doc.resolve(block.pos + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
