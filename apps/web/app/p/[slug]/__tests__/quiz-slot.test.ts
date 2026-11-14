// @vitest-environment node
/**
 * Where the page quiz (0105) may appear: only on the project's own public page, `/p/<slug>`, and only from the api's
 * live quiz read (which lists nothing for a sample business, a page that is not public, or a quiz turned off). The
 * story page and a milestone card never read it or draw it (the network session, Nov 13, 2026).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(app, p), "utf8");

describe("the quiz slot", () => {
  it("the public page draws the quiz only from the live quiz read, before the Follow form", () => {
    const page = read("p/[slug]/page.tsx");
    expect(page).toMatch(/publicPageQuiz\(slug\)/);
    expect(page).toMatch(/quiz=\{quiz \? <PageQuizForm/);
  });

  it("the story page, a milestone card and their share images never read or draw a quiz", () => {
    for (const file of ["p/[slug]/story/page.tsx", "m/[id]/page.tsx", "m/[id]/opengraph-image.tsx", "p/[slug]/opengraph-image.tsx", "m/[id]/story-image/route.tsx"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/publicPageQuiz|PageQuizForm|ProjectQuiz|publicQuiz/);
    }
  });
});
