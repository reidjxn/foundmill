/**
 * The IndexNow key file of a project's public page (founder, 2026-11-12): `/p/<slug>/<key>.txt`.
 *
 * IndexNow lets a site tell search engines that an address changed, and proves the sender owns the site by a text file
 * on it that holds the key. When a project's founders connect IndexNow for their Foundmill-hosted page (Settings ›
 * Integrations, with their own key), this route serves that key, and only that key, as plain text. Every other request
 * under a page's address is the same not-found as an unknown page: another key, a page that is not public, a project
 * that never connected IndexNow. Signed out like the page itself (`/p/` is public in lib/auth/redirects.ts), read on
 * every request so a disconnected key is gone at once, and never indexed.
 *
 * Two fixed names come first (WP-08 T7; audit s3 §5.3): `index.md` and `llms.txt` answer the page as Markdown for AI
 * readers (`projectPageMarkdown`: only what the page and its story already show), never indexed, with the page as
 * canonical. A page that is not public is the same not-found.
 */
import { APP_NAME } from "@foundmill/config";
import { keyFromKeyFileName } from "@foundmill/shared/indexnow";
import { projectPageMarkdown } from "@foundmill/shared/page-markdown";
import { publicIndexNowKeyFile, publicProjectPage, publicProjectStory } from "@/lib/public-page.server";

/** The page as Markdown at these two addresses under `/p/<slug>/`. */
const MARKDOWN_FILES = ["index.md", "llms.txt"] as const;

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; keyFile: string }> }): Promise<Response> {
  const { slug, keyFile } = await params;
  if ((MARKDOWN_FILES as readonly string[]).includes(keyFile)) return markdown(slug);
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

const tryLater = () => new Response("Try again later\n", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "60" } });

async function markdown(slug: string): Promise<Response> {
  let page: Awaited<ReturnType<typeof publicProjectPage>>;
  try {
    page = await publicProjectPage(slug);
  } catch {
    return tryLater();
  }
  if (!page) return notFound();
  // The story is optional: without it (or when its read fails) the Markdown has no milestones.
  const story = page.story ? await publicProjectStory(page.slug).catch(() => null) : null;
  const body = projectPageMarkdown(page, story?.milestones ?? [], { appName: APP_NAME });
  return new Response(body, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "x-content-type-options": "nosniff", link: `<${page.url}>; rel="canonical"` } });
}
