import { request } from "@playwright/test";
import { API_URL } from "./helpers";

/**
 * The tour and callout ids the guided layer can show (the first-visit tour cards and the one-step callouts, UX plan
 * §6–§7). The dev founder is shared by every spec, so these are marked done once before the run: each spec starts as a
 * returning founder and a card never covers the control the spec is about. tours.spec.ts still resets and restores
 * them for its own assertions, and first-days.spec.ts reads whatever state it finds. Builder view starts off, as a new
 * founder has it: specs that read the engine (cycle numbers, the Code tab, ratings out of 20) turn it on in beforeAll
 * with `setBuilderView` and restore it in afterAll. The single-key shortcuts start on (a new founder has them off, WP-04
 * T13) because many specs drive the screens by key: keyboard-a11y.spec.ts turns them off with `setKeyboardShortcuts`
 * for its own checks and restores them.
 */
const TOUR_IDS = ["home", "inbox", "department", "today", "first-continue", "first-decision", "example-start", "start-your-own", "continue"];

export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: API_URL, extraHTTPHeaders: { authorization: "Bearer dev" } });
  try {
    const toursDone = Object.fromEntries(TOUR_IDS.map((id) => [id, true]));
    const res = await api.post("/trpc/founder.preferences.update", { data: { json: { guidance: "on", toursDone, builderView: false, keyboardShortcuts: true } } });
    if (!res.ok()) throw new Error(`could not mark the dev founder's tours done: ${res.status()} ${await res.text()}`);
  } finally {
    await api.dispose();
  }
}
