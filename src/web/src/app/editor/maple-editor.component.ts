import {
  AfterViewInit,
  ApplicationRef,
  Component,
  ElementRef,
  EnvironmentInjector,
  Injector,
  OnDestroy,
  ViewChild,
  ViewEncapsulation,
  createComponent,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Editor, Extension, Node, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Plugin } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";
import { MuiButtonComponent } from "@maple/ui";
import { CodeBlockWithLanguage } from "../notebooks/sugar-editor/code-block-with-language";
import { getTableExtensions } from "../notebooks/sugar-editor/table-extension";
import {
  decodeDaily,
  encodeDaily,
  BlockMetadata,
  SourceReference,
} from "./daily-markdown-codec";
import { LinkedTaskComponent } from "./linked-task.component";
import { SourceReferenceComponent } from "./source-reference.component";
const identityTypes = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "codeBlock",
  "horizontalRule",
  "table",
  "sourceReference",
  "linkedTask",
];
export const StableBlockIdentity = Extension.create({
  name: "stableBlockIdentity",
  addGlobalAttributes() {
    return [
      {
        types: identityTypes,
        attributes: {
          maple: {
            default: null,
            renderHTML: () => ({}),
            parseHTML: () => null,
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = newState.tr;
          const seen = new Set<string>();
          newState.doc.descendants((node, pos, parent) => {
            if (
              parent !== newState.doc &&
              !["listItem", "taskItem"].includes(node.type.name)
            )
              return;
            const meta = node.attrs["maple"] as BlockMetadata | null;
            if (!meta?.id || seen.has(meta.id)) {
              const identity = {
                ...(meta ?? {}),
                v: 1,
                id: crypto.randomUUID(),
                ...(meta?.requestID
                  ? { requestID: crypto.randomUUID(), runID: undefined }
                  : {}),
                ...(node.type.name === "linkedTask"
                  ? { taskID: node.attrs["taskID"] }
                  : {}),
              };
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                maple: identity,
              });
              seen.add(identity.id);
            } else seen.add(meta.id);
          });
          return tr.docChanged ? tr : null;
        },
        props: {
          transformPasted(slice) {
            const remap = (fragment: Fragment): Fragment =>
              Fragment.fromArray(
                fragment.content.map((node) => {
                  const attrs = { ...node.attrs };
                  if (attrs["maple"])
                    attrs["maple"] = {
                      ...attrs["maple"],
                      id: crypto.randomUUID(),
                      requestID: attrs["maple"].requestID
                        ? crypto.randomUUID()
                        : undefined,
                      runID: undefined,
                    };
                  return node.isText
                    ? node
                    : node.type.create(
                        attrs,
                        node.content.size ? remap(node.content) : undefined,
                        node.marks,
                      );
                }),
              );
            return new Slice(
              remap(slice.content),
              slice.openStart,
              slice.openEnd,
            );
          },
        },
      }),
    ];
  },
});
@Component({
  selector: "maple-editor",
  standalone: true,
  imports: [FormsModule, MuiButtonComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (showToolbar()) {
    <div class="maple-editor-tools" aria-label="Note formatting">
      <mui-button variant="ghost" (pressed)="toggleSource()">{{
        source() ? "Formatted view" : "View Markdown"
      }}</mui-button>
      @if (!source() && !readOnly()) {
        <mui-button
          variant="ghost"
          (pressed)="
            editor?.chain()?.focus()?.toggleHeading({ level: 2 })?.run()
          "
          >Heading</mui-button
        ><mui-button
          variant="ghost"
          (pressed)="editor?.chain()?.focus()?.toggleBold()?.run()"
          >Bold</mui-button
        ><mui-button
          variant="ghost"
          (pressed)="editor?.chain()?.focus()?.toggleTaskList()?.run()"
          >Task</mui-button
        ><mui-button variant="ghost" (pressed)="addRequest()"
          >Ask @maple</mui-button
        ><mui-button variant="ghost" (pressed)="sourceRequested.emit()"
          >Add source</mui-button
        >
      }
    </div>
    }
    @if (insertionMenu() && !source() && !readOnly()) {
      <div
        class="maple-insertion-menu"
        role="group"
        aria-label="Insert a block"
      >
        @for (label of insertionChoices; track label; let index = $index) {
          <button
            type="button"
            [class.active]="insertionIndex() === index"
            (click)="chooseInsertion(index)"
          >
            {{ label }}
          </button>
        }
        <small>↑ ↓ to choose · Enter to insert · Esc to close</small>
      </div>
    }
    @if (notice()) {
      <p class="maple-editor-notice" role="status">{{ notice() }}</p>
    }
    <div #surface class="maple-editor-surface" [hidden]="source()"></div>
    @if (source()) {
      <textarea
        class="maple-editor-source"
        aria-label="Daily note Markdown source"
        spellcheck="false"
        [readOnly]="readOnly()"
        [ngModel]="raw"
        (ngModelChange)="sourceChanged($event)"
      ></textarea>
    }
  `,
  styles: [
    `
      .maple-editor-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: 28px;
        font-family: var(--font-sans);
      }
      .maple-insertion-menu {
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: 0 8px 24px var(--color-border);
        background: var(--color-bg-secondary);
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
        font: 13px var(--font-sans);
      }
      .maple-insertion-menu button {
        padding: 9px 12px;
        border: 0;
        background: transparent;
        color: var(--color-text-main);
        border-radius: 5px;
        cursor: pointer;
      }
      .maple-insertion-menu button.active {
        background: var(--color-primary-light);
        color: var(--color-link, var(--color-primary));
      }
      .maple-insertion-menu small {
        align-self: center;
        color: var(--color-text-muted);
      }
      .maple-editor-notice {
        font: 13px/1.6 var(--font-sans);
        padding: 12px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
      }
      .maple-editor-surface .tiptap {
        outline: none;
        min-height: 400px;
        padding: 0 0 80px 28px;
        border-left: 3px solid var(--color-writing, var(--color-primary));
        font: 20px/1.8 var(--font-serif);
        color: var(--color-text-main);
      }
      .maple-editor-surface .tiptap > * {
        margin: 18px 0 24px;
      }
      .maple-editor-surface .tiptap h1,
      .maple-editor-surface .tiptap h2,
      .maple-editor-surface .tiptap h3 {
        font-family: var(--font-serif);
        font-weight: 400;
        position: relative;
      }
      .maple-editor-surface .tiptap h2 {
        font-size: 30px;
      }
      .maple-editor-surface .tiptap h2:before {
        content: "";
        position: absolute;
        left: -37px;
        top: 18px;
        width: 14px;
        height: 14px;
        border: 2px solid var(--color-writing, var(--color-primary));
        border-radius: 50%;
        background: var(--color-bg);
      }
      .maple-editor-surface .tiptap p {
        margin: 0;
        color: var(--color-text-main);
      }
      .maple-editor-surface .tiptap .maple-paragraph {
        position: relative;
      }
      .maple-editor-surface .tiptap .maple-request {
        border-left: 3px solid var(--color-agent, var(--color-primary));
        padding: 14px 18px;
        background: var(--color-bg-secondary);
        border-radius: 6px;
        font-family: var(--font-sans);
        font-size: 16px;
      }
      .maple-editor-surface .tiptap .maple-reply p,
      .maple-editor-surface .tiptap .maple-reply {
        color: var(--color-agent, var(--color-primary));
      }
      .maple-run-button {
        font: 13px var(--font-sans);
        border: 1px solid var(--color-border);
        color: var(--color-link, var(--color-primary));
        background: var(--color-bg);
        border-radius: 6px;
        padding: 9px 13px;
        cursor: pointer;
        margin-top: 14px;
      }
      .maple-run-button:focus-visible {
        outline: 2px solid var(--color-focus, var(--color-primary));
      }
      .maple-editor-surface .tiptap .ProseMirror-selectednode {
        outline: 2px solid var(--color-focus, var(--color-primary));
        outline-offset: 4px;
        border-radius: 6px;
      }
      .maple-editor-surface .tiptap ul[data-type="taskList"] {
        list-style: none;
        padding-left: 0;
      }
      .maple-editor-surface .tiptap li[data-type="taskItem"] {
        display: flex;
        gap: 12px;
        align-items: start;
      }
      .maple-editor-surface .tiptap li[data-type="taskItem"] > label {
        flex: 0 0 auto;
        margin-top: 6px;
      }
      .maple-editor-surface .tiptap li[data-type="taskItem"] > div {
        flex: 1;
      }
      .maple-editor-surface .tiptap input[type="checkbox"] {
        width: 18px;
        height: 18px;
        accent-color: var(--color-link, var(--color-primary));
      }
      .maple-editor-surface .tiptap pre {
        font: 13px/1.6 var(--font-mono);
        padding: 18px;
        background: var(--color-bg-secondary);
        overflow: auto;
        border-radius: 6px;
      }
      .maple-editor-surface .tiptap table {
        border-collapse: collapse;
        width: 100%;
        font-size: 16px;
      }
      .maple-editor-surface .tiptap td,
      .maple-editor-surface .tiptap th {
        border: 1px solid var(--color-border);
        padding: 8px;
      }
      .maple-editor-surface .tiptap .is-editor-empty:before {
        content: attr(data-placeholder);
        float: left;
        color: var(--color-text-muted);
        pointer-events: none;
        height: 0;
      }
      .maple-editor-source {
        width: 100%;
        min-height: 600px;
        box-sizing: border-box;
        resize: vertical;
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-text-main);
        padding: 20px;
        font: 14px/1.7 var(--font-mono);
      }
      .maple-editor-surface a {
        color: var(--color-link, var(--color-primary));
      }
      @media (max-width: 700px) {
        .maple-editor-surface .tiptap {
          font-size: 17px;
          padding-left: 18px;
        }
        .maple-editor-surface .tiptap h2 {
          font-size: 25px;
        }
        .maple-editor-surface .tiptap h2:before {
          left: -27px;
        }
      }
    `,
  ],
})
export class MapleEditorComponent implements AfterViewInit, OnDestroy {
  readonly initial = input.required<string>();
  readonly readOnly = input(false);
  readonly showToolbar = input(true);
  readonly changed = output<string>();
  readonly inspected = output<string>();
  readonly submitted = output<{ blockID: string; text: string }>();
  readonly sourceRequested = output<void>();
  readonly insertionMenu = signal(false);
  readonly insertionIndex = signal(0);
  readonly insertionChoices = [
    "Heading",
    "Task",
    "Source reference",
    "Ask @maple",
  ];
  readonly source = signal(false);
  readonly notice = signal("");
  @ViewChild("surface", { static: true }) surface!: ElementRef<HTMLElement>;
  editor?: Editor;
  raw = "";
  private prefix = "";
  private app = inject(ApplicationRef);
  private injector = inject(EnvironmentInjector);
  private elementInjector = inject(Injector);
  constructor() {
    effect(() => {
      this.editor?.setEditable(!this.readOnly());
    });
  }
  ngAfterViewInit() {
    this.raw = this.initial();
    const parsed = decodeDaily(this.raw);
    this.prefix = parsed.prefix;
    this.source.set(parsed.sourceOnly);
    this.notice.set(parsed.reason);
    this.mount(parsed.doc);
  }
  private mount(doc: JSONContent) {
    this.editor?.destroy();
    const owner = this;
    const Reference = Node.create({
      name: "sourceReference",
      group: "block",
      atom: true,
      draggable: true,
      addAttributes() {
        return {
          reference: {
            default: null,
            parseHTML: (element) => {
              try {
                const value = JSON.parse(
                  element.getAttribute("data-maple-reference") ?? "null",
                );
                return value?.v === 1 &&
                  typeof value.eventID === "string" &&
                  typeof value.kind === "string"
                  ? value
                  : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs) => ({
              "data-maple-reference": JSON.stringify(attrs["reference"]),
            }),
          },
        };
      },
      parseHTML() {
        return [
          {
            tag: "maple-source-ref",
            getAttrs: (element) => {
              try {
                const value = JSON.parse(
                  element.getAttribute("data-maple-reference") ?? "null",
                );
                return value?.v === 1 &&
                  typeof value.eventID === "string" &&
                  typeof value.kind === "string"
                  ? null
                  : false;
              } catch {
                return false;
              }
            },
          },
        ];
      },
      renderHTML({ node, HTMLAttributes }) {
        return [
          "maple-source-ref",
          HTMLAttributes,
          (node.attrs["reference"] as SourceReference)?.label ??
            "Source reference",
        ];
      },
      addNodeView() {
        return ({ node }) => {
          const host = document.createElement("div");
          host.contentEditable = "false";
          const component = createComponent(SourceReferenceComponent, {
            environmentInjector: owner.injector,
            elementInjector: owner.elementInjector,
            hostElement: host,
          });
          component.setInput("reference", node.attrs["reference"]);
          owner.app.attachView(component.hostView);
          const subscription = component.instance.inspected.subscribe((id) =>
            owner.inspected.emit(id),
          );
          component.changeDetectorRef.detectChanges();
          return {
            dom: host,
            update(updated) {
              if (updated.type.name !== "sourceReference") return false;
              component.setInput("reference", updated.attrs["reference"]);
              return true;
            },
            stopEvent: (event) =>
              event.target instanceof HTMLElement &&
              !!event.target.closest("button"),
            ignoreMutation: () => true,
            destroy() {
              subscription.unsubscribe();
              owner.app.detachView(component.hostView);
              component.destroy();
            },
          };
        };
      },
    });
    const LinkedTask = Node.create({
      name: "linkedTask",
      group: "block",
      atom: true,
      draggable: true,
      addAttributes() {
        return {
          taskID: {
            default: "",
            parseHTML: (element) => element.getAttribute("data-task-id"),
            renderHTML: (attrs) => ({ "data-task-id": attrs["taskID"] }),
          },
          markdown: {
            default: "",
            parseHTML: (element) => element.getAttribute("data-task-markdown"),
            renderHTML: (attrs) => ({
              "data-task-markdown": attrs["markdown"],
            }),
          },
          label: {
            default: "",
            parseHTML: (element) => element.textContent,
            renderHTML: () => ({}),
          },
        };
      },
      parseHTML() {
        return [
          {
            tag: "maple-linked-task",
            getAttrs: (element) => {
              const id = element.getAttribute("data-task-id"),
                markdown = element.getAttribute("data-task-markdown");
              return id &&
                id.length <= 128 &&
                markdown &&
                markdown.length <= 8000 &&
                /^- \[[ xX]\] [^\n]+$/.test(markdown)
                ? null
                : false;
            },
          },
        ];
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["maple-linked-task", HTMLAttributes, node.attrs["label"]];
      },
      addNodeView() {
        return ({ node }) => {
          const host = document.createElement("div");
          host.contentEditable = "false";
          const component = createComponent(LinkedTaskComponent, {
            environmentInjector: owner.injector,
            elementInjector: owner.elementInjector,
            hostElement: host,
          });
          component.setInput("blockID", node.attrs["maple"]?.id);
          component.setInput("label", node.attrs["label"]);
          owner.app.attachView(component.hostView);
          component.changeDetectorRef.detectChanges();
          return {
            dom: host,
            update(updated) {
              if (updated.type.name !== "linkedTask") return false;
              component.setInput("blockID", updated.attrs["maple"]?.id);
              component.setInput("label", updated.attrs["label"]);
              return true;
            },
            stopEvent: (event) =>
              event.target instanceof HTMLElement &&
              !!event.target.closest("button"),
            ignoreMutation: () => true,
            destroy() {
              owner.app.detachView(component.hostView);
              component.destroy();
            },
          };
        };
      },
    });
    const MapleParagraph = Paragraph.extend({
      addNodeView() {
        return ({ node, getPos, editor }) => {
          let current = node;
          const dom = document.createElement("div"),
            contentDOM = document.createElement("p"),
            button = document.createElement("button");
          dom.className = "maple-paragraph";
          button.type = "button";
          button.className = "maple-run-button";
          button.contentEditable = "false";
          button.textContent = "Ask Maple ↵";
          dom.append(contentDOM, button);
          const refresh = () => {
            const meta = current.attrs["maple"] as BlockMetadata | undefined;
            const request = /^@maple\b/i.test(current.textContent);
            button.hidden = !request || owner.readOnly();
            dom.classList.toggle(
              "maple-request",
              request || meta?.kind === "maple-request",
            );
            dom.classList.toggle("maple-reply", meta?.kind === "maple-reply");
          };
          refresh();
          button.addEventListener("click", () => {
            const pos = getPos();
            if (pos === undefined) return;
            const text = current.textContent.replace(/^@maple\s*/i, "").trim();
            if (!text) return;
            const meta = {
              ...(current.attrs["maple"] ?? {}),
              v: 1,
              id: current.attrs["maple"]?.id ?? crypto.randomUUID(),
              kind: "maple-request",
              requestID:
                current.attrs["maple"]?.requestID ?? crypto.randomUUID(),
            };
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, {
                ...current.attrs,
                maple: meta,
              }),
            );
            owner.submitted.emit({ blockID: meta.id, text });
          });
          return {
            dom,
            contentDOM,
            update(updated) {
              if (updated.type.name !== "paragraph") return false;
              current = updated;
              refresh();
              return true;
            },
            stopEvent: (event) => event.target === button,
            ignoreMutation: (mutation) =>
              mutation.type !== "selection" &&
              !contentDOM.contains(mutation.target) &&
              mutation.target !== contentDOM,
          };
        };
      },
    });
    this.editor = new Editor({
      element: this.surface.nativeElement,
      editable: !this.readOnly(),
      extensions: [
        StarterKit.configure({
          paragraph: false,
          codeBlock: false,
          link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
        }),
        MapleParagraph,
        Placeholder.configure({
          placeholder:
            "A place to think, collect what matters, and keep things moving.",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockWithLanguage,
        ...getTableExtensions(),
        StableBlockIdentity,
        Reference,
        LinkedTask,
      ],
      content: this.source()
        ? { type: "doc", content: [{ type: "paragraph" }] }
        : doc,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": "Daily note editor",
          "aria-multiline": "true",
        },
        handleKeyDown: (_, event) => {
          if (this.insertionMenu()) {
            if (event.key === "Escape") {
              this.insertionMenu.set(false);
              return true;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              this.insertionIndex.update(
                (value) => (value + (event.key === "ArrowDown" ? 1 : 3)) % 4,
              );
              return true;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              this.chooseInsertion(this.insertionIndex());
              return true;
            }
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            const selected = this.editor?.state.selection.$from;
            if (selected) {
              for (let depth = selected.depth; depth > 0; depth--) {
                const node = selected.node(depth);
                if (
                  node.type.name === "paragraph" &&
                  /^@maple\b/i.test(node.textContent)
                ) {
                  event.preventDefault();
                  this.submitAt(selected.before(depth));
                  return true;
                }
              }
            }
          }
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      onUpdate: () => {
        const parent = this.editor!.state.selection.$from.parent;
        this.insertionMenu.set(
          parent.type.name === "paragraph" && parent.textContent === "/",
        );
        this.raw = encodeDaily(this.prefix, this.editor!.getJSON());
        this.changed.emit(this.raw);
      },
    });
  }
  submitAt(pos: number) {
    const editor = this.editor;
    if (!editor || this.readOnly()) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const text = node.textContent.replace(/^@maple\s*/i, "").trim();
    if (!text) return;
    const meta = {
      ...(node.attrs["maple"] ?? {}),
      v: 1,
      id: node.attrs["maple"]?.id ?? crypto.randomUUID(),
      kind: "maple-request",
      requestID: node.attrs["maple"]?.requestID ?? crypto.randomUUID(),
    };
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        maple: meta,
      }),
    );
    this.submitted.emit({ blockID: meta.id, text });
  }
  chooseInsertion(index: number) {
    const editor = this.editor;
    if (!editor) return;
    const selected = editor.state.selection.$from;
    if (selected.parent.textContent === "/")
      editor.commands.deleteRange({
        from: selected.start(),
        to: selected.end(),
      });
    this.insertionMenu.set(false);
    if (index === 0) editor.chain().focus().toggleHeading({ level: 2 }).run();
    else if (index === 1) editor.chain().focus().toggleTaskList().run();
    else if (index === 2) this.sourceRequested.emit();
    else this.addRequest();
  }
  sourceChanged(raw: string) {
    this.raw = raw;
    this.changed.emit(raw);
  }
  toggleSource() {
    if (this.source()) {
      const parsed = decodeDaily(this.raw);
      if (parsed.sourceOnly) {
        this.notice.set(parsed.reason + " Nothing has been removed.");
        return;
      }
      this.prefix = parsed.prefix;
      this.source.set(false);
      this.notice.set("");
      this.mount(parsed.doc);
    } else this.source.set(true);
  }
  addRequest() {
    this.editor
      ?.chain()
      .focus()
      .insertContent([
        { type: "paragraph", content: [{ type: "text", text: "@maple " }] },
      ])
      .run();
  }
  insertReference(reference: SourceReference) {
    if (this.source() || this.readOnly()) return false;
    return (
      this.editor
        ?.chain()
        .focus()
        .insertContent([
          { type: "sourceReference", attrs: { reference } },
          { type: "paragraph" },
        ])
        .run() ?? false
    );
  }
  ngOnDestroy() {
    this.editor?.destroy();
  }
}
