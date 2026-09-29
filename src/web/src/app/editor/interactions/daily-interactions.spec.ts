import { Editor, Extension, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  convertBlock,
  createDailyInteractionExtensions,
  dailySlashItems,
  deleteBlock,
  duplicateBlock,
  filterSlashItems,
  moveBlock,
  moveBlockTo,
} from "./daily-interactions";
const identity = Extension.create({
  name: "testIdentity",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "bulletList",
          "orderedList",
          "taskList",
          "listItem",
          "taskItem",
          "codeBlock",
          "linkedTask",
        ],
        attributes: { maple: { default: null } },
      },
    ];
  },
});
const linkedTask = Node.create({
  name: "linkedTask",
  group: "block",
  atom: true,
  addAttributes() {
    return { taskID: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "maple-linked-task" }];
  },
  renderHTML() {
    return ["maple-linked-task"];
  },
});
const editors: Editor[] = [];
const p = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { maple: { v: 1, id } },
  content: [{ type: "text", text }],
});
function editor(
  content: any[],
  interactions = false,
  callbacks = { onSource: vi.fn(), onMaple: vi.fn(), onClear: vi.fn() },
) {
  const element = document.createElement("div");
  document.body.append(element);
  const result = new Editor({
    element,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      identity,
      linkedTask,
      ...(interactions ? createDailyInteractionExtensions(callbacks) : []),
    ],
    content: { type: "doc", content },
  });
  vi.spyOn(result.view, "coordsAtPos").mockReturnValue({
    left: 10,
    right: 11,
    top: 20,
    bottom: 40,
  });
  editors.push(result);
  return result;
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const ids = (e: Editor) =>
  e.getJSON().content?.map((n) => n.attrs?.["maple"]?.id);
