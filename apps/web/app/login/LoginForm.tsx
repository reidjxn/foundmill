"use client";
/**
 * Magic-link sign-in (Supabase `signInWithOtp` with `emailRedirectTo` → /auth/callback on the canonical origin, never
 * this page's own host) and, in development/test only, the dev bypass button (POST /auth/dev sets the cookie apps/api
 * and apps/stream map to DEV_AUTH_USER_ID). A link that /auth/callback could not use comes back as `?error=<reason>`,
 * shown above the form with what to do next.
 *
 * With NEXT_PUBLIC_AUTH_GOOGLE=on, Continue with Google sits above the email form (lib/auth/google.ts): the same
 * callback, the same `next`. When it cannot start (the provider is not turned on in Supabase, no answer), a plain line
 * under it points to the email link, which stays usable throughout.
 *
 * Works from 390 px (CLAUDE.md "Small screens"): the frame renders at every width, every control is at least 44 px tall.
 * Once sent, a small screen shows the six-digit code first and the link second (WP-03 T4); a desktop the link first.
 */
import { Mail, Send, Unlink, Wrench } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { APP_NAME } from "@foundmill/config";
import { Button, Field, GoogleSignInButton, Input, Separator, StatusPill, isViewportTooSmall, useViewportWidth } from "@foundmill/dugout";
import { magicLinkCallbackUrl } from "@/lib/auth/canonical-origin";
import { NEXT_PARAM } from "@/lib/auth/constants";
import { startGoogleSignIn } from "@/lib/auth/google";
import { safeNextPath } from "@/lib/auth/redirects";
import { classifySendLinkError, GOOGLE_UNAVAILABLE_MESSAGE, parseSignInError, sendLinkErrorMessage, signInErrorCopy } from "@/lib/auth/sign-in-errors";
import { googleSignInEnabled, hasSupabase, isDevLike, publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { LEGAL_ROUTES } from "@/content/legal/facts";
import { SignInCode } from "./SignInCode";

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };
/** Continue with Google: at rest, on its way to Google, or unable to start. */
type GooglePhase = "idle" | "starting" | "unavailable";

export interface LoginFormProps {
  /** `?next=` as given (checked here by `safeNextPath`) and `?error=` as given (a reason code; anything else reads as a failure). */
  nextParam?: string | null;
  errorParam?: string | null;
  /** Offer Continue with Google; defaults to NEXT_PUBLIC_AUTH_GOOGLE (`googleSignInEnabled`). */
  google?: boolean;
}

