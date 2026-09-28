export function splitMarkdown(raw: string) {
  const match = raw.match(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n/,
  );
  return { prefix: match?.[0] ?? "", body: raw.slice(match?.[0].length ?? 0) };
}
export function requiresSource(raw: string) {
  // Preserve formats outside the extracted standard-Markdown schema verbatim.
  return /<\/?[a-z!]|!\[|\[\[|```maple:|\{(?:id|priority|due|color)[:=]|^\[\^[^\]]+\]:|^\$\$/im.test(
    splitMarkdown(raw).body,
  );
}
