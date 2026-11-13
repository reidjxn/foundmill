/**
 * "Which one is for you?" on a project's public page (migration 0101; @foundmill/shared `page-quiz.ts`): an optional
 * quiz the founders turn on, built from their real customers and approved word by word. A visitor answers 2 to 4 short
 * questions and sees which offer probably fits them, with the page's own Follow form or the founders' own link. Every
 * offer stays in view below the questions, the result or not: nothing is hidden behind the quiz, nothing counts down,
 * nothing says how many others chose what.
 *
 * One column from 390 px, every answer and every action at least 44 px tall (`min-h-tap`). Native radio inputs and a
 * plain form, so it works before (or without) JavaScript: apps/web passes a Server Action as `action` and the state
 * `useActionState` returns, and the page comes back with the result. After a result the questions stay, with the
 * visitor's answers checked, so they can change one and look again. `preview` draws it with nothing to press, for the
 * console's phone preview.
 *
 * Presentational and server-safe (no hooks but useId, no handlers). Every string is a text node.
 */
import { useId } from "react";
import { ArrowUpRight } from "lucide-react";
import { PAGE_QUIZ_WORDS, type PageQuizDefinition, type PageQuizOffer } from "@foundmill/shared/page-quiz";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";

/** What the last submission came to. `answers` keeps the visitor's choices checked on the page that comes back. */
export type ProjectQuizState = { status: "idle" } | { status: "result"; type: string; answers: Record<string, string> } | { status: "error"; message: string; answers?: Record<string, string> };

export interface ProjectQuizProps {
  quiz: PageQuizDefinition & { slug?: string; version?: number };
  /** Whether the page carries its Follow form: an offer that points to it shows its button only then. */
  followForm: boolean;
  /** Where an offer's Follow button goes: the page's own form. */
  followHref?: string;
  action?: string | ((formData: FormData) => void | Promise<void>);
  state?: ProjectQuizState;
  pending?: boolean;
  preview?: boolean;
  className?: string;
}

/** The form's field names beside the question keys (`q1` … `q4`), which carry the chosen answer keys. */
export const QUIZ_FIELDS = { slug: "quiz_slug", version: "quiz_version" } as const;
/** The section's anchor on the page. */
export const QUIZ_ANCHOR = "quiz";

function OfferAction({ offer, followForm, followHref, preview }: { offer: PageQuizOffer; followForm: boolean; followHref: string; preview: boolean }) {
  const cls = "inline-flex min-h-tap items-center gap-1.5 self-start rounded-sm t-body text-primary underline decoration-line-strong underline-offset-4 transition-colors duration-hover hover:decoration-current focus-ring";
  if (offer.action.kind === "follow") {
    if (!followForm) return null;
    return preview ? (
      <span className="inline-flex min-h-tap items-center t-body text-secondary">{PAGE_QUIZ_WORDS.follow}</span>
    ) : (
      <a href={followHref} className={cls} data-quiz-offer-action="follow">
        {PAGE_QUIZ_WORDS.follow}
      </a>
    );
  }
  if (!offer.action.url) return null;
  return preview ? (
    <span className="inline-flex min-h-tap items-center t-body text-secondary">{offer.action.label}</span>
  ) : (
    <a href={offer.action.url} target="_blank" rel="noopener noreferrer nofollow" className={cls} data-quiz-offer-action="link">
      {offer.action.label}
      <Icon icon={ArrowUpRight} size="inline" />
    </a>
  );
}

