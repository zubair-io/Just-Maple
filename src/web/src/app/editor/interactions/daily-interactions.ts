import { Editor, Extension } from "@tiptap/core";
import Suggestion, { SuggestionProps } from "@tiptap/suggestion";
import BubbleMenu from "@tiptap/extension-bubble-menu";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import {
  BlockConversion,
  DailyInteractionCallbacks,
  convertBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  moveBlockTo,
  selectedBlockID,
  topLevelBlocks,
} from "./block-commands";
import { button, interactionCSS, menuElement, menuKeyboard } from "./menu-dom";
export * from "./block-commands";

export interface SlashItem {
  id: string;
  label: string;
  keywords: string;
  run: (editor: Editor) => void;
}
export function dailySlashItems(
  callbacks: DailyInteractionCallbacks,
): SlashItem[] {
  const conversions: [BlockConversion, string, string][] = [
    ["paragraph", "Text", "paragraph plain"],
    ["heading1", "Heading 1", "title large"],
    ["heading2", "Heading 2", "section"],
    ["heading3", "Heading 3", "section small"],
    ["bulletList", "Bullet list", "unordered"],
    ["orderedList", "Numbered list", "ordered"],
    ["taskList", "Checklist", "task todo"],
    ["blockquote", "Quote", "citation"],
    ["codeBlock", "Code block", "snippet"],
  ];
  const items: SlashItem[] = [
    ...conversions.map(([id, label, keywords]) => ({
      id,
      label,
      keywords,
      run: (editor: Editor) => {
        convertBlock(editor, selectedBlockID(editor), id);
      },
    })),
    ...(callbacks.onAttachment
      ? [
          {
            id: "attachment",
            label: "Attachment",
            keywords: "image photo file audio video",
            run: callbacks.onAttachment,
          },
        ]
      : []),
    {
      id: "source",
      label: "Source reference",
      keywords: "email message recording evidence",
      run: callbacks.onSource,
    },
    {
      id: "maple",
      label: "Ask @maple",
      keywords: "agent ai assistant",
      run: callbacks.onMaple,
    },
    {
      id: "divider",
      label: "Divider",
      keywords: "line rule",
      run: (editor) => {
        editor.commands.setHorizontalRule();
      },
    },
    {
      id: "table",
      label: "Table",
      keywords: "rows columns grid",
      run: (editor) => {
        editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
      },
    },
    ...(["info", "warning", "tip", "danger"] as const).map((kind) => ({
      id: "callout-" + kind,
      label: kind[0].toUpperCase() + kind.slice(1) + " callout",
      keywords: "aside notice",
      run: (editor: Editor) => {
        if (editor.schema.nodes["callout"])
          editor.commands.insertContent({
            type: "callout",
            attrs: { kind },
            content: [{ type: "paragraph" }],
          });
      },
    })),
  ];
  return items.filter(
    (item) =>
      callbacks.managed !== false || !["source", "maple"].includes(item.id),
  );
}
export function filterSlashItems(items: SlashItem[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) =>
    words.every((word) =>
      (item.label + " " + item.keywords).toLowerCase().includes(word),
    ),
  );
}
export function createSlashExtension(callbacks: DailyInteractionCallbacks) {
  const key = new PluginKey("mapleSlash");
  return Extension.create({
    name: "mapleSlash",
    priority: 1000,
    addProseMirrorPlugins() {
      const editor = this.editor,
        doc = editor.view.dom.ownerDocument;
      return [
        Suggestion<SlashItem>({
          editor,
          pluginKey: key,
          char: "/",
          allowSpaces: true,
          startOfLine: true,
          allow: ({ state, range }) =>
            editor.isEditable &&
            state.doc.resolve(range.from).parent.type.name === "paragraph",
          items: ({ query }) =>
            filterSlashItems(
              dailySlashItems(callbacks).filter(
                (item) =>
                  !item.id.startsWith("callout-") ||
                  !!editor.schema.nodes["callout"],
              ),
              query,
            ),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
          render: () => {
            let menu: HTMLElement | undefined,
              props: SuggestionProps<SlashItem>,
              index = 0,
              unmount: (() => void) | undefined;
            const paint = () => {
              if (!menu) return;
              menu.replaceChildren();
              if (!props.items.length) {
                const empty = doc.createElement("p");
                empty.className = "maple-menu-hint";
                empty.textContent = "No matching blocks";
                menu.append(empty);
              }
              props.items.forEach((item, i) => {
                const entry = button(doc, item.label, () =>
                  props.command(item),
                );
                entry.setAttribute("role", "option");
                entry.id = menu!.id + "-" + i;
                entry.setAttribute("aria-selected", String(i === index));
                menu!.append(entry);
              });
              const hint = doc.createElement("div");
              hint.className = "maple-menu-hint";
              hint.textContent = "Type to search · ↑ ↓ · Enter · Esc";
              menu.append(hint);
              editor.view.dom.setAttribute(
                "aria-activedescendant",
                props.items.length ? menu.id + "-" + index : "",
              );
            };
            return {
              onStart: (next) => {
                props = next;
                index = 0;
                menu = menuElement(
                  doc,
                  "maple-slash-menu",
                  "listbox",
                  "Insert a block",
                );
                menu.id = "maple-slash-" + crypto.randomUUID();
                paint();
                unmount = props.mount(menu);
                editor.view.dom.setAttribute("aria-controls", menu.id);
              },
              onUpdate: (next) => {
                props = next;
                index = Math.min(index, Math.max(0, props.items.length - 1));
                paint();
              },
              onKeyDown: ({ event }) => {
                if (event.key === "Escape") {
                  return true;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  index =
                    (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      props.items.length) %
                    Math.max(1, props.items.length);
                  paint();
                  menu
                    ?.querySelector("[aria-selected=true]")
                    ?.scrollIntoView?.({ block: "nearest" });
                  return true;
                }
                if (event.key === "Enter") {
                  if (props.items[index]) props.command(props.items[index]);
                  return true;
                }
                return false;
              },
              onExit: () => {
                unmount?.();
                menu?.remove();
                editor.view.dom.removeAttribute("aria-controls");
                editor.view.dom.removeAttribute("aria-activedescendant");
              },
            };
          },
        }),
      ];
    },
  });
}
export function createSelectionBubbleExtension() {
  const doc = document,
    menu = menuElement(
      doc,
      "maple-selection-menu",
      "toolbar",
      "Selection formatting",
    );
  let activeEditor: Editor;
  for (const [label, mark] of [
    ["Bold", "bold"],
    ["Italic", "italic"],
    ["Underline", "underline"],
    ["Strike", "strike"],
    ["Code", "code"],
  ] as const) {
    const entry = button(doc, label, () => {
      activeEditor.chain().focus().toggleMark(mark).run();
    });
    entry.dataset["mark"] = mark;
    menu.append(entry);
  }
  const linkInput = doc.createElement("input");
  linkInput.type = "url";
  linkInput.placeholder = "https://example.com";
  linkInput.setAttribute("aria-label", "Link URL");
  linkInput.hidden = true;
  let linkComposing = false;
  const closeLinkDraft = () => {
    linkInput.hidden = true;
    applyButton.hidden = true;
    linkButton.setAttribute("aria-expanded", "false");
  };
  const applyLink = () => {
    if (linkInput.hidden || linkComposing || !activeEditor?.isEditable || activeEditor.isDestroyed) return;
    const value = linkInput.value.trim();
    if (!value) {
      activeEditor.chain().focus().unsetLink().run();
      closeLinkDraft();
      return;
    }
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(value)) {
      linkInput.setCustomValidity("Use an http, https, mailto or tel URL.");
      linkInput.reportValidity();
      return;
    }
    linkInput.setCustomValidity("");
    activeEditor.chain().focus().setLink({ href: value }).run();
    closeLinkDraft();
  };
  const applyButton = button(doc, "Apply link", applyLink);
  applyButton.hidden = true;
  const linkButton = button(doc, "Link", () => {
    if (!activeEditor?.isEditable || activeEditor.isDestroyed || linkComposing) return;
    if (!linkInput.hidden) { closeLinkDraft(); return; }
    linkInput.hidden = false;
    applyButton.hidden = false;
    linkButton.setAttribute("aria-expanded", "true");
    linkInput.value = activeEditor.getAttributes("link")["href"] ?? "";
    linkInput.setCustomValidity("");
    linkInput.focus();
  });
  linkButton.setAttribute("aria-expanded", "false");
  menu.append(linkButton, linkInput, applyButton);
  linkInput.addEventListener("compositionstart", () => { linkComposing = true; });
  linkInput.addEventListener("compositionend", () => { linkComposing = false; });
  linkInput.addEventListener("keydown", (event) => {
    if (event.isComposing || linkComposing) { event.stopPropagation(); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Cancel just this URL draft. Do not bubble into the toolbar's Escape
      // handler, which exits formatting and collapses the text selection.
      event.stopPropagation();
      closeLinkDraft();
      linkButton.focus({ preventScroll: true });
    }
  });
  menuKeyboard(menu, () => {
    if (linkComposing) return;
    closeLinkDraft();
    activeEditor.commands.focus();
    activeEditor.commands.setTextSelection(activeEditor.state.selection.to);
  });
  return BubbleMenu.configure({
    pluginKey: "mapleSelectionBubble",
    element: menu,
    appendTo: () => doc.body,
    updateDelay: 80,
    options: {
      strategy: "fixed",
      placement: "top",
      offset: 8,
      flip: true,
      shift: { padding: 10 },
    },
    shouldShow: ({ editor, state }) => {
      if (editor.isDestroyed || !editor.schema) return false;
      activeEditor = editor;
      const visible =
        editor.isEditable &&
        state.selection instanceof TextSelection &&
        !state.selection.empty &&
        !editor.isActive("codeBlock") &&
        !state.selection.$from.parent.isAtom;
      if (visible)
        menu
          .querySelectorAll<HTMLButtonElement>("[data-mark]")
          .forEach((entry) => {
            entry.disabled = !editor.schema.marks[entry.dataset["mark"]!];
            entry.setAttribute(
              "aria-pressed",
              String(editor.isActive(entry.dataset["mark"]!)),
            );
          });
      return visible;
    },
  });
}
/** Keyboard and toolbar access to the same block menu as the hover grip. */
export function openBlockActions(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  editor.view.dom.dispatchEvent(new Event("maple-open-block-actions"));
  return true;
}
export function createBlockActionsExtension(
  callbacks: DailyInteractionCallbacks,
) {
  return Extension.create({
    name: "mapleBlockActions",
    addKeyboardShortcuts() {
      return {
        "Mod-Alt-b": () => openBlockActions(this.editor),
        "Alt-Shift-ArrowUp": () =>
          moveBlock(this.editor, selectedBlockID(this.editor), -1),
        "Alt-Shift-ArrowDown": () =>
          moveBlock(this.editor, selectedBlockID(this.editor), 1),
        "Mod-Alt-d": () =>
          duplicateBlock(this.editor, selectedBlockID(this.editor)),
      };
    },
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey("mapleBlockActions"),
          view(view) {
            const doc = view.dom.ownerDocument,
              win = doc.defaultView!,
              style = doc.createElement("style");
            style.textContent = interactionCSS;
            doc.head.append(style);
            const grip = doc.createElement("button");
            grip.type = "button";
            grip.textContent = "⠿";
            grip.addEventListener("click", () => {
              if (suppressClick) {
                suppressClick = false;
                return;
              }
              openMenu();
            });
            grip.className = "maple-block-grip";
            grip.setAttribute("aria-label", "Block actions; drag to reorder");
            grip.setAttribute("aria-haspopup", "menu");
            grip.draggable = false;
            grip.hidden = true;
            doc.body.append(grip);
            let hovered = "",
              menu: HTMLElement | undefined,
              dragged = "",
              destroyed = false;
            let pointerStart:
              { id: number; x: number; y: number; blockID: string } | undefined;
            let suppressClick = false;
            const indicator = doc.createElement("div");
            indicator.className = "maple-block-drop-line";
            indicator.hidden = true;
            doc.body.append(indicator);
            const close = () => {
              menu?.remove();
              menu = undefined;
              grip.setAttribute("aria-expanded", "false");
            };
            const refresh = () => {
              const block = topLevelBlocks(editor).find(
                (b) => b.id === hovered,
              );
              if (!block || !editor.isEditable) {
                grip.hidden = true;
                close();
                return;
              }
              const element = view.nodeDOM(block.pos) as HTMLElement | null;
              if (!element?.getBoundingClientRect) {
                grip.hidden = true;
                return;
              }
              const rect = element.getBoundingClientRect();
              grip.hidden =
                !!element.closest(".maple-section-hidden") ||
                rect.bottom < 0 ||
                rect.top > win.innerHeight;
              grip.style.left =
                Math.max(
                  4,
                  rect.left - (block.node.type.name === "heading" ? 64 : 30),
                ) + "px";
              grip.style.top = Math.max(4, rect.top) + "px";
            };
            const perform = (action: () => boolean) => {
              if (!action())
                callbacks.onError?.("This block cannot be changed that way.");
              close();
              editor.commands.focus();
              refresh();
            };
            function openMenu() {
              if (!hovered || !editor.isEditable) return;
              close();
              menu = menuElement(
                doc,
                "maple-block-actions",
                "menu",
                "Block actions",
              );
              const id = hovered,
                index = topLevelBlocks(editor).findIndex((b) => b.id === id),
                blocks = topLevelBlocks(editor);
              const choices: [string, () => boolean, boolean?][] = [
                ["Move up", () => moveBlock(editor, id, -1), index === 0],
                [
                  "Move down",
                  () => moveBlock(editor, id, 1),
                  index === blocks.length - 1,
                ],
                ["Duplicate", () => duplicateBlock(editor, id)],
                [
                  callbacks.onClear ? "Clear from note" : "Delete block",
                  () => deleteBlock(editor, id, callbacks.onClear),
                ],
              ];
              if (callbacks.onMoveToNextDay)
                choices.push([
                  "Move to next day",
                  () => {
                    callbacks.onMoveToNextDay!(id);
                    return true;
                  },
                ]);
              if (callbacks.onCopyToNextDay)
                choices.push([
                  "Copy to next day",
                  () => {
                    callbacks.onCopyToNextDay!(id);
                    return true;
                  },
                ]);
              for (const [label, action, disabled] of choices) {
                const entry = button(doc, label, () => perform(action));
                entry.setAttribute("role", "menuitem");
                entry.disabled = !!disabled;
                menu.append(entry);
              }
              const current = blocks[index]?.node;
              if (
                current &&
                ![
                  "sourceReference",
                  "linkedTask",
                  "table",
                  "horizontalRule",
                ].includes(current.type.name)
              )
                for (const [kind, label] of [
                  ["paragraph", "Text"],
                  ["heading1", "Heading 1"],
                  ["heading2", "Heading 2"],
                  ["heading3", "Heading 3"],
                  ["bulletList", "Bullet list"],
                  ["orderedList", "Numbered list"],
                  ["taskList", "Checklist"],
                  ["blockquote", "Quote"],
                  ["codeBlock", "Code block"],
                ] as [BlockConversion, string][]) {
                  const entry = button(doc, "Turn into " + label, () =>
                    perform(() => convertBlock(editor, id, kind)),
                  );
                  entry.setAttribute("role", "menuitem");
                  menu.append(entry);
                }
              doc.body.append(menu);
              grip.setAttribute("aria-expanded", "true");
              const currentMenu = menu;
              void computePosition(grip, menu, {
                strategy: "fixed",
                placement: "right-start",
                middleware: [offset(6), flip(), shift({ padding: 10 })],
              }).then(({ x, y }) => {
                if (!destroyed && menu === currentMenu) {
                  menu.style.left = x + "px";
                  menu.style.top = y + "px";
                }
              });
              menuKeyboard(menu, () => {
                close();
                grip.focus();
              });
              menu
                .querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus();
            }
            const track = (event: MouseEvent) => {
              if (menu || dragged || pointerStart) return;
              let element = event.target as HTMLElement | null;
              if (!element || !view.dom.contains(element)) return;
              while (
                element.parentElement !== view.dom &&
                element.parentElement
              )
                element = element.parentElement;
              if (element.parentElement !== view.dom) return;
              const block = topLevelBlocks(editor).find(
                (b) => view.nodeDOM(b.pos) === element,
              );
              if (block) {
                hovered = block.id;
                refresh();
              }
            };
            const outside = (event: PointerEvent) => {
              if (
                event.target !== grip &&
                !menu?.contains(event.target as Node)
              )
                close();
            };
            const destinationAt = (y: number) => {
              const blocks = topLevelBlocks(editor);
              for (let i = 0; i < blocks.length; i++) {
                const rect = (
                  view.nodeDOM(blocks[i].pos) as HTMLElement | null
                )?.getBoundingClientRect();
                if (rect && y < rect.top + rect.height / 2) return i;
              }
              return blocks.length;
            };
            const pointerDown = (event: PointerEvent) => {
              if (event.button !== 0 || !hovered || !editor.isEditable) return;
              event.preventDefault();
              close();
              suppressClick = false;
              pointerStart = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                blockID: hovered,
              };
            };
            const pointerMove = (event: PointerEvent) => {
              if (!pointerStart || event.pointerId !== pointerStart.id) return;
              if (
                !dragged &&
                Math.hypot(
                  event.clientX - pointerStart.x,
                  event.clientY - pointerStart.y,
                ) < 4
              )
                return;
              event.preventDefault();
              dragged = pointerStart.blockID;
              suppressClick = true;
              grip.style.cursor = "grabbing";
              const blocks = topLevelBlocks(editor),
                destination = destinationAt(event.clientY);
              const anchor = blocks[Math.min(destination, blocks.length - 1)];
              const rect =
                anchor &&
                (
                  view.nodeDOM(anchor.pos) as HTMLElement | null
                )?.getBoundingClientRect();
              if (rect) {
                indicator.hidden = false;
                indicator.style.left = rect.left + "px";
                indicator.style.width = rect.width + "px";
                indicator.style.top =
                  (destination === blocks.length ? rect.bottom : rect.top) +
                  "px";
              }
            };
            const finishPointer = (event: PointerEvent) => {
              if (!pointerStart || event.pointerId !== pointerStart.id) return;
              const id = dragged;
              pointerStart = undefined;
              dragged = "";
              indicator.hidden = true;
              grip.style.cursor = "";
              const rect = view.dom.getBoundingClientRect();
              if (
                id &&
                event.type === "pointerup" &&
                event.clientX >= rect.left - 36 &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top - 24 &&
                event.clientY <= rect.bottom + 24 &&
                editor.isEditable
              ) {
                event.preventDefault();
                moveBlockTo(editor, id, destinationAt(event.clientY));
              }
              refresh();
            };
            const openSelected = () => {
              hovered = selectedBlockID(editor);
              refresh();
              openMenu();
            };
            grip.addEventListener("pointerdown", pointerDown);
            doc.addEventListener("pointermove", pointerMove);
            doc.addEventListener("pointerup", finishPointer);
            doc.addEventListener("pointercancel", finishPointer);
            view.dom.addEventListener("mousemove", track);
            view.dom.addEventListener("maple-open-block-actions", openSelected);
            doc.addEventListener("pointerdown", outside);
            win.addEventListener("scroll", refresh, true);
            win.addEventListener("resize", refresh);
            return {
              update: refresh,
              destroy() {
                destroyed = true;
                close();
                grip.remove();
                indicator.remove();
                style.remove();
                view.dom.removeEventListener("mousemove", track);
                doc.removeEventListener("pointermove", pointerMove);
                doc.removeEventListener("pointerup", finishPointer);
                doc.removeEventListener("pointercancel", finishPointer);
                view.dom.removeEventListener(
                  "maple-open-block-actions",
                  openSelected,
                );
                doc.removeEventListener("pointerdown", outside);
                win.removeEventListener("scroll", refresh, true);
                win.removeEventListener("resize", refresh);
              },
            };
          },
        }),
      ];
    },
  });
}
export function createDailyInteractionExtensions(
  callbacks: DailyInteractionCallbacks,
) {
  return [
    createSlashExtension(callbacks),
    createSelectionBubbleExtension(),
    createBlockActionsExtension(callbacks),
  ];
}
