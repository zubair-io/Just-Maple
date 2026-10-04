import { Editor } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Transaction } from "@tiptap/pm/state";
import { BlockMetadata, decodeDaily } from "./daily-markdown-codec";
import { ySyncPluginKey, yUndoPluginKey } from "@tiptap/y-tiptap";
import type { UndoManager } from "yjs";

/** History selections belong to a past document. Restore their Yjs relative
 * anchors, never their old numeric offsets against the current shorter doc.
 * y-tiptap 3.0.9 otherwise throws in structural selection recovery on Redo.
 * Only history metadata is adjusted; ordinary live selection mapping stays on.
 */
export function relativeHistorySelections(editor: Editor): () => void {
  const manager = yUndoPluginKey.getState(editor.state).undoManager as UndoManager;
  const stripOffsets = ({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) => {
    const binding = ySyncPluginKey.getState(editor.state)?.binding;
    const selection = stackItem.meta.get(binding) as Record<string, unknown> | undefined;
    if (selection) {
      const { absAnchor, absHead, ...relative } = selection;
      stackItem.meta.set(binding, relative);
    }
  };
  manager.on("stack-item-added", stripOffsets);
  return () => manager.off("stack-item-added", stripOffsets);
}

export interface ProposedBlock { blockID: string; markdown: string }
export interface AutomaticProposal {
  documentID: string;
  groups: { headingID: string; title: string; createHeading: boolean; blocks: ProposedBlock[] }[];
  removals: ProposedBlock[];
}
export interface ReplyProposal {
  runID: string;
  documentID: string;
  requestBlockID: string;
  requestText?: string;
  blocks: ProposedBlock[];
}

export function rememberBlockIDs(doc: ProseMirrorNode, seen: Set<string>) {
  doc.descendants(node => {
    const id = node.attrs["maple"]?.id;
    if (id) seen.add(id);
  });
}

function findBlock(doc: ProseMirrorNode, id: string) {
  let result: { node: ProseMirrorNode; pos: number } | undefined;
  doc.forEach((node, pos) => {
    if (node.attrs["maple"]?.id === id) result = { node, pos };
  });
  return result;
}

function containsLinkedEntity(doc: ProseMirrorNode, candidate: ProseMirrorNode): boolean {
  const eventID = candidate.type.name === "sourceReference" ? candidate.attrs["reference"]?.eventID : undefined;
  const taskID = candidate.type.name === "linkedTask" ? candidate.attrs["taskID"] : undefined;
  if (!eventID && !taskID) return false;
  let found = false;
  doc.descendants(node => {
    if ((eventID && node.type.name === "sourceReference" && node.attrs["reference"]?.eventID === eventID) ||
        (taskID && node.type.name === "linkedTask" && node.attrs["taskID"] === taskID)) found = true;
  });
  return found;
}

function decodeBlock(editor: Editor, block: ProposedBlock): ProseMirrorNode {
  const parsed = decodeDaily(block.markdown);
  if (parsed.sourceOnly || parsed.prefix || parsed.doc.content?.length !== 1 ||
      (parsed.doc.content[0].attrs?.["maple"] as BlockMetadata | undefined)?.id !== block.blockID) {
    throw new Error("Maple supplied an unsupported block. Its source remains available.");
  }
  const node = editor.schema.nodeFromJSON(parsed.doc.content[0]);
  node.check();
  return node;
}

// Operations are built against the live document, never against a saved snapshot.
// ProseMirror maps the user's selection through each step; Yjs shares these steps
// with Maple without putting its edits in the user's undo history.
export function automaticTransaction(editor: Editor, proposal: AutomaticProposal, seen: Set<string>): Transaction {
  const tr = editor.state.tr;
  const reserved = new Set(seen);
  for (const block of proposal.removals) {
    const current = findBlock(tr.doc, block.blockID);
    if (current?.node.eq(decodeBlock(editor, block))) {
      tr.delete(current.pos, current.pos + current.node.nodeSize);
    }
  }
  for (const group of proposal.groups) {
    const additions: ProseMirrorNode[] = [];
    for (const block of group.blocks) {
      if (reserved.has(block.blockID)) continue;
      const node = decodeBlock(editor, block);
      // The saved-file proposal cannot see a source/task the human just inserted
      // into this unsaved editor with a different block identity.
      if (containsLinkedEntity(tr.doc, node)) continue;
      additions.push(node);
      reserved.add(block.blockID);
    }
    if (!additions.length) continue;
    const heading = findBlock(tr.doc, group.headingID);
    let insertion = tr.doc.content.size;
    if (heading) {
      tr.doc.forEach((node, pos) => {
        if (pos > heading.pos && node.type.name === "heading" && insertion === tr.doc.content.size)
          insertion = pos;
      });
    } else if (group.createHeading && !reserved.has(group.headingID)) {
      additions.unshift(editor.schema.nodes["heading"].create(
        { level: 2, maple: { v: 1, id: group.headingID } },
        editor.schema.text(group.title),
      ));
      reserved.add(group.headingID);
    }
    tr.insert(insertion, additions);
  }
  return tr.setMeta("addToHistory", false).setMeta("mapleOrigin", "maple");
}

export function replyTransaction(editor: Editor, proposal: ReplyProposal, seen: Set<string>): Transaction | null {
  const request = findBlock(editor.state.doc, proposal.requestBlockID);
  if (!request || request.node.type.name !== "paragraph" ||
      !/^@maple\b/i.test(request.node.textContent) || proposal.requestText === undefined ||
      request.node.textContent.replace(/^@maple\s*/i, "").trim() !== proposal.requestText.trim()) return null;
  // If the user removed this unsaved reply, do not resurrect its citations or
  // later paragraphs when the same native proposal is delivered again.
  const replyID = proposal.blocks[0]?.blockID;
  if (replyID && seen.has(replyID) && !findBlock(editor.state.doc, replyID)) return null;
  const tr = editor.state.tr;
  const reserved = new Set(seen);
  const additions: ProseMirrorNode[] = [];
  for (const block of proposal.blocks) {
    if (reserved.has(block.blockID)) continue;
    additions.push(decodeBlock(editor, block));
    reserved.add(block.blockID);
  }
  if (additions.length) tr.insert(request.pos + request.node.nodeSize, additions);
  return tr.setMeta("addToHistory", false).setMeta("mapleOrigin", "maple");
}
