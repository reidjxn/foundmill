"use client";
/**
 * Share a Customer Update as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; docs/DESIGN.md §9f): the control in
 * the Customer Update screen's toolbar and its dialog. `journey.updateCard` says whether this person may share this
 * Customer Update and what the card would show; nothing is public until they press "Make the card" in the dialog, each
 * time, for each Customer Update. The dialog shows the card as a visitor will see it, with one optional line of the
 * founder's own. Once shared: "Copy card link", "Open the card" and "Stop sharing".
 *
 * No control at all for an example business, for a reader who cannot publish, or for a Customer Update that did not
 * come from a real payment. A project whose page is not published sees the action with the reason it waits.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Globe, Share2 } from "lucide-react";
import { useId, useState } from "react";
import { Button, CustomerUpdateCard, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Textarea, useToast } from "@foundmill/dugout";
import { UPDATE_CARD_NEEDS_PAGE_MESSAGE, UPDATE_CARD_NOTE_MAX, UPDATE_CARD_SHARE_WORDS as W } from "@foundmill/shared/update-cards";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";

export function ShareUpdateCard({ journeyId }: { journeyId: string }) {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const stateQ = useQuery(trpc.journey.updateCard.queryOptions({ businessId, journeyId }, { staleTime: 30_000, retry: false }));
  const key = trpc.journey.updateCard.queryKey({ businessId, journeyId });

  const copyLink = async (url: string, title: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title, tone: "good" });
    } catch {
      toast({ title: "Copy this link", description: url, tone: "info" });
    }
  };

  const share = useMutation(
    trpc.journey.shareUpdate.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(key, next);
        setOpen(false);
        setNote("");
        if (next.card) void copyLink(next.card.url, W.made);
      },
      onError: (err) => toast({ title: "Not shared", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const stop = useMutation(
    trpc.journey.unshareUpdate.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: key });
        toast({ title: W.stopped, tone: "good" });
      },
      onError: (err) => toast({ title: "Still shared", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const state = stateQ.data;
  if (!state) return null;

  if (state.card) {
    const card = state.card;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="update-card-shared" data-card-url={card.url}>
        <span className="inline-flex items-center gap-1 text-small text-secondary">
          <Globe aria-hidden className="size-3.5" />
          {W.shared}
        </span>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copyLink(card.url, W.copied)} data-testid="update-card-copy">
          {W.copy}
        </Button>
        <Button size="sm" variant="ghost" icon={ExternalLink} asChild>
          <a href={card.url} target="_blank" rel="noopener noreferrer" data-testid="update-card-open">
            {W.open}
          </a>
        </Button>
        {/* Stopping is the founders' too: a reader who cannot share sees the state and no button. */}
        {state.refusal !== "role" && state.refusal !== "sample" ? (
          <Button size="sm" variant="ghost" disabled={stop.isPending} onClick={() => stop.mutate({ businessId, journeyId })} data-testid="update-card-stop">
            {W.stop}
          </Button>
        ) : null}
      </span>
    );
  }

  // No action where there is nothing this person could do: an example business, a reader, a win that is not a real payment.
  if (!state.facts || state.refusal === "sample" || state.refusal === "role" || state.refusal === "not_real") return null;

  const facts = state.facts;
  const needsPage = state.refusal === "needs_page";
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="default" icon={Share2} disabled={needsPage} onClick={() => setOpen(true)} data-testid="update-card-share">
          {W.share}
        </Button>
        {needsPage ? (
          <span className="text-small text-secondary" data-testid="update-card-needs-page">
            {UPDATE_CARD_NEEDS_PAGE_MESSAGE}
          </span>
        ) : null}
      </span>
      <Dialog open={open} onOpenChange={(o) => (share.isPending ? undefined : setOpen(o))}>
        <DialogContent size="lg" data-testid="update-card-dialog">
          <DialogHeader>
            <DialogTitle>{W.dialogTitle}</DialogTitle>
            <DialogDescription>{W.dialogBody}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-sm border border-line" data-testid="update-card-preview">
              <CustomerUpdateCard
                variant="preview"
                name={data.business.name}
                headline={facts.headline}
                occurredOn={facts.occurredOn}
                leadChannelKey={facts.leadChannelKey}
                standoutAgent={facts.standoutAgent}
                verified={facts.verified}
                note={note}
                brandPrimary={data.kit.primary}
                brandSecondary={data.kit.secondary}
                pageHref="#"
                mark="none"
                inert
              />
            </div>
            <Field htmlFor={noteId} label={W.noteLabel} hint={W.noteHint}>
              <Textarea id={noteId} rows={2} maxLength={UPDATE_CARD_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} data-testid="update-card-note" />
            </Field>
            <p className="text-small text-secondary">{W.dialogConsent}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={share.isPending} onClick={() => setOpen(false)}>
              {W.cancel}
            </Button>
            <Button variant="primary" icon={Globe} disabled={share.isPending} onClick={() => share.mutate({ businessId, journeyId, note: note.trim() || null })} data-testid="update-card-confirm">
              {W.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
