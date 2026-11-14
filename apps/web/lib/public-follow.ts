/**
 * The "Follow" form of a public page (package 1.6), its server half without the network: what the Server Action
 * (app/p/[slug]/actions.ts) reads from the posted form, and which shared sentence a refusal from the api becomes.
 * The visitor never reads the api's own message, and never anything that says whether the address was already there.
 */
import { FOLLOW_EMAIL_MAX, FOLLOW_ERRORS, type FollowErrorKind } from "@foundmill/shared/project-page";
import type { ProjectFollowState } from "@foundmill/dugout";
import { appErrorCode, trpcErrorCode } from "./trpc";

export interface FollowFormInput {
  slug: string;
  email: string;
  consent: boolean;
  /** The hidden field; a person leaves it empty. */
  website: string;
  /** The bot check's token (Turnstile); empty without JavaScript, which the api refuses. */
  turnstile: string;
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : "";
};

/** The four fields and the bot check's token, bounded (the api checks them again). The box posts "yes" when it is ticked. */
export function readFollowForm(form: FormData): FollowFormInput {
  return { slug: field(form, "slug", 80).trim(), email: field(form, "email", FOLLOW_EMAIL_MAX + 10).trim(), consent: form.get("consent") === "yes", website: field(form, "website", 500), turnstile: field(form, "turnstile", 2048).trim() };
}

/** What can be told before asking the api: an empty address or an unticked box. Null when it may be sent. */
export function followFormProblem(input: FollowFormInput): ProjectFollowState | null {
  if (!input.email) return { status: "error", field: "email", message: FOLLOW_ERRORS.email, email: input.email };
  if (!input.consent) return { status: "error", field: "consent", message: FOLLOW_ERRORS.consent, email: input.email };
  return null;
}

/** The visitor's sentence for an api refusal. */
export function followErrorKind(err: unknown): FollowErrorKind {
  const app = appErrorCode(err);
  const code = trpcErrorCode(err);
  if (app === "follow_email") return "email";
  if (app === "follow_consent") return "consent";
  if (app === "follow_closed" || code === "NOT_FOUND") return "closed";
  if (app === "follow_unverified") return "unverified";
  if (app === "follow_unavailable") return "unavailable";
  if (app === "rate_limited" || code === "TOO_MANY_REQUESTS") return "busy";
  return "failed";
}

/** The state the form shows after an api refusal: the sentence, the field it is about, the visitor's own address back. */
export function followErrorState(err: unknown, email: string): ProjectFollowState {
  const kind = followErrorKind(err);
  return { status: "error", field: kind === "email" || kind === "consent" ? kind : null, message: FOLLOW_ERRORS[kind], email };
}
