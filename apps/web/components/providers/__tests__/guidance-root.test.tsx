// @vitest-environment happy-dom
/**
 * GuidanceRoot (AppProviders): the signed-out defaults. It asks the API nothing, and the definitions map reaches a
 * signed-out page only after hydration, in its own chunk (perf audit items 2 and 9); a signed-in page's layout mounts
 * its own GuidanceHost with the map, so nothing is loaded here.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Term, useGuidance, useLearnHref } from "@foundmill/dugout";

let pathname: string | null = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { useGuidancePreferences } from "../guidance-context";
import { GuidanceRoot } from "../GuidanceRoot";

let prefs: ReturnType<typeof useGuidancePreferences> | null = null;
let guidance: ReturnType<typeof useGuidance> | null = null;
let learnSlug: string | undefined = "?";
let learnUrl: string | undefined = "?";

function Probe() {
  prefs = useGuidancePreferences();
  guidance = useGuidance();
  learnSlug = useLearnHref("finance/runway");
  learnUrl = useLearnHref("https://example.com/help");
  return <Term id="runway">runway</Term>;
}

beforeEach(() => {
  prefs = null;
  guidance = null;
});

describe("GuidanceRoot", () => {
  it("on a signed-out page: plain text first, then the defined word once the map has loaded; nothing can be saved", async () => {
    pathname = "/";
    render(
      <GuidanceRoot>
        <Probe />
      </GuidanceRoot>,
    );
    expect(guidance?.guidance).toBe("on");
    expect(guidance?.loaded).toBe(true);
    expect(prefs?.signedIn).toBe(false);
    await expect(prefs!.save({ guidance: "off" })).rejects.toThrow(/Sign in/);
    await waitFor(() => expect(document.querySelector('[data-term="runway"]')).not.toBeNull());
    expect(guidance?.terms.runway?.word).toBe("Runway");
    expect(screen.getByRole("button", { name: "runway" })).toBeTruthy();
    // Outside a business only absolute URLs open.
    expect(learnSlug).toBeUndefined();
    expect(learnUrl).toBe("https://example.com/help");
  });

  it("on a signed-in page: loads nothing (the layout's host carries the map)", async () => {
    pathname = "/businesses";
    render(
      <GuidanceRoot>
        <Probe />
      </GuidanceRoot>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(guidance?.terms).toEqual({});
    expect(document.querySelector('[data-term="runway"]')).toBeNull();
    expect(screen.getByText("runway")).toBeTruthy();
  });
});
