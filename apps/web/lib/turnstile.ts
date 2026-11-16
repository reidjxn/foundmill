/**
 * Cloudflare Turnstile for the idea box (docs/IDEA_BOX.md), a public page's Follow form
 * (components/public/FollowProjectForm.tsx) and, behind NEXT_PUBLIC_SIGNIN_BOT_CHECK, sending the sign-in email
 * (app/login/LoginForm.tsx, WP-03 T8): the script loads only when the visitor first focuses a field, and the invisible
 * widget gives one token per draft, follow or send, for that form's `action`. Without a site key (a development stack)
 * the token is the mock's, which only a development gateway accepts.
 */
import { TURNSTILE_ORIGIN } from "@/lib/security-headers";

export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
export const MOCK_TURNSTILE_TOKEN = "mock-ok";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi | null> | null = null;

/** Loads the script once; resolves null when it cannot load. */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** One token from the invisible widget in `container` (rendered for each draft or follow, then removed). */
export async function turnstileToken(siteKey: string, container: HTMLElement | null, timeoutMs = 15_000, action = "idea_box"): Promise<string | null> {
  if (!siteKey) return MOCK_TURNSTILE_TOKEN;
  const api = await loadTurnstile();
  if (!api || !container) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        api.remove(id);
      } catch {
        /* already gone */
      }
      resolve(token);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const id = api.render(container, { sitekey: siteKey, size: "invisible", appearance: "interaction-only", action, callback: (t: string) => done(t), "error-callback": () => done(null), "expired-callback": () => done(null) });
  });
}
