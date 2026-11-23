/**
 * Mock web search (route `webSearch`, WP-09 T3): three deterministic results per query, every address on example.com and
 * every title marked "mock", so nothing reads as a real search result.
 */
import { z } from "zod";
import type { MockContext } from "./inputs";

export const WebSearchOutput = z.object({ results: z.array(z.object({ url: z.string(), title: z.string(), pageAge: z.string().nullable(), snippet: z.string().nullable() })) });
export type WebSearchOutput = z.infer<typeof WebSearchOutput>;

/** The results a mock search returns for `query`. */
export function mockSearchResults(query: string, limit: number): WebSearchOutput["results"] {
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "results";
  return Array.from({ length: Math.max(0, Math.min(limit, 3)) }, (_, i) => ({ url: `https://example.com/${slug}/${i + 1}`, title: `${query} (result ${i + 1}, mock)`, pageAge: null, snippet: `A page about ${query} (mock).` }));
}

/** `complete()` on the route: the query is the text after "Search the web for:", or the whole message. */
export function generateWebSearch(ctx: MockContext): WebSearchOutput {
  const query = /Search the web for:\s*(.+)/.exec(ctx.lastUser)?.[1]?.trim() ?? ctx.lastUser.trim();
  return { results: mockSearchResults(query, 3) };
}
