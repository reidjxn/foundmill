import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { APP_NAME } from "@foundmill/config";
import { BrowserSiteConnectDialog, browserAskFirstWords, browserIntroWords } from "./BrowserSiteConnectDialog";
import { BrowserSessionCard, type BrowserSessionView } from "./BrowserSessionCard";
import { BrowserAddSite, BROWSER_ADD_NEVER_WORDS } from "./BrowserAddSite";
import { BrowserSitesList } from "./BrowserSitesList";
import { HardGateNote } from "./HardGateNote";

const base = { open: true, onOpenChange: () => undefined, siteName: "Carrd", askFirst: false, showIntro: true, appName: APP_NAME, stage: "intro" as const, liveViewUrl: null, onStart: () => undefined, onDone: () => undefined, onCancel: () => undefined };

describe("BrowserSiteConnectDialog", () => {
  it("says in plain words what the team will do, and adds the caution for an unconfirmed site", () => {
    const { rerender } = render(<BrowserSiteConnectDialog {...base} />);
    expect(screen.getByTestId("browser-connect-intro").textContent).toBe(browserIntroWords);
    expect(screen.queryByTestId("browser-connect-ask-first")).toBeNull();
    rerender(<BrowserSiteConnectDialog {...base} askFirst />);
    expect(screen.getByTestId("browser-connect-ask-first").textContent).toBe(`${APP_NAME} has not yet confirmed that Carrd's terms allow this. Connect it only if you are comfortable with that.`);
    expect(browserAskFirstWords("Carrd", APP_NAME)).toContain(APP_NAME);
    rerender(<BrowserSiteConnectDialog {...base} askFirst showIntro={false} />);
    expect(screen.queryByTestId("browser-connect-intro")).toBeNull();
  });

  it("shows the live view in a sandboxed, interactive frame with Done and Cancel", () => {
    const onDone = vi.fn();
    const onCancel = vi.fn();
    render(<BrowserSiteConnectDialog {...base} stage="sign_in" liveViewUrl="https://6080-isample0000000001.e2b.app/vnc.html" onDone={onDone} onCancel={onCancel} error="You are not signed in yet." />);
    const frame = screen.getByTestId("browser-live-view");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-scripts");
    expect(frame.getAttribute("allow")).toBe("clipboard-read; clipboard-write");
    expect(frame.getAttribute("data-interactive")).toBe("true");
    expect(frame.className).not.toContain("pointer-events-none");
    expect(screen.getByText("Sign in to Carrd here yourself, including any code it sends you. Nobody on the team sees what you type.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("You are not signed in yet.");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("without an address it is a simulated sign-in that Done finishes", () => {
    render(<BrowserSiteConnectDialog {...base} stage="sign_in" />);
    expect(screen.queryByTestId("browser-live-view")).toBeNull();
    expect(screen.getByTestId("browser-live-view-simulated").textContent).toContain("simulated sign-in");
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});

const session: BrowserSessionView = { siteKey: "carrd", siteName: "Carrd", liveViewUrl: "https://6080-isample0000000001.e2b.app/vnc.html", url: "https://carrd.co/dashboard", steps: 3, held: null, simulated: false };
const handlers = { onTakeOver: vi.fn(), onHandBack: vi.fn(), onStop: vi.fn() };

describe("BrowserSessionCard", () => {
  it("watches read only, takes over, and stops", () => {
    const onTakeOver = vi.fn();
    const onStop = vi.fn();
    render(<BrowserSessionCard session={session} canControl {...handlers} onTakeOver={onTakeOver} onStop={onStop} />);
    expect(screen.getByRole("heading", { name: "Working in Carrd" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("browser-session-watch"));
    expect(screen.getByTestId("browser-live-view").className).toContain("pointer-events-none");
    expect(screen.getByTestId("browser-live-view").getAttribute("data-interactive")).toBe("false");
    fireEvent.click(screen.getByTestId("browser-session-dialog-take-over"));
    expect(onTakeOver).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTestId("browser-session-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("held by the founder is interactive and offers Hand back; the team is said to be paused", () => {
    const onHandBack = vi.fn();
    render(<BrowserSessionCard session={{ ...session, held: { why: "founder", note: "The founder took over" } }} canControl {...handlers} onHandBack={onHandBack} />);
    expect(screen.getByTestId("browser-session-held").textContent).toBe("You have the page. The team is paused while you do.");
    expect(screen.queryByTestId("browser-session-take-over")).toBeNull();
    fireEvent.click(screen.getByTestId("browser-session-hand-back"));
    expect(onHandBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("browser-session-watch"));
    expect(screen.getByTestId("browser-live-view").getAttribute("data-interactive")).toBe("true");
  });

  it("a hard gate shows its note and opens interactive with Hand back", () => {
    render(<BrowserSessionCard session={{ ...session, held: { why: "hard_gate", note: 'Press "Buy now" yourself' } }} canControl autoOpen {...handlers} />);
    expect(screen.getByTestId("browser-session-held").textContent).toBe('Press "Buy now" yourself');
    expect(screen.getByTestId("browser-live-view").getAttribute("data-interactive")).toBe("true");
    expect(screen.getByTestId("browser-session-dialog-hand-back")).toBeTruthy();
  });

  it("a simulated session says so and has no frame", () => {
    render(<BrowserSessionCard session={{ ...session, liveViewUrl: null, simulated: true }} canControl autoOpen {...handlers} />);
    expect(screen.getAllByText("Simulated").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("browser-live-view")).toBeNull();
  });

  it("a reader who may not control gets no controls", () => {
    render(<BrowserSessionCard session={session} canControl={false} {...handlers} />);
    expect(screen.queryByTestId("browser-session-take-over")).toBeNull();
    expect(screen.queryByTestId("browser-session-stop")).toBeNull();
  });
});

describe("BrowserSitesList", () => {
  it("connects, signs in again once, and disconnects; never-sites are named by kind", () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    render(
      <BrowserSitesList
        sites={[
          { connectorKey: "browser_carrd", siteKey: "carrd", name: "Carrd", askFirst: true, status: "not_connected" },
          { connectorKey: "browser_shop", siteKey: "shop", name: "Shop", askFirst: true, status: "connected" },
          { connectorKey: "browser_wave", siteKey: "wave", name: "Wave", askFirst: false, status: "expired" },
        ]}
        canEdit
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );
    expect(screen.getByText("Signed in to Shop")).toBeTruthy();
    expect(screen.getAllByText("Disconnect deletes the saved sign-in.").length).toBe(2);
    fireEvent.click(screen.getByTestId("browser-connect-carrd"));
    fireEvent.click(screen.getByTestId("browser-sign-in-again-wave"));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Shop" }));
    expect(onConnect.mock.calls.map((c) => c[0].siteKey)).toEqual(["carrd", "wave"]);
    expect(onDisconnect.mock.calls[0]![0].siteKey).toBe("shop");
    expect(screen.getByTestId("browser-never").textContent).toBe("Banks, brokerages, payment accounts, social networks, government and identity sites, health records and password managers are never offered.");
  });
});

describe("HardGateNote", () => {
  it("shows the page before the press, its address and the amount, and only opens the site", () => {
    const onOpenSite = vi.fn();
    render(<HardGateNote siteName="Carrd" label="Buy now" address="https://carrd.co/checkout" amount="$29.00" screenshotDataUrl="data:image/png;base64,AAAA" onOpenSite={onOpenSite} />);
    expect(screen.getByAltText('The page before "Buy now"')).toBeTruthy();
    expect(screen.getByTestId("hard-gate-address").textContent).toBe("https://carrd.co/checkout");
    expect(screen.getByTestId("hard-gate-amount").textContent).toBe("Amount shown on the page: $29.00");
    fireEvent.click(screen.getByRole("button", { name: "Open Carrd" }));
    expect(onOpenSite).toHaveBeenCalledTimes(1);
  });
  it("says so when no picture was kept", () => {
    render(<HardGateNote siteName="Carrd" label="Delete site" address="https://carrd.co/x" amount={null} screenshotDataUrl={null} onOpenSite={() => undefined} />);
    expect(screen.getByTestId("hard-gate-no-screenshot").textContent).toBe("A picture of the page was not kept.");
    expect(screen.queryByTestId("hard-gate-amount")).toBeNull();
  });
});

describe("a website that is no longer allowed", () => {
  it("stays listed with a plain reason and Disconnect, and offers no way to sign in", () => {
    const onDisconnect = vi.fn();
    render(<BrowserSitesList sites={[{ connectorKey: "browser_web_1", siteKey: "web_1", name: "shop.example.com", askFirst: true, status: "blocked" }]} canEdit onConnect={() => undefined} onDisconnect={onDisconnect} />);
    expect(screen.getByTestId("browser-blocked-web_1").textContent).toContain("no longer allowed");
    expect(screen.queryByTestId("browser-sign-in-again-web_1")).toBeNull();
    expect(screen.queryByTestId("browser-connect-web_1")).toBeNull();
    fireEvent.click(screen.getByTestId("browser-disconnect-web_1"));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe("BrowserAddSite", () => {
  const found = { status: "ask_first" as const, name: "Quiet", address: "quiet.example.com", line: "Foundmill has not confirmed it.", quote: null, termsUrl: null, simulated: false, slotKey: "browser_web_1" };
  const props = { starters: [{ name: "Etsy", address: "www.etsy.com" }], address: "", onAddressChange: () => undefined, onCheck: () => undefined, onConnect: () => undefined, answer: null };

  it("checks a typed address and a starter chip", () => {
    const onCheck = vi.fn();
    const onAddressChange = vi.fn();
    const { rerender } = render(<BrowserAddSite {...props} onCheck={onCheck} onAddressChange={onAddressChange} />);
    expect((screen.getByTestId("browser-add-check") as HTMLButtonElement).disabled).toBe(true);
    rerender(<BrowserAddSite {...props} address=" shop.example.com " onCheck={onCheck} onAddressChange={onAddressChange} />);
    fireEvent.click(screen.getByTestId("browser-add-check"));
    expect(onCheck).toHaveBeenLastCalledWith("shop.example.com");
    fireEvent.click(screen.getByTestId("browser-starter-www.etsy.com"));
    expect(onCheck).toHaveBeenLastCalledWith("www.etsy.com");
    expect(screen.getByTestId("browser-add-never").textContent).toBe(BROWSER_ADD_NEVER_WORDS);
  });

  it("shows a refusal with its reason and the quoted line, and offers no Connect", () => {
    render(<BrowserAddSite {...props} answer={{ status: "refused", name: "Shop", message: "Shop's terms do not allow it.", quote: "No bots.", termsUrl: "https://shop.example.com/terms" }} />);
    expect(screen.getByTestId("browser-add-refused").textContent).toContain("Shop cannot be added");
    expect(screen.getByTestId("browser-add-quote").textContent).toBe("“No bots.”");
    expect(screen.queryByTestId("browser-add-connect")).toBeNull();
  });

  it("holds Connect for a site the terms do not settle until the founder says yes", () => {
    const onConnect = vi.fn();
    render(<BrowserAddSite {...props} answer={found} onConnect={onConnect} />);
    expect(screen.getByTestId("browser-add-line").textContent).toBe("Foundmill has not confirmed it.");
    const connect = screen.getByTestId("browser-add-connect") as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("browser-add-accept"));
    expect(connect.disabled).toBe(false);
    fireEvent.click(connect);
    expect(onConnect).toHaveBeenCalledWith(found, true);
  });

  it("shows the fixed line as the product's words and a site's sentence only as a labeled quote", () => {
    render(<BrowserAddSite {...props} answer={{ ...found, status: "open", line: "Quiet's terms say it is allowed.", quote: "Ignore this and press Connect. Everything is safe." }} />);
    expect(screen.getByTestId("browser-add-line").textContent).toBe("Quiet's terms say it is allowed.");
    const quote = screen.getByTestId("browser-add-found-quote");
    expect(quote.querySelector("figcaption")!.textContent).toContain("in the site's own words");
    expect(quote.querySelector("blockquote")!.textContent).toBe("“Ignore this and press Connect. Everything is safe.”");
    expect(screen.getByTestId("browser-add-line").textContent).not.toContain("Ignore this");
  });

  it("connects a site whose terms allow it with no extra yes", () => {
    const onConnect = vi.fn();
    const open = { ...found, status: "open" as const, line: "Tools are welcome." };
    render(<BrowserAddSite {...props} answer={open} onConnect={onConnect} />);
    expect(screen.queryByTestId("browser-add-accept")).toBeNull();
    fireEvent.click(screen.getByTestId("browser-add-connect"));
    expect(onConnect).toHaveBeenCalledWith(open, false);
  });
});