export function LoginForm({ nextParam = null, errorParam = null, google = googleSignInEnabled() }: LoginFormProps) {
  const next = safeNextPath(nextParam);
  const linkError = parseSignInError(errorParam);
  const linkProblem = linkError ? signInErrorCopy(linkError) : null;
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [googlePhase, setGooglePhase] = useState<GooglePhase>("idle");
  const width = useViewportWidth();
  const supabaseReady = hasSupabase();
  const devBypass = isDevLike();
  // The Supabase client loads on demand; start it once the form is on screen so sending the link never waits for it.
  useEffect(() => {
    if (supabaseReady) void createClient().catch(() => undefined);
  }, [supabaseReady]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // The auth client is its own chunk: one that fails to load (offline, a new deploy) reads like a send that failed.
    const supabase = await createClient().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));
    if (supabase instanceof Error) {
      setPhase({ kind: "error", message: sendLinkErrorMessage(classifySendLinkError(supabase)) });
      return;
    }
    if (!supabase) {
      setPhase({ kind: "error", message: "Email sign-in is not set up on this server yet." });
      return;
    }
    setPhase({ kind: "sending" });
    const env = publicEnv();
    const emailRedirectTo = magicLinkCallbackUrl({ appUrl: env.appUrl, appEnv: env.appEnv, currentOrigin: window.location.origin, next });
    // A send that throws (the network dropped before Supabase answered) reads like a refused one.
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo } }).catch((err: unknown) => ({ error: err as { name?: string; message?: string } }));
    // Supabase's own wording never reaches the screen: the error is mapped to what happened and what to do next.
    if (error) setPhase({ kind: "error", message: sendLinkErrorMessage(classifySendLinkError(error)) });
    else setPhase({ kind: "sent", email: email.trim() });
  }

  // Back from Google's page without signing in: the browser may restore this page as it was left (busy), so reset it.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setGooglePhase("idle");
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function continueWithGoogle() {
    setGooglePhase("starting");
    const supabase = await createClient().catch(() => null);
    const to = supabase ? await startGoogleSignIn(supabase, { env: publicEnv(), currentOrigin: window.location.origin, next }) : null;
    if (!to) {
      setGooglePhase("unavailable");
      return;
    }
    // Stays "starting" while the browser leaves for Google.
    window.location.assign(to);
  }

  return (
    <BrandFrame title="Sign in" smallScreen footer={<span>Sign-in works on any screen. The workspace itself is built for screens 1280 px wide or more.</span>}>
      <div className="flex flex-col gap-4">
        {phase.kind === "sent" ? (
          <div className="flex flex-col gap-2" role="status" data-testid="login-sent">
            <StatusPill tone="good" icon={Mail}>
              Check your email
            </StatusPill>
            {/* A phone types the code from the email it is reading (WP-03 T4): the code first, the link second. */}
            {isViewportTooSmall(width) ? (
              <>
                <p className="text-body">
                  Type the 6-digit code we sent to <span className="font-medium text-primary">{phase.email}</span>.
                </p>
                <SignInCode email={phase.email} next={next} first />
                <p className="text-body text-secondary">Or open the link in that email on this device.</p>
                <Button variant="ghost" size="sm" className="min-h-tap" onClick={() => setPhase({ kind: "idle" })}>
                  Use a different address
                </Button>
              </>
            ) : (
              <>
                <p className="text-body">
                  Check <span className="font-medium text-primary">{phase.email}</span> for a sign-in link and open it in this browser: it signs you in to {APP_NAME} here. Reading it on another device? Type the code from the email below.
                </p>
                <Button variant="ghost" size="sm" className="min-h-tap" onClick={() => setPhase({ kind: "idle" })}>
                  Use a different address
                </Button>
                <SignInCode email={phase.email} next={next} />
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {linkProblem ? (
              <div className="flex flex-col gap-2" role="alert" data-testid="login-link-problem">
                <StatusPill tone="warn" icon={Unlink}>
                  {linkProblem.title}
                </StatusPill>
                <p className="text-body">{linkProblem.body}</p>
              </div>
            ) : null}
            {google ? (
              <>
                <div className="flex flex-col gap-2" data-testid="login-google">
                  <GoogleSignInButton onClick={() => void continueWithGoogle()} loading={googlePhase === "starting"} />
                  {googlePhase === "unavailable" ? (
                    <StatusPill tone="bad" role="alert" data-testid="login-google-error">
                      {GOOGLE_UNAVAILABLE_MESSAGE}
                    </StatusPill>
                  ) : null}
                </div>
                <div className="flex items-center gap-3" aria-hidden>
                  <Separator fade="both" className="min-w-0 flex-1" />
                  <span className="text-small text-secondary">or</span>
                  <Separator fade="both" className="min-w-0 flex-1" />
                </div>
              </>
            ) : null}
            <form onSubmit={submit} className="flex flex-col gap-3" data-testid="login-form">
              <Field htmlFor="login-email" label="Email" hint={supabaseReady ? undefined : "Email sign-in is not set up on this server yet."}>
                <Input id="login-email" controlSize="lg" wrapperClassName="min-h-tap" type="email" name="email" autoComplete="email" required icon={Mail} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!supabaseReady || phase.kind === "sending"} />
              </Field>
              {phase.kind === "error" ? (
                <StatusPill tone="bad" role="alert">
                  {phase.message}
                </StatusPill>
              ) : null}
              <Button type="submit" size="lg" variant="glass" className="min-h-tap" icon={Send} loading={phase.kind === "sending"} disabled={!supabaseReady || email.trim().length === 0}>
                Send sign-in link
              </Button>
              {supabaseReady ? (
                // How sign-in works, not tutoring: it stays whatever the guidance switch says (there is none signed out), and
                // ReassuranceLine's Undo / Settings icons mean "you can change this later", which this line is not.
                <p className="text-small text-secondary" data-testid="login-reassurance">
                  No password, no card. We email you a link.
                </p>
              ) : null}
              {supabaseReady ? (
                <p className="text-small text-secondary" data-testid="login-new-here">
                  {`New here? ${APP_NAME} lets new people in a few at a time. Signing in saves your place.`}
                </p>
              ) : null}
            </form>
            {/* Google's sign-in review and the EU and US privacy laws ask for the two documents where an account starts. The
                age is said here and confirmed once, with a box, after the first sign-in (0100): never on every sign-in. */}
            <p className="text-small text-secondary" data-testid="login-legal">
              {APP_NAME} is for people 18 or older: a new account confirms it once. By continuing, you agree to the{" "}
              <a href={LEGAL_ROUTES.terms} className="entity-link">
                Terms
              </a>
              . See how we handle your data in the{" "}
              <a href={LEGAL_ROUTES.privacy} className="entity-link">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        )}
        {devBypass ? (
          <form method="post" action="/auth/dev" className="flex flex-col gap-2 border-t border-line pt-4" data-testid="dev-bypass">
            <input type="hidden" name={NEXT_PARAM} value={next} />
            <p className="text-small text-secondary">For development: continue as the example founder, who owns the sample businesses.</p>
            <Button type="submit" size="lg" variant="default" className="min-h-tap" icon={Wrench}>
              Continue as developer
            </Button>
          </form>
        ) : null}
      </div>
    </BrandFrame>
  );
}
