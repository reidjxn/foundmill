// @vitest-environment happy-dom
/**
 * The sign-in form on any host: the magic link always returns to the canonical origin (never www or a preview host),
 * a link /auth/callback could not use comes back as a clear notice with the form ready to send a new one, and a link
 * Supabase refuses to send reads as what happened in plain words, never Supabase's own message.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "@/lib/env";

type OtpError = { code?: string; status?: number; name?: string; message: string };
const signInWithOtp = vi.fn(async (_args: { email: string; options: { emailRedirectTo: string } }): Promise<{ error: OtpError | null }> => ({ error: null }));
type OAuthArgs = { provider: string; options: { redirectTo: string; skipBrowserRedirect?: boolean } };
const signInWithOAuth = vi.fn(async (_args: OAuthArgs): Promise<{ data: { url: string | null }; error: { message: string } | null }> => ({ data: { url: "https://x.supabase.co/auth/v1/authorize?provider=google" }, error: null }));
let search = new URLSearchParams();
/** Set to make the auth client's chunk fail to load (offline, a new deploy). */
let clientLoadError: Error | null = null;

vi.mock("next/navigation", () => ({ useSearchParams: () => search, usePathname: () => "/login" }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(async () => {
    if (clientLoadError) throw clientLoadError;
    return { auth: { signInWithOtp, signInWithOAuth } };
  }),
}));
// Staging, as on foundmill.com: Supabase configured, no NEXT_PUBLIC_APP_URL, no developer bypass.
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  const staging = actual.parsePublicEnv({ NEXT_PUBLIC_APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
  return {
    ...actual,
    publicEnv: () => staging,
    hasSupabase: (env = staging) => actual.hasSupabase(env),
    isDevLike: (env = staging) => actual.isDevLike(env),
  };
});

const { LoginForm } = await import("../login/LoginForm");

function onHost(url: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

async function sendLink(email = "founder@example.com") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
  await waitFor(() => expect(screen.getByTestId("login-sent")).toBeTruthy());
}

beforeEach(() => {
  signInWithOtp.mockClear();
  search = new URLSearchParams();
  clientLoadError = null;
});

