/**
 * The example businesses' ids and the deep link that names one (`/?example=northwind`), without their content: the
 * proxy reads these to send a deep link to that business's prerendered page (app/examples/[id]/page.tsx), and must
 * not load the businesses themselves. Re-exported by ./index.ts.
 */
import { EXAMPLE_IDS, type ExampleId } from "./types";

export const DEFAULT_EXAMPLE_ID: ExampleId = "tutorlane";
/** The query parameter of a deep link: `/?example=northwind`. */
export const EXAMPLE_PARAM = "example";

export function isExampleId(value: unknown): value is ExampleId {
  return typeof value === "string" && (EXAMPLE_IDS as readonly string[]).includes(value);
}

/** The business a query value names (the first, when repeated), or the default for anything else. */
export function parseExampleId(value: string | readonly string[] | null | undefined): ExampleId {
  const first = Array.isArray(value) ? value[0] : value;
  const id = typeof first === "string" ? first.trim().toLowerCase() : "";
  return isExampleId(id) ? id : DEFAULT_EXAMPLE_ID;
}

/** The prerendered landing page of each business but the default (which is `/` itself). */
export function examplePath(id: ExampleId): string {
  return `/examples/${id}`;
}

/** Where a signed-out `/` with this query is served from: a business's own page for a deep link to it, else null (`/`). */
export function exampleRoute(search: string): string | null {
  const id = parseExampleId(new URLSearchParams(search).get(EXAMPLE_PARAM));
  return id === DEFAULT_EXAMPLE_ID ? null : examplePath(id);
}
