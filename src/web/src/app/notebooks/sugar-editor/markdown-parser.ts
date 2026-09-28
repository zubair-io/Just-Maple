import MarkdownIt from "markdown-it";

/** Shared, deliberately small dialect; container attributes are data, never HTML. */
export function createMarkdownParser(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: false });
  md.block.ruler.before(
    "fence",
    "maple_structured",
    (state, start, end, silent) => {
      const line = state.src.slice(
        state.bMarks[start] + state.tShift[start],
        state.eMarks[start],
      );
      const match = /^(:{3,})(callout|details)\s+(.+)$/.exec(line);
      if (!match) return false;
      let attrs: Record<string, unknown>;
      if (match[2] === "callout") {
        if (!["info", "warning", "tip", "danger"].includes(match[3]))
          throw Error("Unsupported callout kind");
        attrs = { kind: match[3] };
      } else {
        attrs = JSON.parse(match[3]);
        if (
          !attrs ||
          typeof attrs["title"] !== "string" ||
          typeof attrs["open"] !== "boolean" ||
          Object.keys(attrs).some((k) => !["title", "open"].includes(k))
        )
          throw Error("Unsupported collapsible section");
      }
      let close = start + 1;
      let codeFence = "";
      for (; close < end; close++) {
        const current = state.src.slice(
          state.bMarks[close] + state.tShift[close],
          state.eMarks[close],
        );
        const fence = /^(`{3,}|~{3,})/.exec(current);
        if (fence) {
          if (!codeFence) codeFence = fence[1];
          else if (
            fence[1][0] === codeFence[0] &&
            fence[1].length >= codeFence.length &&
            current.trim() === fence[1]
          )
            codeFence = "";
        }
        if (!codeFence && current === match[1]) break;
      }
      if (close === end) throw Error("Unclosed structured section");
      if (silent) return true;
      const token = state.push("maple_structured", "", 0);
      token.map = [start, close + 1];
      token.block = true;
      token.meta = { type: match[2], attrs };
      token.content = state.getLines(start + 1, close, state.blkIndent, false);
      state.line = close + 1;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  md.inline.ruler.before("strikethrough", "single_tilde", (state, silent) => {
    const start = state.pos;
    if (
      state.src[start] !== "~" ||
      state.src[start + 1] === "~" ||
      state.src[start - 1] === "~" ||
      /\s/.test(state.src[start + 1] ?? " ")
    )
      return false;
    let end = start + 1;
    for (; end < state.posMax; end++) {
      if (state.src[end] === "\\") {
        end++;
        continue;
      }
      if (state.src[end] === "\n") return false;
      if (state.src[end] === "~") break;
    }
    if (
      end >= state.posMax ||
      state.src[end + 1] === "~" ||
      /\s/.test(state.src[end - 1])
    )
      return false;
    if (!silent) {
      state.push("s_open", "s", 1);
      const inner: typeof state.tokens = [];
      state.md.inline.parse(
        state.src.slice(start + 1, end),
        state.md,
        state.env,
        inner,
      );
      state.tokens.push(...inner);
      state.push("s_close", "s", -1);
    }
    state.pos = end + 1;
    return true;
  });
  return md;
}
