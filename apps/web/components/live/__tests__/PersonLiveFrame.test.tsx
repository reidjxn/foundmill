// @vitest-environment happy-dom
/** The people pages' frame for a person with no project (THESIS_REVIEW 2.4). */
import { cleanup, render, screen } from "@testing-library/react";
import type * as Dugout from "@foundmill/dugout";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/communities/abc", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/shell/SignOutButton", () => ({ SignOutButton: () => <button type="button">Sign out</button> }));
vi.mock("@foundmill/dugout", async (orig) => ({ ...(await orig<typeof Dugout>()), useViewportWidth: () => 1440 }));

import { useShellChrome } from "@/components/shell/chrome";
import { PersonLiveFrame } from "../PersonLiveFrame";

function Screen() {
  useShellChrome({ title: "Communities" });
  return <p>screen body</p>;
}

afterEach(cleanup);

describe("PersonLiveFrame", () => {
  it("shows the screen's own title, a way back to Home, and Network beside Communities", () => {
    render(
      <PersonLiveFrame viewer={{ email: "robin@example.com" }}>
        <Screen />
      </PersonLiveFrame>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Communities");
    expect(screen.getByText("screen body")).toBeTruthy();
    expect(screen.getByTestId("person-live-home").getAttribute("href")).toBe("/home");
    expect(screen.getByRole("link", { name: "Network" }).getAttribute("href")).toBe("/network");
    expect(screen.getByRole("link", { name: "Communities" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Network" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByTestId("business-shell")).toBeNull();
  });
});
