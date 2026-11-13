"use client";
/**
 * The card on a person's home for each project they were a founder of until someone else demoted or removed them in
 * the last 7 days, while a deletion of it waits (security review P2-3; docs/DESIGN.md §9g). It reads
 * `founder.formerProjects.list` (nothing while there is none: the card is never there for nothing) and cancels through
 * `founder.formerProjects.cancel`, which restores nothing else. Shown on Today (the front door), on Home and on /new
 * (where a person with no project left lands); the same works from the one-click link in their email (`/a/<token>`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FormerProjectCard, formatDate, formatDateTime, useDateFormat, type GridSpan } from "@foundmill/dugout";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

type Card = RouterOutputs["founder"]["formerProjects"]["list"][number];

export function FormerProjects({ span = 12, className }: { span?: GridSpan; className?: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const datePrefs = useDateFormat();
  const listQ = useQuery(trpc.founder.formerProjects.list.queryOptions(undefined, { staleTime: 60_000 }));
  // A card whose cancel went through stays, saying so, until the page is left (the list no longer holds it).
  const [done, setDone] = useState<Record<string, Card>>({});
  const [error, setError] = useState<Record<string, string>>({});
  const cancel = useMutation(
    trpc.founder.formerProjects.cancel.mutationOptions({
      onSuccess: (result, input) => {
        const card = listQ.data?.find((c) => c.businessId === input.businessId);
        if (result.canceled && card) setDone((d) => ({ ...d, [input.businessId]: card }));
        else if (!result.canceled) setError((e) => ({ ...e, [input.businessId]: "This deletion was canceled already. Nothing will be deleted." }));
        void queryClient.invalidateQueries({ queryKey: trpc.founder.formerProjects.list.queryKey() });
      },
      onError: (err, input) => setError((e) => ({ ...e, [input.businessId]: errorMessage(err) })),
    }),
  );
  const cards = new Map<string, Card>((listQ.data ?? []).map((c) => [c.businessId, c]));
  for (const [id, card] of Object.entries(done)) cards.set(id, card);
  if (cards.size === 0) return null;
  return (
    <div className={className} data-testid="former-projects">
      {[...cards.values()].map((card) => (
        <FormerProjectCard
          key={card.businessId}
          span={span}
          projectName={card.businessName}
          scheduledFor={formatDate(card.scheduledFor, "date", datePrefs)}
          until={formatDateTime(card.until, datePrefs)}
          pending={cancel.isPending && cancel.variables?.businessId === card.businessId}
          done={card.businessId in done}
          error={error[card.businessId] || null}
          onCancel={() => {
            setError((e) => ({ ...e, [card.businessId]: "" }));
            cancel.mutate({ businessId: card.businessId });
          }}
        />
      ))}
    </div>
  );
}
