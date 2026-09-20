export function replaceMaterialMentionQueryAtCursor(
  text: string,
  anchor: number,
  cursor: number,
  slug: string,
): { value: string; cursor: number } | null {
  const safeCursor = Math.min(Math.max(cursor, 0), text.length);
  if (anchor < 0 || anchor >= safeCursor || text[anchor] !== '@') return null;

  const query = text.slice(anchor + 1, safeCursor);
  if (/\s|\[|\]|@/.test(query)) return null;

  const before = text.slice(0, anchor);
  const after = text.slice(safeCursor);
  const token = `[${slug}]`;
  const spacer = after.startsWith(' ') || after.startsWith('\n') ? '' : ' ';
  return {
    value: `${before}${token}${spacer}${after}`,
    cursor: before.length + token.length + (spacer ? 1 : 0),
  };
}
