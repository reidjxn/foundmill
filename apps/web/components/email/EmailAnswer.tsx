"use client";
/**
 * `/a/<token>`: a one-click answer from a founder email (retention plan, 2026-11-11). Opening the page changes nothing:
 * it says what the answer does and waits for the button, so a mail scanner that follows links answers nothing. The
 * button sends `email.action.answer`, which checks everything again and answers as the founder the email went to.
 *
 * The same page serves the one-click cancel of a deletion (security review P2-3; `kind: "cancel_deletion"`): the link in
 * the founder notice a founder someone else demoted or removed in the last 7 days gets while a deletion of that project
 * waits. It says which project, when it is deleted and until when they can stop it, and that stopping it gives them
 * nothing else back; the button (a POST) cancels once, as them. Works from 390 px, signed in or not.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import { Button, EmptyState, formatDate, formatDateTime, useDateFormat } from "@foundmill/dugout";
import { APP_NAME } from "@foundmill/config";
import { cancelLinkWords, FORMER_PROJECT_CARD } from "@foundmill/shared";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { useTRPC } from "@/lib/trpc-react";

export type EmailActionState = "ready" | "answered" | "canceled" | "used" | "expired" | "unavailable";

/** The page's words for each state (exported for the unit test). */
export function answerWords(state: EmailActionState, opts: { requiresConfirmation?: boolean; justAnswered?: boolean } = {}): { title: string; description: string } {
  switch (state) {
    case "ready":
      return { title: "Answer from your email", description: "This gives the recommended answer. You can change it later in the Inbox." };
    case "answered":
      if (opts.justAnswered && opts.requiresConfirmation) return { title: "Answer saved", description: "Part of it needs your go-ahead first, because it is outside what the team may do on its own. Confirm it in the Inbox." };
      return opts.justAnswered ? { title: "Done", description: "Your team has your answer and carries on." } : { title: "Already answered", description: "This decision was answered in the app." };
    case "used":
      return { title: "Already answered", description: "This link has been used. Each one-click answer works once." };
    case "expired":
      return { title: "This link has expired", description: "One-click answers work for 48 hours. Answer in the Inbox instead." };
    default:
      return { title: "This link no longer works", description: "The decision changed or you no longer run this business. Answer in the Inbox instead." };
  }
}

export function EmailAnswer({ token }: { token: string }) {
  const trpc = useTRPC();
  const datePrefs = useDateFormat();
  const info = useQuery(trpc.email.action.get.queryOptions({ token }));
  const answer = useMutation(trpc.email.action.answer.mutationOptions());
  const data = answer.data ?? info.data;
  const state = (data?.state ?? "unavailable") as EmailActionState;
  if (data?.kind === "cancel_deletion") {
    const cancelState = state === "answered" ? "canceled" : (state as Parameters<typeof cancelLinkWords>[0]);
    const justCanceled = answer.isSuccess && answer.data?.state === "canceled" && answer.data.businessName !== null;
    const words = cancelLinkWords(cancelState, { justCanceled });
    const project = data.businessName;
    return (
      <BrandFrame title={project ?? "Cancel the deletion"}>
        <div data-testid="email-answer" data-kind="cancel_deletion" data-state={cancelState}>
          <EmptyState
            icon={cancelState === "canceled" ? Check : ArrowRight}
            title={words.title}
            actions={
              cancelState === "ready" ? (
                <Button size="sm" variant="primary" icon={Check} loading={answer.isPending} onClick={() => answer.mutate({ token })}>
                  {FORMER_PROJECT_CARD.button}
                </Button>
              ) : (
                <Button asChild size="sm" variant="secondary" iconRight={ArrowRight}>
                  <a href="/">{`Go to ${APP_NAME}`}</a>
                </Button>
              )
            }
          >
            {cancelState === "ready" && project && data.scheduledFor && data.until ? (
              <p className="mb-2 text-body-strong text-primary">{FORMER_PROJECT_CARD.body({ scheduledFor: formatDate(data.scheduledFor, "date", datePrefs), until: formatDateTime(data.until, datePrefs) })}</p>
            ) : null}
            {words.description}
          </EmptyState>
        </div>
      </BrandFrame>
    );
  }
  const words = answerWords(state, { requiresConfirmation: answer.data?.requiresConfirmation, justAnswered: answer.isSuccess && answer.data?.state === "answered" });
  const inbox = data?.businessId ? `/b/${data.businessId}/inbox${data.itemId ? `/${data.itemId}` : ""}` : "/";

  if (info.isPending) return <BrandFrame title="Answer from your email">Loading…</BrandFrame>;
  return (
    <BrandFrame title={data?.businessName ?? "Answer from your email"}>
      <div data-testid="email-answer" data-state={state}>
        <EmptyState
          icon={state === "answered" ? Check : ArrowRight}
          title={words.title}
          actions={
            state === "ready" ? (
              <Button size="sm" variant="primary" icon={Check} loading={answer.isPending} onClick={() => answer.mutate({ token })}>
                {`Answer “${data?.optionLabel ?? ""}”`}
              </Button>
            ) : (
              <Button asChild size="sm" variant="secondary" iconRight={ArrowRight}>
                <a href={inbox}>Open the Inbox</a>
              </Button>
            )
          }
        >
          {data?.subject ? <p className="mb-2 text-body-strong text-primary">{data.subject}</p> : null}
          {state === "ready" && data?.consequence ? <p className="mb-2">{data.consequence}</p> : null}
          {words.description}
        </EmptyState>
      </div>
    </BrandFrame>
  );
}
