/**
 * The native app's store links (CLAUDE.md "Never", small screens): one value, `NEXT_PUBLIC_STORE_LINKS`, unset until
 * the app launches. It holds the App Store and Google Play addresses separated by a comma, in either order. Every
 * "Get the app" prompt reads this one value, so turning the prompt on (or off) everywhere is one change.
 */

export interface StoreLinks {
  /** The App Store address (`https://apps.apple.com/…`), or null when only the Android link is set. */
  ios: string | null;
  /** The Google Play address (`https://play.google.com/…`), or null when only the iPhone link is set. */
  android: string | null;
}

const STORE_HOSTS = { ios: "apps.apple.com", android: "play.google.com" } as const;

function storeOf(raw: string): keyof typeof STORE_HOSTS | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname.length <= 1) return null;
  if (url.hostname === STORE_HOSTS.ios) return "ios";
  if (url.hostname === STORE_HOSTS.android) return "android";
  return null;
}

/**
 * Reads the one value. Null when it is unset or empty, or when any part is not an App Store or Google Play address
 * (a wrong value shows nothing rather than a link to somewhere else). At most one link per store.
 */
export function parseStoreLinks(raw: string | undefined | null): StoreLinks | null {
  const parts = (raw ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  const links: StoreLinks = { ios: null, android: null };
  for (const part of parts) {
    const store = storeOf(part);
    if (!store || links[store]) return null;
    links[store] = part;
  }
  return links;
}
