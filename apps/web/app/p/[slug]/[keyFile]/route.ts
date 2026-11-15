/**
 * The IndexNow key file of a project's public page (founder, 2026-11-12): `/p/<slug>/<key>.txt`.
 *
 * IndexNow lets a site tell search engines that an address changed, and proves the sender owns the site by a text file
 * on it that holds the key. When a project's founders connect IndexNow for their Foundmill-hosted page (Settings ›
 * Integrations, with their own key), this route serves that key, and only that key, as plain text. Every other request
 * under a page's address is the same not-found as an unknown page: another key, a page that is not public, a project
 * that never connected IndexNow. Signed out like the page itself (`/p/` is public in lib/auth/redirects.ts), read on
 * every request so a disconnected key is gone at once, and never indexed.
 */
import { keyFromKeyFileName } from "@foundmill/shared/indexnow";
import { publicIndexNowKeyFile } from "@/lib/public-page.server";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; keyFile: string }> }): Promise<Response> {
  const { slug, keyFile } = await params;
  const key = keyFromKeyFileName(keyFile);
  if (!key) return notFound();
  let served: string | null;
  try {
    served = await publicIndexNowKeyFile(slug, key);
  } catch {
    // The api refused or could not be reached: a key file that cannot be confirmed is not served.
    return new Response("Try again later\n", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60" } });
  }
  if (served === null) return notFound();
  return new Response(served, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "x-content-type-options": "nosniff" } });
}
