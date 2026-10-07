"use client";
/**
 * Magic-link sign-in (Supabase `signInWithOtp` with `emailRedirectTo` → /auth/callback) and, in development/test
 * only, the dev bypass button (POST /auth/dev sets the cookie apps/api and apps/stream map to DEV_AUTH_USER_ID).
 */
import { Mail, Send, Wrench } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { APP_NAME } from "@foundmill/config";
import { Button, Field, Input, StatusPill } from "@foundmill/dugout";
import { NEXT_PARAM } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/redirects";
import { hasSupabase, isDevLike } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { BrandFrame } from "@/components/shell/BrandFrame";

type Phase = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get(NEXT_PARAM));
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const supabaseReady = hasSupabase();
  const devBypass = isDevLike();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    if (!supabase) {
      setPhase({ kind: "error", message: "Sign-in is not configured for this environment." });
      return;
    }
    setPhase({ kind: "sending" });
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set(NEXT_PARAM, next);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback.toString() } });
    if (error) setPhase({ kind: "error", message: error.message });
    else setPhase({ kind: "sent", email: email.trim() });
  }

  return (
    <BrandFrame footer={<span>Desktop only · minimum 1280 px · {APP_NAME} sends a sign-in link, never a password.</span>}>
      <div className="flex h-8 items-center border-b border-subtle bg-panel-alt px-3">
        <span className="t-label">Sign in</span>
      </div>
      <div className="flex flex-col gap-4 p-5">
        {phase.kind === "sent" ? (
          <div className="flex flex-col gap-2" role="status" data-testid="login-sent">
            <StatusPill tone="good" icon={Mail}>
              Link sent
            </StatusPill>
            <p className="text-body">
              Check <span className="font-medium text-primary">{phase.email}</span> for a sign-in link. It opens {APP_NAME} on this device.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: "idle" })}>
              Use a different address
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3" data-testid="login-form">
            <Field htmlFor="login-email" label="Work email" hint={supabaseReady ? "We email a one-time link. No password." : "Supabase Auth is not configured in this environment."}>
              <Input id="login-email" type="email" name="email" autoComplete="email" required icon={Mail} placeholder="founder@company.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!supabaseReady || phase.kind === "sending"} />
            </Field>
            {phase.kind === "error" ? (
              <StatusPill tone="bad" role="alert">
                {phase.message}
              </StatusPill>
            ) : null}
            <Button type="submit" variant="primary" icon={Send} loading={phase.kind === "sending"} disabled={!supabaseReady || email.trim().length === 0}>
              Send sign-in link
            </Button>
          </form>
        )}
        {devBypass ? (
          <form method="post" action="/auth/dev" className="flex flex-col gap-2 border-t border-subtle pt-4" data-testid="dev-bypass">
            <input type="hidden" name={NEXT_PARAM} value={next} />
            <p className="text-small text-secondary">Development only: continue as the seeded founder (DEV_AUTH_USER_ID on the API).</p>
            <Button type="submit" variant="default" icon={Wrench}>
              Continue as developer
            </Button>
          </form>
        ) : null}
      </div>
    </BrandFrame>
  );
}