export function ProjectQuiz({ quiz, followForm, followHref = "#follow", action, state = { status: "idle" }, pending = false, preview = false, className }: ProjectQuizProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const errorId = `${id}-error`;
  const result = state.status === "result" ? quiz.types.find((t) => t.key === state.type) ?? null : null;
  const resultOffer = result ? quiz.offers.find((o) => o.key === result.offer) ?? null : null;
  const chosen = state.status === "idle" ? {} : (state.answers ?? {});
  const offerFor = (key: string) => quiz.types.filter((t) => t.offer === key).map((t) => t.name);

  const questions = (
    <>
      {quiz.slug ? <input type="hidden" name={QUIZ_FIELDS.slug} value={quiz.slug} /> : null}
      {quiz.version ? <input type="hidden" name={QUIZ_FIELDS.version} value={String(quiz.version)} /> : null}
      {quiz.questions.map((q) => (
        <fieldset key={q.key} className="flex min-w-0 flex-col gap-1 border-0 p-0" data-quiz-question={q.key} disabled={preview}>
          <legend className="t-body mb-1 min-w-0 break-words font-medium text-primary">{q.text}</legend>
          {q.answers.map((a) => {
            const inputId = `${id}-${q.key}-${a.key}`;
            return (
              <label key={a.key} htmlFor={inputId} className={cn("flex min-h-tap items-center gap-3 rounded-sm px-1", preview ? "cursor-default" : "cursor-pointer")}>
                <span className="relative inline-grid size-check shrink-0 place-items-center">
                  <input
                    id={inputId}
                    type="radio"
                    name={q.key}
                    value={a.key}
                    required
                    defaultChecked={chosen[q.key] === a.key}
                    aria-describedby={state.status === "error" ? errorId : undefined}
                    className="check-box peer absolute inset-0 m-0 size-check appearance-none rounded-full focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span aria-hidden className="pointer-events-none relative hidden size-1.5 rounded-full bg-ink peer-checked:block" />
                </span>
                <span className="t-body min-w-0 break-words text-prose">{a.text}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
      {state.status === "error" ? (
        <p id={errorId} role="alert" className="t-body text-status-bad" data-quiz-error="">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" variant="tinted" size="lg" className="min-h-tap self-stretch @page-wide:self-start" disabled={preview} loading={pending}>
        {PAGE_QUIZ_WORDS.submit}
      </Button>
      <p className="t-small text-secondary">{preview ? PAGE_QUIZ_WORDS.previewNote : PAGE_QUIZ_WORDS.privacy}</p>
    </>
  );

  return (
    <section id={QUIZ_ANCHOR} aria-labelledby={headingId} className={cn("flex min-w-0 scroll-mt-6 flex-col gap-5 rounded-md border border-line bg-panel p-4 @page-wide:p-5", className)} data-project-quiz={result ? "result" : "questions"}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id={headingId} className="t-title min-w-0 break-words text-primary">
          {PAGE_QUIZ_WORDS.heading}
        </h2>
        <p className="t-body break-words text-secondary">{quiz.intro || PAGE_QUIZ_WORDS.intro}</p>
      </div>

      {result ? (
        <div role="status" className="flex min-w-0 flex-col gap-2 border-l-2 border-kit-primary pl-4" data-quiz-result={result.key}>
          <p className="t-label text-kit-lift">{PAGE_QUIZ_WORDS.result}</p>
          <p className="t-title min-w-0 break-words text-primary">{resultOffer?.title ?? result.name}</p>
          <p className="t-body break-words text-prose">{result.name}</p>
          {result.summary ? <p className="t-body break-words text-secondary">{result.summary}</p> : null}
          {resultOffer?.detail ? <p className="t-body break-words text-secondary">{resultOffer.detail}</p> : null}
          {resultOffer ? <OfferAction offer={resultOffer} followForm={followForm} followHref={followHref} preview={preview} /> : null}
        </div>
      ) : null}

      {preview ? (
        <div className="flex min-w-0 flex-col gap-4">{questions}</div>
      ) : (
        <form action={action} className="flex min-w-0 flex-col gap-4" data-quiz-form="">
          {questions}
        </form>
      )}

      <section aria-labelledby={`${id}-all`} className="flex min-w-0 flex-col gap-3 border-t border-line-faint pt-4" data-quiz-offers="">
        <h3 id={`${id}-all`} className="t-label text-secondary">
          {PAGE_QUIZ_WORDS.allOffers}
        </h3>
        <ul className="flex min-w-0 flex-col gap-3">
          {quiz.offers.map((o) => (
            <li key={o.key} className="flex min-w-0 flex-col gap-0.5" data-quiz-offer={o.key} data-match={resultOffer?.key === o.key ? "" : undefined}>
              <p className="t-body min-w-0 break-words font-medium text-primary">{o.title}</p>
              {o.detail ? <p className="t-body break-words text-secondary">{o.detail}</p> : null}
              {offerFor(o.key).length ? <p className="t-small break-words text-tertiary">{offerFor(o.key).join(" · ")}</p> : null}
              <OfferAction offer={o} followForm={followForm} followHref={followHref} preview={preview} />
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
