import {
  Node,
  Extension,
  mergeAttributes,
  markInputRule,
  wrappingInputRule,
} from "@tiptap/core";

export const SingleTildeStrike = Extension.create({
  name: "singleTildeStrike",
  addInputRules() {
    const type = this.editor.schema.marks["strike"];
    return type
      ? [
          markInputRule({
            find: /(?:^|\s)(~([^~\s](?:[^~\n]*[^~\s])?)~)$/,
            type,
          }),
        ]
      : [];
  },
});

export const MapleCallout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (element) =>
          ["info", "warning", "tip", "danger"].includes(
            element.getAttribute("data-kind") ?? "",
          )
            ? element.getAttribute("data-kind")
            : "info",
      },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-maple-callout]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        "data-maple-callout": "",
        "data-kind": node.attrs["kind"],
        class: "maple-callout",
      }),
      0,
    ];
  },
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^:::(info|warning|tip|danger)\s$/i,
        type: this.type,
        getAttributes: (match) => ({ kind: match[1].toLowerCase() }),
      }),
    ];
  },
});

export const MapleDetails = Node.create({
  name: "details",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      title: {
        default: "Details",
        parseHTML: (element) =>
          element.querySelector(":scope > summary")?.textContent ?? "Details",
      },
      open: {
        default: false,
        parseHTML: (element) => element.hasAttribute("open"),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "details",
        contentElement: (element) =>
          element.querySelector(":scope > [data-details-content]") ?? element,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { open, ...attrs } = HTMLAttributes;
    return [
      "details",
      mergeAttributes(attrs, {
        "data-maple-details": "",
        ...(node.attrs["open"] ? { open: "" } : {}),
      }),
      ["summary", {}, node.attrs["title"]],
      ["div", { "data-details-content": "" }, 0],
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement("section");
      dom.className = "maple-details";
      const header = document.createElement("div");
      header.contentEditable = "false";
      header.className = "maple-details-header";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.setAttribute("aria-label", "Toggle section");
      const title = document.createElement("input");
      title.type = "text";
      title.setAttribute("aria-label", "Section title");
      const contentDOM = document.createElement("div");
      contentDOM.className = "maple-details-content";
      const sync = () => {
        title.value = current.attrs["title"];
        title.readOnly = !editor.isEditable;
        toggle.textContent = current.attrs["open"] ? "▾" : "▸";
        toggle.setAttribute("aria-expanded", String(!!current.attrs["open"]));
        contentDOM.hidden = !current.attrs["open"];
      };
      const update = (attrs: Record<string, unknown>) => {
        const pos = getPos();
        if (editor.isEditable && typeof pos === "number")
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...current.attrs,
              ...attrs,
            }),
          );
      };
      toggle.onclick = () => {
        if (editor.isEditable) update({ open: !current.attrs["open"] });
        else {
          contentDOM.hidden = !contentDOM.hidden;
          toggle.textContent = contentDOM.hidden ? "▸" : "▾";
          toggle.setAttribute("aria-expanded", String(!contentDOM.hidden));
        }
      };
      title.onchange = () => update({ title: title.value });
      header.append(toggle, title);
      dom.append(header, contentDOM);
      sync();
      return {
        dom,
        contentDOM,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          sync();
          return true;
        },
        stopEvent: (event) => header.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation) =>
          mutation.type !== "selection" &&
          !contentDOM.contains(mutation.target),
      };
    };
  },
});
