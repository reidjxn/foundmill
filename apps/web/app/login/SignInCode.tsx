"use client";
/**
 * The six-digit code from the sign-in email, typed here (founder, 2026-11-13; docs/IDEA_BOX.md): for a person who reads
 * their email on another device, or whose mail app opens links in its own browser. Supabase's `verifyOtp` with the
 * address the link went to; on success the browser goes to `next` (the same place the link would have sent it). The
 * email carries the same code (DEPLOY §4, the Magic Link template's `{{ .Token }}`).
 */
import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { Button, Field, Input, StatusPill } from "@foundmill/dugout";
import { createClient } from "@/lib/supabase/client";

export const CODE_LENGTH = 6;

export const SIGN_IN_CODE_WORDS = {
  label: "Or type the code from the email",
  /** The label when the code comes first (a small screen, WP-03 T4): nothing above it to say "or" to. */
  firstLabel: "The code from the email",
  submit: "Sign in with the code",
  wrong: "That code did not work. Check the newest email, or send a new link.",
  failed: "We could not check the code. Try again in a minute.",
} as const;

/** Only digits, at most six. */
export const cleanCode = (raw: string): string => raw.replace(/\D/g, "").slice(0, CODE_LENGTH);

export function SignInCode({ email, next, first = false, go = (to) => window.location.assign(to) }: { email: string; next: string; first?: boolean; go?: (to: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== CODE_LENGTH) return;
    setBusy(true);
    setProblem(null);
    const supabase = await createClient().catch(() => null);
    if (!supabase) {
      setBusy(false);
      setProblem(SIGN_IN_CODE_WORDS.failed);
      return;
    }
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" }).catch((err: unknown) => ({ error: err as { status?: number } }));
    if (error) {
      setBusy(false);
      const status = (error as { status?: number }).status;
      setProblem(status && status >= 400 && status < 500 ? SIGN_IN_CODE_WORDS.wrong : SIGN_IN_CODE_WORDS.failed);
      return;
    }
    go(next);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-4" data-testid="login-code">
      <Field htmlFor="login-code" label={first ? SIGN_IN_CODE_WORDS.firstLabel : SIGN_IN_CODE_WORDS.label}>
        <Input
          id="login-code"
          controlSize="lg"
          wrapperClassName="min-h-tap"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH}
          placeholder="123456"
          icon={KeyRound}
          value={code}
          onChange={(e) => setCode(cleanCode(e.target.value))}
          disabled={busy}
          className="font-mono tracking-[0.3em]"
        />
      </Field>
      {problem ? (
        <StatusPill tone="bad" role="alert">
          {problem}
        </StatusPill>
      ) : null}
      <Button type="submit" size="lg" variant="default" className="min-h-tap" loading={busy} disabled={code.length !== CODE_LENGTH}>
        {SIGN_IN_CODE_WORDS.submit}
      </Button>
    </form>
  );
}
