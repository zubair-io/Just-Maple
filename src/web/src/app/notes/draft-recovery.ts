/** Conservative three-way recovery. Overlapping edits are preserved in a separate
 * recovery file rather than guessed, including changes to Markdown identities. */
export function mergeRecoveredWriting(base: string, current: string, draft: string): string | null {
  if (current === base || current === draft) return draft;
  if (draft === base) return current;
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const original = lines(base);
  const change = (text: string) => {
    const next = lines(text); let start = 0, end = original.length, tail = next.length;
    while (start < end && start < tail && original[start] === next[start]) start++;
    while (end > start && tail > start && original[end - 1] === next[tail - 1]) { end--; tail--; }
    return { start, end, replacement: next.slice(start, tail) };
  };
  const a = change(current), b = change(draft);
  if (a.end >= b.start && b.end >= a.start) return null;
  const result = [...original];
  for (const edit of [a, b].sort((x, y) => y.start - x.start)) result.splice(edit.start, edit.end - edit.start, ...edit.replacement);
  return result.join('');
}
