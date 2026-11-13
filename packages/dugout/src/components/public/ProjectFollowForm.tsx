/**
 * "Follow {name}" on a project's public page (docs/THESIS_REVIEW.md package 1.6; DESIGN §9b): a visitor leaves an
 * email address and ticks a box agreeing to hear from the project. One column from 390 px, every control at least
 * 44 px tall (`min-h-tap`), plain words around the project's name (`followWords` in @foundmill/shared).
 *
 * Presentational and server-safe (no hooks but useId, no handlers): the caller owns the submission. On the public route
 * apps/web passes a Server Action as `action` and the state `useActionState` returns, so the form posts and answers
 * without JavaScript too (a native checkbox, not the Radix one, for that reason). `preview` draws it disabled, with no
 * form element at all, for the console's phone preview.
 *
 * After a signup the form gives way to one line, "Check your email to confirm. {name} will only write to you after you
 * do." (double opt-in): never whether the address was already on the list. For a visitor to a project on the free plan
 * one small line follows it, `builtOn` ("{name} is built on Foundmill. Start your own"; docs/NETWORK.md F2): the
 * moment a visitor is most glad of the project, and one its founders never meet on their own page. A hidden field ("Leave this empty", `website`) is out of sight and out of the tab
 * order; a person never fills it in, and a filled one is answered the same and written nowhere.
 *
 * The bot check (security audit 2026-11-13, finding 10) is the caller's: `onSubmit` gets a token before the action
 * runs, `onFocus` may warm its script, and `widgetRef` is the box its widget draws in, inside the form, at most the
 * column's width, and taking no room while it has nothing to show.
 */
import { useId, type FocusEventHandler, type FormEventHandler, type Ref } from "react";
import { Check } from "lucide-react";
import { FOLLOW_EMAIL_MAX, followWords } from "@foundmill/shared/project-page";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { Input } from "../foundation/Input";

/** What the last submission came to. `email` puts the visitor's own address back in the field after an error. */
export type ProjectFollowState = { status: "idle" } | { status: "done" } | { status: "error"; message: string; field?: "email" | "consent" | null; email?: string };

export interface ProjectFollowFormProps {
  /** The project's name, as the page shows it. */
  name: string;
  /** The page's address, posted with the form. */
  slug?: string;
  /** A Server Action (or a URL) the form posts to. */
  action?: string | ((formData: FormData) => void | Promise<void>);
  state?: ProjectFollowState;
  /** True while the submission is on its way: the button says so and does not take a second press. */
  pending?: boolean;
  /** The console's preview: drawn as it looks, nothing can be typed or sent. */
  preview?: boolean;
  /** The line under the "check your email" answer: a sentence and one link. Nothing when left out. */
  builtOn?: { line: string; linkLabel: string; href: string } | null;
  /** Runs before the action (the bot check gets its token here, then submits); without JavaScript the form posts as it is. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Focus inside the form (the bot check loads its script). */
  onFocus?: FocusEventHandler<HTMLFormElement>;
  /** The box the bot check's widget draws in, inside the form under the button; it takes no room while empty. */
  widgetRef?: Ref<HTMLDivElement>;
  className?: string;
}

/** The form's field names (the Server Action reads them). `turnstile` carries the bot check's token. */
export const FOLLOW_FIELDS = { slug: "slug", email: "email", consent: "consent", trap: "website", turnstile: "turnstile" } as const;

export function ProjectFollowForm({ name, slug, action, state = { status: "idle" }, pending = false, preview = false, builtOn = null, onSubmit, onFocus, widgetRef, className }: ProjectFollowFormProps) {
  const id = useId();
  const words = followWords(name);
  const headingId = `${id}-heading`;
  const emailId = `${id}-email`;
  const consentId = `${id}-consent`;
  const errorId = `${id}-error`;
  const done = state.status === "done";
  const error = state.status === "error" ? state : null;
  const disabled = preview;

  const body = done ? (
    <>
      <p role="status" className="t-body text-primary" data-follow-done="">
        {words.done}
      </p>
      {builtOn ? (
        <p className="t-small flex min-w-0 flex-wrap items-center gap-x-1.5 break-words text-secondary" data-follow-built-on="">
          <span>{builtOn.line}</span>
          <a href={builtOn.href} className="inline-flex min-h-tap items-center rounded-sm text-primary underline decoration-line-strong underline-offset-4 transition-colors duration-hover hover:decoration-current focus-ring">
            {builtOn.linkLabel}
          </a>
        </p>
      ) : null}
    </>
  ) : (
    <>
      <p className="t-body text-secondary">{words.line}</p>
      {slug ? <input type="hidden" name={FOLLOW_FIELDS.slug} value={slug} /> : null}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={emailId} className="t-label text-secondary">
          {words.emailLabel}
        </label>
        <Input
          id={emailId}
          name={FOLLOW_FIELDS.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={FOLLOW_EMAIL_MAX}
          defaultValue={error?.email ?? ""}
          controlSize="xl"
          invalid={error?.field === "email"}
          aria-describedby={error ? errorId : undefined}
          disabled={disabled}
          wrapperClassName="min-h-tap"
        />
      </div>
      <label htmlFor={consentId} className={cn("flex min-h-tap items-start gap-3 py-1", preview ? "cursor-default" : "cursor-pointer")}>
        <span className="relative mt-0.5 inline-grid size-check shrink-0 place-items-center">
          <input
            id={consentId}
            name={FOLLOW_FIELDS.consent}
            type="checkbox"
            value="yes"
            required
            disabled={disabled}
            aria-invalid={error?.field === "consent" || undefined}
            aria-describedby={error ? errorId : undefined}
            className="check-box peer absolute inset-0 m-0 size-check appearance-none rounded-xs focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Icon icon={Check} size={12} strokeWidth={2.75} className="pointer-events-none relative hidden text-ink peer-checked:inline-flex" />
        </span>
        <span className="t-body min-w-0 break-words text-prose">{words.consent}</span>
      </label>
      {/* Out of sight and out of the tab order: a person never fills it in. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor={`${id}-trap`}>{words.trap}</label>
        <input id={`${id}-trap`} name={FOLLOW_FIELDS.trap} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="t-body text-status-bad" data-follow-error="">
          {error.message}
        </p>
      ) : null}
      <Button type="submit" variant="tinted" size="lg" className="min-h-tap self-stretch @page-wide:self-start" disabled={preview} loading={pending}>
        {words.button}
      </Button>
      {widgetRef ? <div ref={widgetRef} className="min-w-0 max-w-full overflow-hidden empty:hidden" data-follow-widget="" /> : null}
    </>
  );

  const shared = { "aria-labelledby": headingId, className: cn("flex min-w-0 flex-col gap-4 rounded-md border border-line bg-panel p-4 @page-wide:p-5", className), "data-project-follow": done ? "done" : "form" };
  const heading = (
    <h2 id={headingId} className="t-title min-w-0 break-words text-primary">
      {words.heading}
    </h2>
  );
  if (preview || done) {
    return (
      <section {...shared} data-preview={preview ? "" : undefined}>
        {heading}
        {body}
      </section>
    );
  }
  return (
    <form {...shared} action={action} onSubmit={onSubmit} onFocus={onFocus} noValidate>
      {heading}
      {body}
    </form>
  );
}
