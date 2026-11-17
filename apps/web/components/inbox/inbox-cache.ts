/**
 * Optimistic edits of the Inbox list held in the query cache (WP-10 T12, audit A2-27): marking a note read and
 * archiving it change the row at once; the caller snapshots the cache first and puts it back if the call fails.
 * The cache holds `inbox.list` both as one page (the shell's prefetch) and as infinite pages (the Inbox list).
 */
type Row = { id: string; state?: string };
type Page = { items: Row[] };
type Infinite = { pages: Page[] };

function isPage(d: unknown): d is Page {
  return !!d && typeof d === "object" && Array.isArray((d as Page).items);
}
function isInfinite(d: unknown): d is Infinite {
  return !!d && typeof d === "object" && Array.isArray((d as Infinite).pages);
}

/** Applies `fn` to every page's items, in either shape; anything else is returned untouched. */
export function patchInboxList<T>(data: T, fn: (items: Row[]) => Row[]): T {
  if (isInfinite(data)) return { ...data, pages: data.pages.map((p) => (isPage(p) ? { ...p, items: fn(p.items) } : p)) } as T;
  if (isPage(data)) return { ...data, items: fn(data.items) } as T;
  return data;
}

export const markRowRead = (itemId: string) => (items: Row[]) => items.map((r) => (r.id === itemId && r.state === "unread" ? { ...r, state: "read" } : r));
export const removeRow = (itemId: string) => (items: Row[]) => items.filter((r) => r.id !== itemId);
