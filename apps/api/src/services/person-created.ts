/**
 * What must happen once when a person's profile is first created: the one place for it. `founder.profile.update` calls
 * `onPersonCreated` on the save that creates the profile, after the profile is saved, and on no other save.
 *
 * The steps, in order (`PERSON_CREATED_STEPS`):
 *   1. `invitation_attribution`: when the person accepted an invitation before their profile existed, the person who
 *      invited them is credited (`recordInvitationAttribution`, ./attribution);
 *   2. `signup_attribution`: who or what brought the person (`recordSignupAttribution`, ./attribution), from `via`,
 *      when the first step recorded nothing (an account is attributed once).
 * `ideaDraftToken` is accepted and passed to every step, and no step reads it yet: the step that claims an idea drafted
 * before sign-up (`claimIdeaDraft`) is added to the list by the change that builds it.
 *
 * The rules every step is held to:
 *   - **its own transaction.** A step opens its own on `deps.db`; nothing here opens one around the steps, so what one
 *     step wrote stays written whatever happens to the next;
 *   - **its own try/catch.** A step that throws is logged and the next one runs. `onPersonCreated` never throws, so no
 *     step can fail the profile save, and it answers nothing, so no step can change the save's answer;
 *   - **a failure is logged with the account id, the step's name and a reason code, and nothing else.** Never an input
 *     value: `via` is whatever a stranger typed into an address and `ideaDraftToken` is a secret that claims a draft.
 *     The reason is the error's class name when it is a plain word, and never its message (a failed query's text
 *     carries its parameters);
 *   - **inline, once.** The steps run in the request that created the profile. Nothing here starts a timer, a poller
 *     or a background query on the api's database pool, and a step must not either.
 */
import type { Db } from "@foundmill/db";
import { recordInvitationAttribution, recordSignupAttribution } from "./attribution";
import type { ApiLogger } from "./log";

export interface PersonCreatedDeps {
  /** The service connection. */
  db: Db;
  log: ApiLogger;
}

/** The longest `ideaDraftToken` the save accepts; anything longer is refused before anything is read. */
export const IDEA_DRAFT_TOKEN_MAX_LENGTH = 200;

/** What the save that created the profile was handed for the steps. Both are untrusted: each step checks its own. */
export interface PersonCreatedInput {
  /** The reference the person first arrived with (@foundmill/shared/via). */
  via?: unknown;
  /** The token of an idea drafted before sign-up. No step reads it yet. */
  ideaDraftToken?: unknown;
}

export interface PersonCreatedStep {
  /** A lowercase word for the logs: which step failed. */
  name: string;
  /** Opens its own transaction on `deps.db`. May throw: the caller logs it and carries on. */
  run(deps: PersonCreatedDeps, userId: string, input: PersonCreatedInput): Promise<void>;
}

/** The steps, in the order they run. Append a step here; never reorder one in front of another that it depends on. */
export const PERSON_CREATED_STEPS: readonly PersonCreatedStep[] = [
  // An accepted invitation outranks the cookie's reference: the attribution is written once, so the first step wins.
  { name: "invitation_attribution", run: (deps, userId) => recordInvitationAttribution(deps, userId) },
  { name: "signup_attribution", run: (deps, userId, input) => recordSignupAttribution(deps, userId, input.via) },
];

/** A reason code for the log: the error's class name when it is a plain word, never its message or any other field. */
const reasonOf = (err: unknown): string => (err instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(err.name) ? err.name : "unknown");

/**
 * Runs every step for the person whose profile was just created. Never throws and answers nothing. `steps` is the
 * list above; a test passes its own.
 */
export async function onPersonCreated(deps: PersonCreatedDeps, userId: string, input: PersonCreatedInput, steps: readonly PersonCreatedStep[] = PERSON_CREATED_STEPS): Promise<void> {
  for (const step of steps) {
    try {
      await step.run(deps, userId, input);
    } catch (err) {
      try {
        deps.log.warn({ userId, step: step.name, reason: reasonOf(err) }, "a step after the profile was created did not finish");
      } catch {
        // A logger that fails must not stop the remaining steps or fail the save.
      }
    }
  }
}
