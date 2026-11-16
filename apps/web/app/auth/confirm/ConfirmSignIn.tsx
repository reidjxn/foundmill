"use client";
/**
 * One button between the sign-in email and Supabase (lib/auth/confirm-link.ts): pressing it opens the confirmation
 * link, which signs the person in and returns to /auth/callback as before. The link works once, so nothing here opens it
 * on its own: no redirect, no link to follow, and no script-free fallback, since the mail services that open links ahead
 * of the reader are exactly the visitors who run no script. Works from 390 px like the sign-in page.
 */
import { LogIn } from "lucide-react";
import { useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { Button } from "@foundmill/dugout";
import { BrandFrame } from "@/components/shell/BrandFrame";

export const CONFIRM_SIGN_IN_WORDS = {
  title: "Sign in",
  body: `Press the button to finish signing in to ${APP_NAME} on this device.`,
  why: "This one press keeps the link for you: some mail services open every link in an email before you do, and this one works once.",
  button: `Sign in to ${APP_NAME}`,
  notYou: "If you did not ask to sign in, close this page. Nothing happens until the button is pressed.",
} as const;

export function ConfirmSignIn({ link, go = (to) => window.location.assign(to) }: { link: string; go?: (to: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <BrandFrame title={CONFIRM_SIGN_IN_WORDS.title} smallScreen footer={<span>Sign-in works on any screen. The workspace itself is built for screens 1280 px wide or more.</span>}>
      <div className="flex flex-col gap-4" data-testid="confirm-sign-in">
        <p className="text-body">{CONFIRM_SIGN_IN_WORDS.body}</p>
        <Button
          size="lg"
          variant="glass"
          className="min-h-tap"
          icon={LogIn}
          loading={busy}
          onClick={() => {
            setBusy(true);
            go(link);
          }}
        >
          {CONFIRM_SIGN_IN_WORDS.button}
        </Button>
        <p className="text-small text-secondary">{CONFIRM_SIGN_IN_WORDS.why}</p>
        <p className="text-small text-secondary">{CONFIRM_SIGN_IN_WORDS.notYou}</p>
      </div>
    </BrandFrame>
  );
}
