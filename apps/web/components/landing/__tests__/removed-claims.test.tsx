// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "../LandingPage";
import { type LandingSwitches } from "../flags";
import { LANDING_WORDS, REMOVED_CLAIMS } from "../words";
import { IDEA_BOX_WORDS } from "../idea-box/IdeaBox";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 }))));
afterEach(() => vi.unstubAllGlobals());

const COMBOS: LandingSwitches[] = [false, true].flatMap((signupOpen) => [false, true].flatMap((peopleOpen) => [false, true].map((platformMail) => ({ signupOpen, peopleOpen, platformMail }))));

describe("removed claims never return to / (DIRECTION §4)", () => {
  it.each(COMBOS)("none appears with %o", (switches) => {
    render(<LandingPage switches={switches} renderDay="2026-11-15" />);
    const shown = document.body.textContent ?? "";
    for (const claim of REMOVED_CLAIMS) expect(shown, claim).not.toContain(claim);
  });

  it("none hides in the words files either (the keep panel and every switch's lines)", () => {
    const all = JSON.stringify(LANDING_WORDS) + JSON.stringify(IDEA_BOX_WORDS);
    for (const claim of REMOVED_CLAIMS) expect(all, claim).not.toContain(claim);
  });
});