describe("Daily block interactions", () => {
  it("moves top-level blocks in both directions without changing any identity or contents", () => {
    const e = editor([p("a", "First"), p("b", "Second"), p("c", "Third")]);
    const original = e.getJSON().content![1];
    expect(moveBlock(e, "b", 1)).toBe(true);
    expect(ids(e)).toEqual(["a", "c", "b"]);
    expect(e.getJSON().content![2]).toEqual(original);
    expect(moveBlockTo(e, "b", 0)).toBe(true);
    expect(ids(e)).toEqual(["b", "a", "c"]);
    expect(moveBlock(e, "b", -1)).toBe(false);
    expect(e.commands.undo()).toBe(true);
    expect(ids(e)).toEqual(["a", "c", "b"]);
  });
  it("duplicates every descendant identity and request without reusing run or task action identity", () => {
    const e = editor([
      {
        type: "blockquote",
        attrs: { maple: { v: 1, id: "outer" } },
        content: [
          {
            ...p("inner", "Ask"),
            attrs: {
              maple: {
                v: 1,
                id: "inner",
                kind: "maple-request",
                requestID: "request",
                runID: "run",
                taskCommandID: "old-action",
                taskID: "canonical",
              },
            },
          },
        ],
      },
    ]);
    expect(duplicateBlock(e, "outer")).toBe(true);
    const original = e.getJSON().content![0],
      copy = e.getJSON().content![1];
    expect(original.attrs!["maple"].id).toBe("outer");
    expect(copy.attrs!["maple"].id).not.toBe("outer");
    const meta = e.state.doc.child(1).child(0).attrs["maple"];
    expect(meta.id).not.toBe("inner");
    expect(meta.requestID).not.toBe("request");
    expect(meta.runID).toBeUndefined();
    expect(meta.taskCommandID).toBeUndefined();
    expect(meta.taskID).toBe("canonical");
  });
  it("delegates clear with stable identity and never interprets linked task deletion as completion", () => {
    const e = editor([
      {
        type: "linkedTask",
        attrs: { taskID: "task", maple: { v: 1, id: "task-block" } },
      },
      p("a", "Text"),
    ]);
    expect(deleteBlock(e, "task-block")).toBe(false);
    const clear = vi.fn();
    expect(deleteBlock(e, "task-block", clear)).toBe(true);
    expect(clear).toHaveBeenCalledExactlyOnceWith("task-block");
    expect(ids(e)).toEqual(["task-block", "a"]);
    expect(deleteBlock(e, "a", clear)).toBe(true);
    expect(clear).toHaveBeenLastCalledWith("a");
  });
  it("converts text and list kinds while preserving the original block and descendant IDs", () => {
    const e = editor([p("a", "Important")]);
    expect(convertBlock(e, "a", "heading2")).toBe(true);
    expect(e.getJSON().content![0].attrs).toMatchObject({
      level: 2,
      maple: { id: "a" },
    });
    expect(convertBlock(e, "a", "taskList")).toBe(true);
    const itemID = e.state.doc.child(0).child(0).attrs["maple"].id;
    expect(convertBlock(e, "a", "bulletList")).toBe(true);
    expect(e.state.doc.child(0).child(0).attrs["maple"].id).toBe(itemID);
    expect(ids(e)?.[0]).toBe("a");
    expect(e.getText().trim()).toBe("Important");
  });
  it("refuses structural changes in read-only mode", () => {
    const e = editor([p("a", "Retained"), p("b", "Other")]);
    e.setEditable(false);
    const before = e.getJSON();
    expect(moveBlock(e, "a", 1)).toBe(false);
    expect(duplicateBlock(e, "a")).toBe(false);
    expect(deleteBlock(e, "a")).toBe(false);
    expect(convertBlock(e, "a", "heading1")).toBe(false);
    expect(e.getJSON()).toEqual(before);
  });
  it("filters slash commands by label and all query words", () => {
    const items = dailySlashItems({ onSource: vi.fn(), onMaple: vi.fn() });
    expect(filterSlashItems(items, "email").map((i) => i.id)).toEqual([
      "source",
    ]);
    expect(filterSlashItems(items, "heading 2").map((i) => i.id)).toEqual([
      "heading2",
    ]);
    expect(filterSlashItems(items, "no such command")).toHaveLength(0);
  });
  it("mounts block menu with keyboard actions and tears down floating elements", async () => {
    const e = editor([p("a", "First"), p("b", "Second")], true);
    e.view.dom
      .querySelector("p")!
      .dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const grip =
      document.querySelector<HTMLButtonElement>(".maple-block-grip")!;
    expect(grip.hidden).toBe(false);
    grip.click();
    const menu = document.querySelector<HTMLElement>("[role=menu]")!;
    expect(menu).toBeTruthy();
    const down = Array.from(menu.querySelectorAll("button")).find(
      (b) => b.textContent === "Move down",
    )!;
    down.click();
    expect(ids(e)).toEqual(["b", "a"]);
    e.destroy();
    editors.splice(editors.indexOf(e), 1);
    expect(document.querySelector(".maple-block-grip")).toBeNull();
    expect(document.querySelector(".maple-block-actions")).toBeNull();
  });
  it("slash search deletes its trigger before invoking an explicit source command", async () => {
    const callbacks = { onSource: vi.fn(), onMaple: vi.fn(), onClear: vi.fn() };
    const e = editor(
      [{ type: "paragraph", attrs: { maple: { v: 1, id: "a" } } }],
      true,
      callbacks,
    );
    e.commands.setTextSelection(1);
    e.view.dispatch(e.state.tr.insertText("/email"));
    await vi.waitFor(() =>
      expect(document.querySelector("[role=listbox]")?.textContent).toContain(
        "Source reference",
      ),
    );
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    e.view.dom.dispatchEvent(event);
    expect(callbacks.onSource).toHaveBeenCalledOnce();
    expect(e.getText()).toBe("");
    expect(callbacks.onMaple).not.toHaveBeenCalled();
  });
  it("uses arrow selection and Escape in the searchable slash menu", async () => {
    const e = editor(
      [{ type: "paragraph", attrs: { maple: { v: 1, id: "a" } } }],
      true,
    );
    e.commands.setTextSelection(1);
    e.view.dispatch(e.state.tr.insertText("/heading"));
    await vi.waitFor(() =>
      expect(document.querySelector("[role=listbox]")?.textContent).toContain(
        "Heading 1",
      ),
    );
    e.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.querySelector("[role=listbox]")?.outerHTML).toContain(
      'aria-selected="true"',
    );
    expect(
      document.querySelector("[role=option][aria-selected=true]")?.textContent,
    ).toBe("Heading 2");
    e.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(e.state.doc.firstChild?.attrs["level"]).toBe(2);
    expect(e.state.doc.firstChild?.attrs["maple"].id).toBe("a");
    convertBlock(e, "a", "paragraph");
    e.commands.setTextSelection(1);
    e.view.dispatch(e.state.tr.insertText("/nothing"));
    await vi.waitFor(() =>
      expect(document.querySelector("[role=listbox]")?.textContent).toContain(
        "No matching blocks",
      ),
    );
    e.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[role=listbox]")).toBeNull(),
    );
    expect(e.getText().trim()).toBe("/nothing");
  });
  it("reorders a pointer-dragged grip without treating it as a copied block", () => {
    const e = editor(
      [p("a", "First"), p("b", "Second"), p("c", "Third")],
      true,
    );
    vi.spyOn(e.view.dom, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 500, 300),
    );
    Array.from(e.view.dom.children).forEach((element, i) =>
      vi
        .spyOn(element, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, i * 100, 500, 100)),
    );
    e.view.dom
      .querySelector("p")!
      .dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const grip =
      document.querySelector<HTMLButtonElement>(".maple-block-grip")!;
    const pointer = (type: string, y: number) => {
      const event = new MouseEvent(type, {
        button: 0,
        clientX: 50,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    grip.dispatchEvent(pointer("pointerdown", 20));
    document.dispatchEvent(pointer("pointermove", 290));
    expect(
      document.querySelector<HTMLElement>(".maple-block-drop-line")?.hidden,
    ).toBe(false);
    const up = pointer("pointerup", 290);
    document.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(ids(e)).toEqual(["b", "c", "a"]);
    expect(
      document.querySelector<HTMLElement>(".maple-block-drop-line")?.hidden,
    ).toBe(true);
    grip.dispatchEvent(pointer("pointerdown", 220));
    document.dispatchEvent(pointer("pointermove", 20));
    document.dispatchEvent(pointer("pointercancel", 20));
    expect(ids(e)).toEqual(["b", "c", "a"]);
  });
  it("ignores the delayed bubble update after its editor is destroyed", async () => {
    const e = editor([p("a", "Selection before closing")], true);
    e.commands.setTextSelection({ from: 1, to: 8 });
    e.destroy();
    editors.splice(editors.indexOf(e), 1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(document.querySelector(".maple-selection-menu")).toBeNull();
    expect(document.querySelector(".maple-block-drop-line")).toBeNull();
  });
  it("requests next-day transfers from the block menu without replacing its identity locally", () => {
    const callbacks = {
      onSource: vi.fn(),
      onMaple: vi.fn(),
      onClear: vi.fn(),
      onMoveToNextDay: vi.fn(),
      onCopyToNextDay: vi.fn(),
    };
    const e = editor([p("original", "Retain identity")], true, callbacks);
    e.view.dom
      .querySelector("p")!
      .dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const grip =
      document.querySelector<HTMLButtonElement>(".maple-block-grip")!;
    for (const label of ["Move to next day", "Copy to next day"]) {
      grip.click();
      const action = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          ".maple-block-actions button",
        ),
      ).find((button) => button.textContent === label)!;
      action.click();
    }
    expect(callbacks.onMoveToNextDay).toHaveBeenCalledExactlyOnceWith(
      "original",
    );
    expect(callbacks.onCopyToNextDay).toHaveBeenCalledExactlyOnceWith(
      "original",
    );
    expect(ids(e)).toEqual(["original"]);
  });
  it("formats the text selection through the bubble menu", async () => {
    const e = editor([p("a", "Select these words")], true);
    e.commands.setTextSelection({ from: 1, to: 7 });
    await vi.waitFor(() =>
      expect(document.querySelector(".maple-selection-menu")).toBeTruthy(),
    );
    const bold = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".maple-selection-menu button",
      ),
    ).find((b) => b.textContent === "Bold")!;
    bold.click();
    expect(
      e.state.doc.firstChild?.firstChild?.marks.some(
        (mark) => mark.type.name === "bold",
      ),
    ).toBe(true);
    expect(e.state.doc.firstChild?.attrs["maple"].id).toBe("a");
    const link = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".maple-selection-menu button",
      ),
    ).find((b) => b.textContent === "Link")!;
    link.click();
    const input = document.querySelector<HTMLInputElement>(
      ".maple-selection-menu input",
    )!;
    expect(input.hidden).toBe(false);
    input.value = "javascript:alert(1)";
    const apply = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".maple-selection-menu button",
      ),
    ).find((b) => b.textContent === "Apply link")!;
    apply.click();
    expect(e.getAttributes("link")["href"]).toBeUndefined();
    input.value = "https://example.com/review";
    apply.click();
    expect(
      e.state.doc.firstChild?.firstChild?.marks.find(
        (mark) => mark.type.name === "link",
      )?.attrs["href"],
    ).toBe("https://example.com/review");
  });
});
