/**
 * Patterns shared by the tests that hold agents to the tools that exist (founder, Nov 11, 2026): the templates
 * (`tools-that-exist.test.ts`) and the library skills (`skill-library.test.ts`).
 */

/** A vendor whose connector is not built: no instruction or skill sends an agent to it. */
export const UNBUILT_VENDOR = /\b(Browserbase|Search Console|DataForSEO|Lighthouse|Spotify Ad Studio)\b/;
