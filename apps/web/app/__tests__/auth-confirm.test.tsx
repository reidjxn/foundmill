// @vitest-environment happy-dom
/**
 * The page the sign-in email's link opens (lib/auth/confirm-link.ts): the one-time confirmation link is opened only by a
 * press on the button, never by the page itself, so a mail service that opens links ahead of the reader uses nothing up.
 * The link must be this deployment's own Supabase verify address; anything else goes to /login with a reason code.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "@/lib/env";
import { confirmationLink } from "@/lib/auth/confirm-link";

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  usePathname: () => "/auth/confirm",
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

let supabaseConfigured = true;
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  const withSupabase = actual.parsePublicEnv({ NEXT_PUBLIC_APP_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
  const without = actual.parsePublicEnv({ NEXT_PUBLIC_APP_ENV: "staging" });
  const env = () => (supabaseConfigured ? withSupabase : without);
  return { ...actual, publicEnv: env, hasSupabase: (e = env()) => actual.hasSupabase(e), isDevLike: (e = env()) => actual.isDevLike(e) };
});

const { default: ConfirmPage } = await import("../auth/confirm/page");
const { ConfirmSignIn, CONFIRM_SIGN_IN_WORDS } = await import("../auth/confirm/ConfirmSignIn");

const SUPABASE = "https://x.supabase.co";
/** What Supabase puts in the email, percent-encoded once inside our `confirmation_url` parameter and decoded by the page. */
const VERIFY = `${SUPABASE}/auth/v1/verify?token=abc123&type=signup&redirect_to=https%3A%2F%2Ffoundmill.com%2Fauth%2Fcallback%3Fnext%3D%2Fb%2Fx`;

async function open(params: Record<string, string | string[] | undefined>): Promise<{ redirectedTo: string | null }> {
  try {
    render(await ConfirmPage({ searchParams: Promise.resolve(params) }));
    return { redirectedTo: null };
  } catch (err) {
    if (err instanceof Redirected) return { redirectedTo: err.to };
    throw err;
  }
}

beforeEach(() => {
  supabaseConfigured = true;
});

describe("confirmationLink", () => {
  it("accepts this deployment's own verify link, whole", () => {
    expect(confirmationLink({ confirmation_url: VERIFY }, SUPABASE)).toBe(VERIFY);
    // The first value counts when the parameter repeats; a trailing slash on the configured address changes nothing.
    expect(confirmationLink({ confirmation_url: [VERIFY, "https://evil.example/"] }, `${SUPABASE}/`)).toBe(VERIFY);
  });

  it("puts back the link's own parameters when the template engine left the link unencoded", () => {
    const link = confirmationLink({ confirmation_url: `${SUPABASE}/auth/v1/verify?token=abc123`, type: "signup", redirect_to: "https://foundmill.com/auth/callback?next=/b/x" }, SUPABASE);
    const url = new URL(link ?? "");
    expect(url.origin + url.pathname).toBe(`${SUPABASE}/auth/v1/verify`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ token: "abc123", type: "signup", redirect_to: "https://foundmill.com/auth/callback?next=/b/x" });
    // A parameter the link already carries is never overwritten by one of the page's.
    expect(new URL(confirmationLink({ confirmation_url: VERIFY, type: "magiclink" }, SUPABASE) ?? "").searchParams.get("type")).toBe("signup");
  });

  it("refuses anything but the configured Supabase's verify endpoint", () => {
    expect(confirmationLink({ confirmation_url: "https://evil.example/auth/v1/verify?token=abc" }, SUPABASE)).toBeNull();
    expect(confirmationLink({ confirmation_url: "https://x.supabase.co.evil.example/auth/v1/verify?token=abc" }, SUPABASE)).toBeNull();
    expect(confirmationLink({ confirmation_url: `${SUPABASE}/auth/v1/authorize?provider=google` }, SUPABASE)).toBeNull();
    expect(confirmationLink({ confirmation_url: "javascript:alert(1)" }, SUPABASE)).toBeNull();
    expect(confirmationLink({ confirmation_url: "not a url" }, SUPABASE)).toBeNull();
    expect(confirmationLink({}, SUPABASE)).toBeNull();
    expect(confirmationLink({ confirmation_url: VERIFY }, "")).toBeNull();
  });
});

describe("/auth/confirm", () => {
  it("shows one button and no link to the verify endpoint, so a visitor that opens links uses nothing up", async () => {
    expect(await open({ confirmation_url: VERIFY })).toEqual({ redirectedTo: null });
    expect(screen.getByTestId("confirm-sign-in")).toBeTruthy();
    expect(screen.getByRole("button", { name: CONFIRM_SIGN_IN_WORDS.button })).toBeTruthy();
    expect(document.querySelector('a[href*="/auth/v1/verify"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain("abc123");
  });

  it("sends a link that is not this Supabase's, or no link, to the sign-in form as an incomplete link", async () => {
    expect(await open({ confirmation_url: "https://evil.example/auth/v1/verify?token=abc" })).toEqual({ redirectedTo: "/login?error=missing_code" });
    expect(await open({})).toEqual({ redirectedTo: "/login?error=missing_code" });
  });

  it("without Supabase on this server, says so the way the callback does", async () => {
    supabaseConfigured = false;
    expect(await open({ confirmation_url: VERIFY })).toEqual({ redirectedTo: "/login?error=not_configured" });
  });
});

describe("ConfirmSignIn", () => {
  it("opens the link on the press, and only then", () => {
    const go = vi.fn();
    render(<ConfirmSignIn link={VERIFY} go={go} />);
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_SIGN_IN_WORDS.button }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(VERIFY);
  });
});
