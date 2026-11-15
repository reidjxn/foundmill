"use client";
/**
 * The public page's "Follow" form (package 1.6), wired: the design system's `ProjectFollowForm` with the Server Action
 * and the state `useActionState` keeps.
 *
 * The bot check (security audit 2026-11-13, finding 10): Cloudflare Turnstile, as the idea box does it
 * (components/landing/idea-box/turnstile.ts). The script loads on the first focus inside the form; on submit the
 * invisible widget gives one token for the `page_follow` action, the form posts it with the fields, and the api checks
 * it through the gateway before anything is recorded or sent. No token (the script blocked, the check failed): the
 * form says so in plain words and nothing is sent. Without JavaScript the form still posts to the same action, which
 * answers the same sentence, since the check cannot run without it.
 */
import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { FOLLOW_FIELDS, ProjectFollowForm, type ProjectFollowFormProps, type ProjectFollowState } from "@foundmill/dugout";
import { FOLLOW_ERRORS, FOLLOW_TURNSTILE_ACTION } from "@foundmill/shared/project-page";
import { followProject } from "@/app/p/[slug]/actions";
import { loadTurnstile, turnstileToken } from "@/components/landing/idea-box/turnstile";
import { publicEnv } from "@/lib/env";

const IDLE: ProjectFollowState = { status: "idle" };
const TOKEN_TIMEOUT_MS = 15_000;

export function FollowProjectForm({ name, slug, builtOn = null }: { name: string; slug: string; builtOn?: ProjectFollowFormProps["builtOn"] }) {
  const [state, action, pending] = useActionState(followProject, IDLE);
  const [checking, setChecking] = useState(false);
  // A refusal the browser gives before anything is posted (no token); cleared by the next try.
  const [local, setLocal] = useState<ProjectFollowState | null>(null);
  const widget = useRef<HTMLDivElement>(null);
  const siteKey = publicEnv().turnstileSiteKey;

  const warm = () => {
    if (siteKey) void loadTurnstile();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (checking || pending) return;
    const form = new FormData(event.currentTarget);
    setLocal(null);
    setChecking(true);
    void turnstileToken(siteKey, widget.current, TOKEN_TIMEOUT_MS, FOLLOW_TURNSTILE_ACTION).then((token) => {
      setChecking(false);
      if (!token) {
        const email = form.get(FOLLOW_FIELDS.email);
        setLocal({ status: "error", field: null, message: FOLLOW_ERRORS.unverified, email: typeof email === "string" ? email : "" });
        return;
      }
      form.set(FOLLOW_FIELDS.turnstile, token);
      startTransition(() => action(form));
    });
  };

  return <ProjectFollowForm name={name} slug={slug} action={action} state={local ?? state} pending={pending || checking} builtOn={builtOn} onSubmit={submit} onFocus={warm} widgetRef={widget} />;
}
