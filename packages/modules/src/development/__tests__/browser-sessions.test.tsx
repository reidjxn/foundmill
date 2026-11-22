import "./setup";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowserSessions, BROWSER_SESSIONS_POLL_MS } from "../BrowserSessions";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";

const session = { siteKey: "carrd", siteName: "Carrd", liveViewUrl: "https://6080-isample0000000001.e2b.app/vnc.html", url: "https://carrd.co/dashboard", startedAt: "2026-11-22T10:00:00.000Z", steps: 2, held: null, signIn: false, simulated: false };

describe("BrowserSessions on Working now", () => {
  it("shows nothing while no session is open", () => {
    const fake = createFakeSource({ responses: { "browser.sessions": { canControl: true, sessions: [] } } });
    renderScreen(fake, <BrowserSessions />);
    expect(screen.queryByTestId("browser-sessions")).toBeNull();
    expect(fake.queried.has("browser.sessions")).toBe(true);
  });

  it("lists each session as Working in <site>, polls, and takes over and hands back through browser.*", async () => {
    const fake = createFakeSource({ responses: { "browser.sessions": { canControl: true, sessions: [session] }, "browser.takeOver": { held: true }, "browser.handBack": { handedBack: true }, "browser.stop": { stopped: 1 } } });
    renderScreen(fake, <BrowserSessions />);
    expect(screen.getByRole("heading", { name: "Working in Carrd" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("browser-session-take-over"));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "browser.takeOver", input: { siteKey: "carrd" } }));
    fireEvent.click(screen.getByTestId("browser-session-stop"));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "browser.stop", input: { siteKey: "carrd" } }));
    expect(BROWSER_SESSIONS_POLL_MS).toBe(5_000);
  });

  it("a session held for a hard gate shows its note and offers Hand back", async () => {
    const held = { ...session, held: { why: "hard_gate", note: 'Press "Buy now" yourself' } };
    const fake = createFakeSource({ responses: { "browser.sessions": { canControl: true, sessions: [held] }, "browser.handBack": { handedBack: true } } });
    renderScreen(fake, <BrowserSessions />);
    expect(screen.getByTestId("browser-session-held").textContent).toBe('Press "Buy now" yourself');
    fireEvent.click(screen.getByTestId("browser-session-hand-back"));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "browser.handBack", input: { siteKey: "carrd" } }));
  });

  it("a failed control says so in plain words", async () => {
    const fake = createFakeSource({
      responses: { "browser.sessions": { canControl: true, sessions: [session] } },
      onMutate: () => {
        throw new Error("The hosted browser is not available here.");
      },
    });
    renderScreen(fake, <BrowserSessions />);
    fireEvent.click(screen.getByTestId("browser-session-stop"));
    expect((await screen.findByRole("alert")).textContent).toBe("The hosted browser is not available here.");
  });
});
