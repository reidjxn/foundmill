/**
 * The registry of example businesses on the landing page. Tutorlane is the default and ships in the page's main bundle;
 * every other business is its own chunk, loaded on demand (and prefetched when the visitor points at or focuses its
 * picker option, and on idle after first paint). A deep link (`/?example=glitchwick`) is served from that business's
 * own prerendered page (proxy.ts rewrites it to app/examples/[id]), which passes the loaded business to the page as a
 * prop, so the first paint and hydration agree.
 *
 * Adding a business: add its id to `EXAMPLE_IDS` (./types.ts), its identity to `EXAMPLE_IDENTITIES` (./identity.ts) with a
 * logo mark in ../logos.ts, write `./<id>.ts` exporting an `ExampleBusiness` (copy ./glitchwick.ts), and add its loader
 * below. The registry test checks every business against every section's needs.
 */
import { EXAMPLE_IDENTITIES } from "./identity";
import { DEFAULT_EXAMPLE_ID, EXAMPLE_PARAM } from "./ids";
import { TUTORLANE } from "./tutorlane";
import { EXAMPLE_IDS, type ExampleBusiness, type ExampleId } from "./types";

export { EXAMPLE_IDENTITIES } from "./identity";
export { DEFAULT_EXAMPLE_ID, EXAMPLE_PARAM, examplePath, exampleRoute, isExampleId, parseExampleId } from "./ids";
export { EXAMPLE_IDS, type ExampleBusiness, type ExampleId, type ExampleIdentity } from "./types";

/** The default business, always loaded. */
export const DEFAULT_EXAMPLE: ExampleBusiness = TUTORLANE;

const LOADERS: Readonly<Record<ExampleId, () => Promise<ExampleBusiness>>> = {
  tutorlane: () => Promise.resolve(TUTORLANE),
  glitchwick: () => import("./glitchwick").then((m) => m.GLITCHWICK),
  northwind: () => import("./northwind").then((m) => m.NORTHWIND),
};

/** The URL of the landing page showing a business: the default has none of its own, so it stays "/". */
export function exampleSearch(id: ExampleId, current = ""): string {
  const params = new URLSearchParams(current);
  if (id === DEFAULT_EXAMPLE_ID) params.delete(EXAMPLE_PARAM);
  else params.set(EXAMPLE_PARAM, id);
  const query = params.toString();
  return query ? `?${query}` : "";
}

const loaded = new Map<ExampleId, ExampleBusiness>([[TUTORLANE.identity.id, TUTORLANE]]);
const loading = new Map<ExampleId, Promise<ExampleBusiness>>();

/** The business if it is already loaded, else undefined (never starts a load). */
export function peekExample(id: ExampleId): ExampleBusiness | undefined {
  return loaded.get(id);
}

/** Loads a business once; concurrent and later calls share the result. A failed load can be retried. */
export function loadExample(id: ExampleId): Promise<ExampleBusiness> {
  const ready = loaded.get(id);
  if (ready) return Promise.resolve(ready);
  let pending = loading.get(id);
  if (!pending) {
    pending = LOADERS[id]().then(
      (business) => {
        loaded.set(id, business);
        loading.delete(id);
        return business;
      },
      (err: unknown) => {
        loading.delete(id);
        throw err;
      },
    );
    loading.set(id, pending);
  }
  return pending;
}

/** Starts loading a business in the background; errors are left for the visitor's own selection to surface. */
export function prefetchExample(id: ExampleId): void {
  if (loaded.has(id) || loading.has(id)) return;
  loadExample(id).catch(() => {});
}

/** Records a business that arrived another way (the server's deep-linked prop), so selecting it again needs no load. */
export function rememberExample(business: ExampleBusiness): void {
  if (!loaded.has(business.identity.id)) loaded.set(business.identity.id, business);
}

/** Every business's identity, in picker order. */
export function exampleIdentities() {
  return EXAMPLE_IDS.map((id) => EXAMPLE_IDENTITIES[id]);
}

/** Forgets every business but the default (tests only: each test starts from a cold cache). */
export function resetExampleCache(): void {
  for (const id of [...loaded.keys()]) if (id !== DEFAULT_EXAMPLE_ID) loaded.delete(id);
  loading.clear();
}
