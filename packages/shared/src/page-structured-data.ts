/**
 * Structured data (JSON-LD) for a project's public page and its story (WP-08 T7; audit s3 §3.1). Only facts the page
 * shows: absolute URLs, ISO 8601 dates, no ratings, reviews, offers or FAQ markup. `Project` while the stage is an idea
 * or being built, `Organization` once it is live (a project until its first sale, a business after; `Project` is a
 * subtype of `Organization`). Founders appear only when the page names them. Rendered by apps/web `JsonLd`, which
 * escapes "<" so founder text can never close the script element.
 */
import { pageDescription, pageTitle, type PageStage } from "./project-page";

/** What the markup is built from: the public view's fields (apps/api `PublicPageView`). */
export interface StructuredPageInput {
  url: string;
  name: string;
  pitch: string;
  about: string;
  stage: PageStage;
  publishedAt: Date | string;
  updatedAt: Date | string;
  founderNames: readonly string[];
}

const iso = (d: Date | string): string => (d instanceof Date ? d : new Date(d)).toISOString();
const absolute = (origin: string, path = "/"): string => new URL(path, origin).toString();

export function projectPageJsonLd(view: StructuredPageInput, opts: { origin: string; appName: string }): Record<string, unknown> {
  const pageId = `${view.url}#page`;
  const projectId = `${view.url}#project`;
  const home = absolute(opts.origin);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": pageId,
        url: view.url,
        name: pageTitle(view.name, view.pitch),
        description: pageDescription(view.about, view.pitch),
        inLanguage: "en-US",
        dateCreated: iso(view.publishedAt),
        dateModified: iso(view.updatedAt),
        mainEntity: { "@id": projectId },
      },
      {
        "@type": view.stage === "live" ? "Organization" : "Project",
        "@id": projectId,
        name: view.name,
        description: view.pitch,
        url: view.url,
        image: `${view.url}/opengraph-image`,
        ...(view.founderNames.length ? { founder: view.founderNames.map((name) => ({ "@type": "Person", name })) } : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: opts.appName, item: home },
          { "@type": "ListItem", position: 2, name: view.name, item: view.url },
        ],
      },
    ],
  };
}

/** The story page: a `WebPage` about the project, modified when its newest shown milestone happened. */
export function storyJsonLd(input: { url: string; storyUrl: string; name: string; description: string }, milestones: readonly { achievedAt: Date | string }[]): Record<string, unknown> {
  const newest = milestones.reduce<string | null>((max, m) => {
    const at = iso(m.achievedAt);
    return !max || at > max ? at : max;
  }, null);
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${input.storyUrl}#page`,
    url: input.storyUrl,
    name: input.name,
    description: input.description,
    inLanguage: "en-US",
    about: { "@id": `${input.url}#project` },
    ...(newest ? { dateModified: newest } : {}),
  };
}

/** The script body: JSON with every "<" escaped, so text inside can never end the element. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
