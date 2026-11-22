/**
 * Who the "Built on" mark is drawn for on a project's public pages (the project page, its booking pages): a signed-out
 * visitor gets the quiet link, a signed-in Foundmill member plain words, a paid plan nothing. The link leads to the
 * project's story when it has one, else the landing page, with the page named as where the visitor came from.
 */
import type { ProjectPageMark } from "@foundmill/dugout";
import { storyPath } from "@foundmill/shared/project-story";
import { withVia } from "@foundmill/shared/via";
import { getServerAuth } from "@/lib/auth/server";

export async function pageMarkFor(page: { slug: string; story: boolean }, shown: boolean): Promise<{ mark: ProjectPageMark; markHref: string }> {
  // A session that cannot be read counts as a visitor.
  const member = shown ? (await getServerAuth().catch(() => null)) !== null : false;
  return { mark: !shown ? "none" : member ? "member" : "visitor", markHref: withVia(page.story ? storyPath(page.slug) : "/", { kind: "project_page", ref: page.slug }) };
}