describe("LoginForm", () => {
  it("once sent, a phone puts the six-digit code first and the link second; a desktop keeps the link first (WP-03 T4)", async () => {
    const original = window.innerWidth;
    const at = (width: number) => Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    try {
      at(390);
      const phone = render(<LoginForm />);
      await sendLink("new@example.com");
      const sent = screen.getByTestId("login-sent");
      expect(sent.textContent).toContain("Check your email");
      expect(sent.textContent).not.toContain("Link sent");
      const typeLine = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Type the 6-digit code we sent to new@example.com.");
      const code = screen.getByTestId("login-code");
      const linkLine = screen.getByText("Or open the link in that email on this device.");
      // In document order: the line, the code field, then the link sentence.
      expect(typeLine.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(code.compareDocumentPosition(linkLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      phone.unmount();

      at(1440);
      render(<LoginForm />);
      await sendLink("new@example.com");
      expect(screen.getByTestId("login-sent").textContent).toContain("Check your email");
      const desktopLink = screen.getByText(/for a sign-in link and open it in this browser/);
      expect(desktopLink.compareDocumentPosition(screen.getByTestId("login-code")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText("Or open the link in that email on this device.")).toBeNull();
    } finally {
      at(original);
    }
  });

  it("asked for on www, the magic link still returns to https://foundmill.com", async () => {
    onHost("https://www.foundmill.com/login?next=%2Fb%2Fabc%2Finbox");
    render(<LoginForm nextParam="/b/abc/inbox" />);
    await sendLink();
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "founder@example.com", options: { emailRedirectTo: "https://foundmill.com/auth/callback?next=%2Fb%2Fabc%2Finbox" } });
  });

  it("asked for on a preview deployment, the link returns to the apex too", async () => {
    onHost("https://foundmill-git-main.vercel.app/login");
    render(<LoginForm />);
    await sendLink();
    expect(signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo).toBe("https://foundmill.com/auth/callback?next=%2F");
  });

  it("a link opened on a different address explains itself above a working form", async () => {
    onHost("https://foundmill.com/login?error=other_address&next=%2Fb%2Fabc");
    render(<LoginForm errorParam="other_address" nextParam="/b/abc" />);
    const notice = screen.getByTestId("login-link-problem");
    expect(notice.textContent).toMatch(/Link opened on a different address/);
    expect(notice.textContent).toMatch(/Send a new link from this page and open it in this browser/);
    // The way forward is right there: sending a new link works and keeps next.
    await sendLink();
    expect(signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo).toBe("https://foundmill.com/auth/callback?next=%2Fb%2Fabc");
    expect(screen.queryByTestId("login-link-problem")).toBeNull();
  });

  it("an expired link and an unknown error read as such; no error, no notice", () => {
    const { unmount } = render(<LoginForm errorParam="expired" />);
    expect(screen.getByTestId("login-link-problem").textContent).toMatch(/Link expired/);
    unmount();
    const second = render(<LoginForm errorParam="invalid request: both auth code and code verifier should be non-empty" />);
    expect(screen.getByTestId("login-link-problem").textContent).toMatch(/Sign-in failed/);
    expect(screen.getByTestId("login-link-problem").textContent).not.toMatch(/code verifier/);
    second.unmount();
    render(<LoginForm />);
    expect(screen.queryByTestId("login-link-problem")).toBeNull();
  });

  it("is rendered from its props alone, so the server can put the form and the error notice in the page's HTML (audit PAS-9)", async () => {
    const { renderToString } = await import("react-dom/server");
    const html = renderToString(<LoginForm errorParam="expired" nextParam="/b/abc" />);
    expect(html).toContain("Send sign-in link");
    expect(html).toContain("Email");
    expect(html).toContain("No password, no card. We email you a link.");
    // WP-03 T1: what signing in does for a new address, said before it happens.
    expect(html).toContain("New here? Foundmill lets new people in a few at a time. Signing in saves your place.");
    expect(html).toContain("you@example.com");
    expect(html).toContain("Link expired");
    expect(html).not.toContain("BAILOUT_TO_CLIENT_SIDE_RENDERING");
  });

  it("a link Supabase refuses to send reads as what happened and what to do, never Supabase's own words", async () => {
    const cases: Array<[OtpError, RegExp]> = [
      // Supabase's built-in sender only mails the project's team (DEPLOY §4: custom SMTP is required).
      [{ code: "email_address_not_authorized", status: 400, message: "Email address not authorized" }, /can't send sign-in emails to this address/],
      [{ code: "over_email_send_rate_limit", status: 429, message: "email rate limit exceeded" }, /Too many sign-in links/],
      [{ code: "over_email_send_rate_limit", status: 429, message: "For security purposes, you can only request this after 52 seconds." }, /was just sent to this address/],
      [{ code: "over_request_rate_limit", status: 429, message: "Request rate limit reached" }, /Too many sign-in links/],
      [{ code: "otp_disabled", status: 422, message: "Signups not allowed for otp" }, /new sign-ups are closed/],
      [{ code: "email_address_invalid", status: 400, message: 'Email address "x@y" is invalid' }, /doesn't look right/],
      [{ name: "AuthRetryableFetchError", message: "Failed to fetch" }, /couldn't reach the sign-in service/],
      [{ status: 500, message: "Error sending magic link email" }, /couldn't be sent. Try again/],
    ];
    for (const [error, shown] of cases) {
      signInWithOtp.mockResolvedValueOnce({ error });
      const view = render(<LoginForm />);
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "founder@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent, error.message).toMatch(shown);
      expect(alert.textContent, error.message).not.toContain(error.message);
      view.unmount();
    }
  });

  it("a send that throws shows the plain failure and leaves the form ready to try again", async () => {
    signInWithOtp.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "founder@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't be sent/);
    expect(screen.getByRole("button", { name: "Send sign-in link" }).hasAttribute("disabled")).toBe(false);
  });

  it("an auth client that fails to load shows the plain failure instead of doing nothing", async () => {
    clientLoadError = new TypeError("Failed to fetch dynamically imported module");
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "founder@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't be sent/);
    expect(alert.textContent).not.toContain("dynamically imported");
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send sign-in link" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("LoginForm: Continue with Google", () => {
  let settings: { status: number; body: unknown } | Error = { status: 200, body: { external: { google: true, email: true } } };
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (settings instanceof Error) throw settings;
    return new Response(JSON.stringify(settings.body), { status: settings.status, headers: { "content-type": "application/json" } });
  });
  const assign = vi.fn();
  const realLocation = window.location;
  beforeEach(() => {
    settings = { status: 200, body: { external: { google: true, email: true } } };
    fetchMock.mockClear();
    signInWithOAuth.mockClear();
    assign.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, origin: "https://foundmill.com", assign } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  });

  const google = () => screen.queryByRole("button", { name: "Continue with Google" });

  it("is hidden while the flag is off (the default) and sits above the email form when it is on", () => {
    const off = render(<LoginForm />);
    expect(google()).toBeNull();
    expect(screen.queryByTestId("login-google")).toBeNull();
    off.unmount();
    render(<LoginForm google />);
    const button = google()!;
    expect(button).toBeTruthy();
    // Above the email form, which is unchanged.
    expect(button.compareDocumentPosition(screen.getByTestId("login-form")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeTruthy();
  });

  it("goes to Google through the email link's own callback, with the same next, once Supabase says the provider is on", async () => {
    render(<LoginForm google nextParam="/b/abc/inbox" />);
    fireEvent.click(google()!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://x.supabase.co/auth/v1/authorize?provider=google"));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://x.supabase.co/auth/v1/settings");
    expect(signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://foundmill.com/auth/callback?next=%2Fb%2Fabc%2Finbox&via=google", skipBrowserRedirect: true } });
    // An unsafe next never reaches the callback address.
    assign.mockClear();
    signInWithOAuth.mockClear();
    const { unmount } = render(<LoginForm google nextParam="//evil.example" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Continue with Google" })[1]!);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(signInWithOAuth.mock.calls[0]?.[0].options.redirectTo).toBe("https://foundmill.com/auth/callback?next=%2F&via=google");
    unmount();
  });

  it("when the provider is not on, Supabase cannot be reached, or the call fails: a plain line under the button, and the email link still works", async () => {
    const cases: Array<() => void> = [
      () => (settings = { status: 200, body: { external: { google: false, email: true } } }),
      () => (settings = { status: 500, body: {} }),
      () => (settings = new TypeError("Failed to fetch")),
      () => signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: { message: "Unsupported provider: provider is not enabled" } }),
      () => signInWithOAuth.mockRejectedValueOnce(new TypeError("Failed to fetch")),
    ];
    for (const arrange of cases) {
      arrange();
      const view = render(<LoginForm google />);
      fireEvent.click(google()!);
      const error = await screen.findByTestId("login-google-error");
      expect(error.textContent).toBe("Google sign-in isn't available right now. Use the email link below.");
      expect(error.textContent).not.toMatch(/provider|Supabase/);
      expect(assign).not.toHaveBeenCalled();
      expect(google()!.getAttribute("aria-busy")).toBeNull();
      // The email form is untouched and sends a link.
      await sendLink();
      view.unmount();
      settings = { status: 200, body: { external: { google: true, email: true } } };
    }
  });

  it("back from Google without signing in (the page restored as it was left), the button is ready again", async () => {
    render(<LoginForm google />);
    fireEvent.click(google()!);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(google()!.getAttribute("aria-busy")).toBe("true");
    const restored = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restored, "persisted", { value: true });
    fireEvent(window, restored);
    await waitFor(() => expect(google()!.getAttribute("aria-busy")).toBeNull());
  });

  it("a Google sign-in that came back refused says so above both ways in", () => {
    for (const [reason, title] of [
      ["signups_closed", "New sign-ups are closed"],
      ["google_failed", "Google sign-in didn't finish"],
      ["google_unverified", "Google address not verified"],
    ] as const) {
      const view = render(<LoginForm google errorParam={reason} />);
      const notice = screen.getByTestId("login-link-problem");
      expect(notice.textContent).toContain(title);
      expect(notice.compareDocumentPosition(google()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      view.unmount();
    }
  });
});
