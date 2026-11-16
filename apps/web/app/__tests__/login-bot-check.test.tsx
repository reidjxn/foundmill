// @vitest-environment happy-dom
/**
 * The sign-in bot check (WP-03 T8): with NEXT_PUBLIC_SIGNIN_BOT_CHECK=on and a Turnstile site key, sending the email
 * passes Supabase a Turnstile token (`captchaToken`, action `sign_in`); with the switch off, or no site key, none is
 * asked for or sent. A token that cannot be had says so in plain words and sends nothing.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "@/lib/env";

type OtpArgs = { email: string; options: { emailRedirectTo: string; captchaToken?: string } };
const signInWithOtp = vi.fn(async (_args: OtpArgs) => ({ error: null }));
const turnstileToken = vi.fn(async (_siteKey: string, _el: HTMLElement | null, _ms?: number, _action?: string): Promise<string | null> => "turnstile-token");
let raw: Record<string, string> = {};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/login" }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(async () => ({ auth: { signInWithOtp } })) }));
vi.mock("@/lib/turnstile", () => ({ turnstileToken, loadTurnstile: vi.fn(async () => null) }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  const env = () => actual.parsePublicEnv({ NEXT_PUBLIC_APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", ...raw });
  return { ...actual, publicEnv: () => env(), hasSupabase: () => true, isDevLike: () => false };
});

const { LoginForm } = await import("../login/LoginForm");

async function send() {
  render(<LoginForm google={false} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "maya@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in link" }));
}

beforeEach(() => {
  signInWithOtp.mockClear();
  turnstileToken.mockClear();
  raw = {};
});

describe("the sign-in bot check", () => {
  it("on with a site key: the send carries the Turnstile token for the sign_in action", async () => {
    raw = { NEXT_PUBLIC_SIGNIN_BOT_CHECK: "on", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key" };
    await send();
    await waitFor(() => expect(screen.getByTestId("login-sent")).toBeTruthy());
    expect(turnstileToken).toHaveBeenCalledWith("site-key", expect.any(HTMLElement), 15_000, "sign_in");
    expect(signInWithOtp.mock.calls[0]?.[0].options.captchaToken).toBe("turnstile-token");
  });

  it("off (the default), or on without a site key: no token is asked for or sent", async () => {
    const envs: Record<string, string>[] = [{}, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key" }, { NEXT_PUBLIC_SIGNIN_BOT_CHECK: "on" }];
    for (const env of envs) {
      raw = env;
      await send();
      await waitFor(() => expect(screen.getByTestId("login-sent")).toBeTruthy());
      expect(screen.queryByTestId("login-bot-check")).toBeNull();
      document.body.innerHTML = "";
    }
    expect(turnstileToken).not.toHaveBeenCalled();
    expect(signInWithOtp).toHaveBeenCalledTimes(3);
    for (const [args] of signInWithOtp.mock.calls) expect(args.options).not.toHaveProperty("captchaToken");
  });

  it("a token that cannot be had says so and sends nothing", async () => {
    raw = { NEXT_PUBLIC_SIGNIN_BOT_CHECK: "on", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key" };
    turnstileToken.mockResolvedValueOnce(null);
    await send();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We could not check this browser. Reload the page and try again."));
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
