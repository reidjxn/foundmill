"use client";
/**
 * Your public page, on Network (one identity for a person: a9 A9-P1-3). A person is on the network through the page they
 * publish at /u/<handle> (Your public page, /public-profile): Find people and Network search find them there. This
 * replaces the old "Profile visibility" choice; someone who once made their name public there can take it back here.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Pencil } from "lucide-react";
import { Button, Panel, useToast } from "@foundmill/dugout";
import { accountRoutes } from "@/lib/account-routes";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "@/components/new/LinkButton";

export function YourPagePanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const page = useQuery(
    trpc.founder.publicProfile.get.queryOptions(undefined, { staleTime: 30_000, retry: false }),
  );
  const old = useQuery(
    trpc.live.profile.visibility.get.queryOptions(undefined, { staleTime: 30_000, retry: false }),
  );
  const hide = useMutation(
    trpc.live.profile.visibility.set.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.profile") as unknown[] });
        toast({
          title: "Your name is no longer shown on its own",
          description: "Your public page, when you publish one, is how people find you.",
          tone: "good",
        });
      },
      onError: (err) =>
        toast({ title: "Not changed", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const p = page.data;
  const live = p?.public === true;
  const oldNameShown = old.data && old.data.visibility !== "private";
  return (
    <Panel
      title="Your public page"
      loading={page.isLoading}
      error={page.error ? errorMessage(page.error) : undefined}
      onRetry={() => void page.refetch()}
      data-testid="your-page-panel"
    >
      <p className="mb-3 flex items-start gap-1.5 text-small text-secondary">
        <Globe aria-hidden className="mt-0.5 size-icon-inline shrink-0" />
        {live
          ? `People find you in Find people and search, through your page at /u/${p.handle}.`
          : "Publish a page at your own address and people can find you here: what you are good at, and what you are building."}
      </p>
      <div className="flex flex-wrap gap-2">
        <LinkButton
          href={accountRoutes.publicProfile}
          variant={live ? "default" : "primary"}
          icon={Pencil}
          className="min-h-tap @page-wide:min-h-0"
          data-testid="your-page-edit"
        >
          {live ? "Edit your page" : "Make your page"}
        </LinkButton>
        {live ? (
          <LinkButton
            href={`/u/${p.handle}`}
            variant="ghost"
            icon={ExternalLink}
            className="min-h-tap @page-wide:min-h-0"
            data-testid="your-page-open"
          >
            Open it
          </LinkButton>
        ) : null}
      </div>
      {oldNameShown ? (
        <div
          className="mt-3 border-t border-subtle/50 pt-3 text-small text-secondary"
          data-testid="your-page-old-name"
        >
          <p className="mb-2">You chose to show your name on the network before pages existed.</p>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-tap @page-wide:min-h-0"
            loading={hide.isPending}
            onClick={() => hide.mutate({ visibility: "private" })}
            data-testid="your-page-hide-name"
          >
            Stop showing it
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
