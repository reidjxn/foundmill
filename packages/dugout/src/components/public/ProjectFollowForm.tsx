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
 * After a signup the form gives way to one line, "Thanks. {name} will be in touch.", and nothing else: never whether
 * the address was already on the list. A hidden field ("Leave this empty", `website`) is out of sight and out of the tab
 * order; a person never fills it in, and a filled one is answered the same and written nowhere.
 */
import { useId } from "react";
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
  className?: string;
}

/** The form's field names (the Server Action reads them). */
export const FOLLOW_FIELDS = { slug: "slug", email: "email", consent: "consent", trap: "website" } as const;

export function ProjectFollowForm({ name, slug, action, state = { status: "idle" }, pending = false, preview = false, className }: ProjectFollowFormProps) {
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
    <p role="status" className="t-body text-primary" data-follow-done="">
      {words.done}
    </p>
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
    <form {...shared} action={action} noValidate>
      {heading}
      {body}
    </form>
  );
}
