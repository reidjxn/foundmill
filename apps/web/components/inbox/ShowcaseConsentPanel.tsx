"use client";
/**
 * A founder's own showcase ask in Needs you (0105; docs/THESIS_REVIEW.md §13 item 15): the note's reading pane shows
 * exactly what would be posted and the founder answers signed in (`showcase.answer`, `showcase.withdrawMine`), never
 * through a one-click link. Each founder reads only their own ask; the api refuses anyone else.
 */
import { APP_NAME } from "@foundmill/config";
import { ErrorState, ShowcaseConsent, Skeleton, useFormatters, useToast } from "@foundmill/dugout";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export function ShowcaseConsentPanel({ businessId, inboxItemId }: { businessId: string; inboxItemId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { formatDate } = useFormatters();
  const askQ = useQuery(trpc.showcase.ask.queryOptions({ businessId, inboxItemId }, { retry: false }));
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: trpcPathPrefix("showcase") as unknown[] }), queryClient.invalidateQueries({ queryKey: trpcPathPrefix("inbox") as unknown[] })]);
  const onError = (err: unknown) => toast({ title: "Your answer was not saved", description: errorMessage(err), tone: "bad" });
  const answer = useMutation(trpc.showcase.answer.mutationOptions({ onSuccess: () => void refresh(), onError }));
  const withdraw = useMutation(trpc.showcase.withdrawMine.mutationOptions({ onSuccess: () => void refresh(), onError }));

  if (askQ.isLoading) return <Skeleton className="h-48 w-full" />;
  if (askQ.error || !askQ.data) return <ErrorState onRetry={() => void askQ.refetch()}>{askQ.error ? errorMessage(askQ.error) : "This ask could not be opened."}</ErrorState>;
  const a = askQ.data;
  const shots = new Map(a.preview.shots.map((s) => [s.milestoneId, s.caption]));
  return (
    <ShowcaseConsent
      appName={APP_NAME}
      busy={answer.isPending || withdraw.isPending}
      view={{
        projectName: a.preview.projectName,
        postText: a.preview.postText,
        link: a.preview.link,
        networks: a.preview.networks,
        clips: (a.preview.video?.clips ?? []).map((c) => ({ url: c.url, caption: shots.get(c.milestoneId) ?? "" })),
        answer: a.answer,
        withdrawn: a.withdrawn,
        state: a.state,
        expiresOn: formatDate(new Date(a.expiresAt)),
        canAnswer: a.canAnswer,
        canWithdraw: a.canWithdraw,
      }}
      onAnswer={(value) => answer.mutate({ businessId, consentId: a.consentId, answer: value })}
      onWithdraw={() => withdraw.mutate({ businessId, consentId: a.consentId })}
    />
  );
}
