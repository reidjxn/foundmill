"use client";
/**
 * The founder's sign-off of the specification and the roadmap on the Product tabs (founder, 2026-10-18). `useSignoffs`
 * reads `product.signoff.get` and refreshes on `product.signoff_decided`; `SignoffBanner` is the compact panel at the
 * top of the Specification and Roadmap tabs: the status pill ("Awaiting your sign-off", "Signed off Oct 18, 2026 · v2",
 * "Changes requested") and, for people who may change the Product section, Approve and Request changes (a dialog that
 * needs the founder's words). Both go through `product.signoff.decide`, the same implementation the Inbox note runs.
 */
import { useState } from "react";
import { Check, MessageSquareText } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Panel, StatusPill, Term, Textarea, useFormatters, type StatusTone } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetQuery } from "@foundmill/widgets";
import { InlineError, useAction } from "./shared";
import type { SignoffView, SignoffViews } from "./types";

export const SIGNOFF_PATH = "product.signoff.get";

export type SignoffKind = "spec" | "roadmap";

const WORDS: Record<SignoffKind, { the: string; title: string; approve: string }> = {
  spec: { the: "the specification", title: "Specification sign-off", approve: "Approve the specification" },
  roadmap: { the: "the roadmap", title: "Roadmap sign-off", approve: "Approve the roadmap" },
};

/** The pill's tone and word for a round (null when nothing was asked: a business from before sign-offs, or still drafting). */
export function signoffStatusWord(view: SignoffView | null | undefined, formatDate: (d: string | Date) => string): { tone: StatusTone; word: string; actionable: boolean } | null {
  if (!view) return null;
  switch (view.status) {
    case "approved":
      return { tone: "good", word: `Signed off${view.decidedAt ? ` ${formatDate(view.decidedAt)}` : ""}${view.specVersion ? ` · v${view.specVersion}` : ""}`, actionable: false };
    case "changes_requested":
      return { tone: "warn", word: "Changes requested", actionable: true };
    case "declined":
      return { tone: "neutral", word: "Declined", actionable: false };
    default:
      return { tone: "warn", word: "Awaiting your sign-off", actionable: true };
  }
}

/** One line for the Vision tab: "Specification: signed off · Roadmap: awaiting your sign-off". */
export function signoffSummaryLine(views: Pick<SignoffViews, "spec" | "roadmap"> | undefined): string | null {
  if (!views || (!views.spec && !views.roadmap)) return null;
  const word = (v: SignoffView | null) => (!v ? "not asked yet" : v.status === "approved" ? "signed off" : v.status === "changes_requested" ? "changes requested" : v.status === "declined" ? "declined" : "awaiting your sign-off");
  return `Specification: ${word(views.spec)} · Roadmap: ${word(views.roadmap)}`;
}

/** Reads the sign-offs and refreshes them when one is decided (from the Inbox, another tab or the api). */
export function useSignoffs() {
  const q = useWidgetQuery<SignoffViews>(SIGNOFF_PATH, {});
  useBusinessEvents(() => q.refetch(), ["product.signoff_decided", "spec.version_published"]);
  return q;
}

export interface SignoffBannerProps {
  kind: SignoffKind;
  signoffs: ReturnType<typeof useSignoffs>;
  canWrite: boolean;
  /** Called after a decision landed (the tab reloads what it shows). */
  onDecided?: () => void;
}

export function SignoffBanner({ kind, signoffs, canWrite, onDecided }: SignoffBannerProps) {
  const { formatDate } = useFormatters();
  const action = useAction();
  const [changesOpen, setChangesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const view = kind === "spec" ? signoffs.data?.spec : signoffs.data?.roadmap;
  const status = signoffStatusWord(view, formatDate);
  if (!view || !status) return null;
  const words = WORDS[kind];
  const decide = async (decision: "approve" | "request_changes") => {
    await action.run("product.signoff.decide", { kind, decision, ...(decision === "request_changes" ? { notes: notes.trim() } : {}) }, {
      key: decision,
      then: () => {
        setChangesOpen(false);
        setNotes("");
        signoffs.refetch();
        onDecided?.();
      },
    });
  };
  const line =
    view.status === "approved"
      ? `You approved ${words.the}${view.specVersion ? ` as version ${view.specVersion}` : ""}${view.decidedAt ? ` on ${formatDate(view.decidedAt)}` : ""}. Later changes arrive as proposals you accept.`
      : view.status === "changes_requested"
        ? `You asked for changes${view.notes ? `: “${view.notes.length > 140 ? `${view.notes.slice(0, 140)}…` : view.notes}”` : ""}. The Product lead revises ${words.the}; approve it here once it reads right.`
        : `Round ${view.round}: read ${words.the} and approve it, or ask for changes in your own words. Building starts when the specification and the roadmap are both signed off.`;
  return (
    <Panel
      title={
        <>
          {words.title.replace(/ sign-off$/, "")} <Term id="sign_off">sign-off</Term>
        </>
      }
      span={12}
      data-testid="signoff-banner"
      data-signoff-kind={kind}
      data-signoff-status={view.status}
      actions={
        <>
          <StatusPill tone={status.tone} data-testid="signoff-pill">
            {status.word}
          </StatusPill>
          {canWrite && status.actionable ? (
            <>
              <Button size="sm" variant="ghost" icon={MessageSquareText} onClick={() => setChangesOpen(true)} data-testid="signoff-request-changes">
                Request changes
              </Button>
              <Button size="sm" variant="primary" icon={Check} onClick={() => void decide("approve")} loading={action.pending === "approve"} data-testid="signoff-approve">
                Approve
              </Button>
            </>
          ) : null}
        </>
      }
      footer={action.error ? <InlineError error={action.error} /> : undefined}
    >
      <p className="text-body text-secondary">{line}</p>

      <Dialog open={changesOpen} onOpenChange={setChangesOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>What should change?</DialogTitle>
            <DialogDescription>Your words go to the Product lead as a revision task, and you are asked to sign off again once {words.the} is revised.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label htmlFor={`signoff-notes-${kind}`} className="t-label mb-1 block">
              Changes (required)
            </label>
            <Textarea id={`signoff-notes-${kind}`} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === "spec" ? "Shorten the pricing section and name the two launch markets." : "Move billing ahead of onboarding; drop the reporting item from Now."} maxLength={2000} data-testid="signoff-notes" />
          </DialogBody>
          <DialogFooter>
            <InlineError error={action.error} />
            <Button variant="ghost" onClick={() => setChangesOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={MessageSquareText} disabled={!notes.trim()} loading={action.pending === "request_changes"} onClick={() => void decide("request_changes")} data-testid="signoff-send-changes">
              Send to the Product lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
