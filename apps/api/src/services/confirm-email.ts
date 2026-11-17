/**
 * Supabase's "Confirm email" setting, watched (security review, Google sign-in, Nov 12).
 *
 * SIGNUP_ALLOWLIST (services/access.ts) trusts an address only when the token shows its holder proved it (auth.ts
 * `emailConfirmedFromPayload`): an inbox-proving sign-in, or a Google sign-in whose address Google verified. Both rest
 * on Supabase's "Confirm email" being on. With it off Supabase auto-confirms every address it is given (its auth
 * settings then say `mailer_autoconfirm: true`), so a session no longer shows that anyone read the inbox.
 *
 * So while SIGNUP_ALLOWLIST is set the api reads `GET ${SUPABASE_URL}/auth/v1/settings` (public with the anon key, the
 * same call the web's Google button makes) at boot and every 10 minutes. This is the platform's own auth service, like
 * the signing keys auth.ts fetches from the same host and the admin API the boot seed calls (packages/db seed/auth.ts),
 * not a vendor, so it does not go through apps/gateway.
 *
 * - `mailer_autoconfirm === true`: one error line, and no session counts as confirmed until a later read says
 *   otherwise. The allow-list then refuses every listed account (`email_unconfirmed`), members included: it is
 *   checked on every signed-in request, not only at sign-up. Fail closed.
 * - `mailer_autoconfirm === false`: sessions are judged by their token, as before.
 * - The settings cannot be read (no anon key, Supabase down, a refusal, an answer without the field): the last known
 *   value stays, starting as "unknown", which keeps the token-only behavior; a warning line. Boot never waits for it.
 *
 * Field: `mailer_autoconfirm` in Supabase Auth's settings response (github.com/supabase/auth, internal/api/settings.go,
 * `MailerAutoconfirm bool json:"mailer_autoconfirm"`, set from the project's mailer autoconfirm config).
 */
import type { ApiLogger } from "./log";

/** How often the setting is read again. */
export const CONFIRM_EMAIL_REFRESH_MS = 10 * 60_000;
/** How long one read may take. */
export const CONFIRM_EMAIL_TIMEOUT_MS = 5_000;

/** "on": Supabase auto-confirms addresses ("Confirm email" off). "off": it does not. "unknown": never read yet. */
export type AutoconfirmState = "on" | "off" | "unknown";

export interface ConfirmEmailGuard {
  /** The last value read. */
  state(): AutoconfirmState;
  /** False while Supabase auto-confirms addresses: no token may then count as a confirmed address. */
  confirmationTrusted(): boolean;
  /** Reads the setting once (never throws); resolves with the state after the read. */
  refresh(): Promise<AutoconfirmState>;
  /** Reads now (not awaited by the caller at boot) and every `intervalMs` on an unref'd timer. */
  start(options?: { intervalMs?: number }): { ready: Promise<AutoconfirmState>; stop(): void };
}

export interface ConfirmEmailGuardOptions {
  supabaseUrl: string;
  /** The project's anon (publishable) key; without it nothing can be read and the state stays "unknown". */
  anonKey: string | null | undefined;
  log: Pick<ApiLogger, "error" | "warn" | "info">;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createConfirmEmailGuard(opts: ConfirmEmailGuardOptions): ConfirmEmailGuard {
  let current: AutoconfirmState = "unknown";
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = new URL("/auth/v1/settings", opts.supabaseUrl).toString();

  const unreadable = (reason: string): AutoconfirmState => {
    opts.log.warn({ url, reason, kept: current }, "could not read Supabase's auth settings to check \"Confirm email\"; keeping the last known value (docs/DEPLOY.md §4)");
    return current;
  };

  const refresh = async (): Promise<AutoconfirmState> => {
    if (!opts.anonKey) return unreadable("SUPABASE_ANON_KEY is not set on the api");
    let body: unknown;
    try {
      const res = await fetchImpl(url, { headers: { apikey: opts.anonKey, accept: "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs ?? CONFIRM_EMAIL_TIMEOUT_MS) });
      if (!res.ok) return unreadable(`HTTP ${res.status}`);
      body = await res.json();
    } catch (err) {
      return unreadable((err as Error)?.message ?? String(err));
    }
    const value = body && typeof body === "object" ? (body as { mailer_autoconfirm?: unknown }).mailer_autoconfirm : undefined;
    if (typeof value !== "boolean") return unreadable("the answer has no boolean mailer_autoconfirm");
    const next: AutoconfirmState = value ? "on" : "off";
    if (next === "on" && current !== "on") {
      opts.log.error({ url }, "Supabase auto-confirms email addresses (\"Confirm email\" is off): no session counts as a confirmed address, so SIGNUP_ALLOWLIST refuses every listed account until it is turned back on (docs/DEPLOY.md §4)");
    } else if (next === "off" && current === "on") {
      opts.log.info({ url }, "Supabase's \"Confirm email\" is on again: sessions are judged by their tokens");
    }
    current = next;
    return current;
  };

  return {
    state: () => current,
    confirmationTrusted: () => current !== "on",
    refresh,
    start(options = {}) {
      const ready = refresh();
      const timer = setInterval(() => void refresh(), options.intervalMs ?? CONFIRM_EMAIL_REFRESH_MS);
      timer.unref?.();
      return { ready, stop: () => clearInterval(timer) };
    },
  };
}
