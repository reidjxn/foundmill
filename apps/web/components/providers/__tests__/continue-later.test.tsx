// @vitest-environment happy-dom
/**
 * The wall has exits (WP-03 T3): a desktop-only page at 390 px shows the note with "Email me a link" (or Copy link)
 * and one way back; "Sent" only when the email went; Get the app only while the store links are set (WP-03 T9).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ID = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
let pathname = `/b/${ID}/crm`;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const sendLink = vi.fn();
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({ founder: { email: { sendLink: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationKey: [["founder", "email", "sendLink"]], mutationFn: (input: unknown) => sendLink(input), ...opts }) } } } }),
}));
let storeLinks: { ios: string | null; android: string | null } | null = null;
vi.mock("@/lib/env", () => ({ publicEnv: () => ({ storeLinks }) }));

import { DesktopOnly } from "../DesktopOnly";
import { CONTINUE_LATER_WORDS, wayBack } from "../ContinueLater";

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function renderAt(path: string) {
  pathname = path;
  setWidth(390);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DesktopOnly>
        <p>Console</p>
      </DesktopOnly>
    </QueryClientProvider>,
  );
}

describe("the small-screen note's exits (WP-03 T3)", () => {
  const original = window.innerWidth;
  afterEach(() => {
    setWidth(original);
    sendLink.mockReset();
    storeLinks = null;
  });

  it("a walled route at 390 px shows two controls: Email me a link and Back to Today, which goes to the project's Today", () => {
    renderAt(`/b/${ID}/crm`);
    expect(screen.queryByText("Console")).toBeNull();
    const note = screen.getByTestId("needs-larger-window");
    expect(note.querySelectorAll("button, a")).toHaveLength(2);
    expect(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.email })).toBeTruthy();
    expect(screen.getByRole("link", { name: CONTINUE_LATER_WORDS.backToToday }).getAttribute("href")).toBe(`/b/${ID}/today`);
    for (const el of note.querySelectorAll("button, a")) expect(el.className).toContain("min-h-tap");
  });

  it("says Sent only when it went, with the address", async () => {
    sendLink.mockResolvedValue({ sent: true, reason: null, email: "maya@example.com" });
    renderAt(`/b/${ID}/crm`);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.email }));
    await waitFor(() => expect(screen.getByTestId("continue-later-sent").textContent).toBe("Sent. Check maya@example.com."));
    expect(sendLink).toHaveBeenCalledWith({ path: `/b/${ID}/crm` });
    expect(screen.queryByRole("button", { name: CONTINUE_LATER_WORDS.copy })).toBeNull();
  });

  it("when it was not sent (mail off, simulated, an error) it says so and offers Copy link, which copies this page", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    sendLink.mockResolvedValue({ sent: false, reason: "off", email: null });
    renderAt(`/b/${ID}/crm`);
    fireEvent.click(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.email }));
    await waitFor(() => expect(screen.getByTestId("continue-later-not-sent").textContent).toBe(CONTINUE_LATER_WORDS.notSent));
    expect(screen.queryByText(/^Sent/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.copy }));
    await waitFor(() => expect(screen.getByText(CONTINUE_LATER_WORDS.copied)).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/b/${ID}/crm`);
  });

  it("a simulated send is named as simulated, never as sent", async () => {
    sendLink.mockResolvedValue({ sent: false, reason: "simulated", email: null });
    renderAt("/new/ideate");
    fireEvent.click(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.email }));
    await waitFor(() => expect(screen.getByTestId("continue-later-not-sent").textContent).toBe(CONTINUE_LATER_WORDS.simulated));
    expect(screen.getByRole("link", { name: CONTINUE_LATER_WORDS.home }).getAttribute("href")).toBe("/home");
  });

  it("a page no email can carry offers Copy link; a signed-out page goes back to the landing page", () => {
    renderAt("/tour");
    expect(screen.queryByRole("button", { name: CONTINUE_LATER_WORDS.email })).toBeNull();
    expect(screen.getByRole("button", { name: CONTINUE_LATER_WORDS.copy })).toBeTruthy();
    expect(screen.getByRole("link", { name: CONTINUE_LATER_WORDS.landing }).getAttribute("href")).toBe("/");
    expect(wayBack("/businesses", true)).toEqual({ href: "/home", label: CONTINUE_LATER_WORDS.home });
  });

  it("Get the app comes first while the store links are set, and leaves no trace while they are unset (WP-03 T9)", () => {
    renderAt(`/b/${ID}/crm`);
    expect(document.querySelector("[data-get-the-app]")).toBeNull();
    storeLinks = { ios: "https://apps.apple.com/us/app/foundmill/id1234567890", android: null };
    renderAt(`/b/${ID}/crm`);
    const prompt = document.querySelector("[data-get-the-app]");
    expect(prompt?.textContent).toContain("Get the app for iPhone");
    expect(prompt?.parentElement?.firstElementChild).toBe(prompt);
  });
});
