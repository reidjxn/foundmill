// @vitest-environment happy-dom
/**
 * The sign-in form on any host: the magic link always returns to the canonical origin (never www or a preview host),
 * a link /auth/callback could not use comes back as a clear notice with the form ready to send a new one, and a link
 * Supabase refuses to send reads as what happened in plain words, never Supabase's own message.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "@/lib/env";

type OtpError = { code?: string; status?: number; name?: string; message: string };
const signInWithOtp = vi.fn(async (_args: { email: string; options: { emailRedirectTo: string } }): Promise<{ error: OtpError | null }> => ({ error: null }));
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(async () => ({ auth: { signInWithOtp } })) }));
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
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
  await waitFor(() => expect(screen.getByTestId("login-sent")).toBeTruthy());
}

beforeEach(() => {
  signInWithOtp.mockClear();
  search = new URLSearchParams();
});

describe("LoginForm", () => {
  it("asked for on www, the magic link still returns to https://foundmill.com", async () => {
    onHost("https://www.foundmill.com/login?next=%2Fb%2Fabc%2Finbox");
    search = new URLSearchParams("next=%2Fb%2Fabc%2Finbox");
    render(<LoginForm />);
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
    search = new URLSearchParams("error=other_address&next=%2Fb%2Fabc");
    render(<LoginForm />);
    const notice = screen.getByTestId("login-link-problem");
    expect(notice.textContent).toMatch(/Link opened on a different address/);
    expect(notice.textContent).toMatch(/Send a new link from this page and open it in this browser/);
    // The way forward is right there: sending a new link works and keeps next.
    await sendLink();
    expect(signInWithOtp.mock.calls[0]?.[0].options.emailRedirectTo).toBe("https://foundmill.com/auth/callback?next=%2Fb%2Fabc");
    expect(screen.queryByTestId("login-link-problem")).toBeNull();
  });

  it("an expired link and an unknown error read as such; no error, no notice", () => {
    search = new URLSearchParams("error=expired");
    const { unmount } = render(<LoginForm />);
    expect(screen.getByTestId("login-link-problem").textContent).toMatch(/Link expired/);
    unmount();
    search = new URLSearchParams("error=invalid%20request%3A%20both%20auth%20code%20and%20code%20verifier%20should%20be%20non-empty");
    const second = render(<LoginForm />);
    expect(screen.getByTestId("login-link-problem").textContent).toMatch(/Sign-in failed/);
    expect(screen.getByTestId("login-link-problem").textContent).not.toMatch(/code verifier/);
    second.unmount();
    search = new URLSearchParams();
    render(<LoginForm />);
    expect(screen.queryByTestId("login-link-problem")).toBeNull();
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
      fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "founder@example.com" } });
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
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "founder@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't be sent/);
    expect(screen.getByRole("button", { name: "Send sign-in link" }).hasAttribute("disabled")).toBe(false);
  });
});
