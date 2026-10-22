"use client";
/**
 * /businesses — Your businesses (founder, 2026-10-16): every business the founder belongs to, to open or to change its
 * settings, then the example business they opened from New business (Leave, Open; docs/UX_AUDIT_AND_PLAN.md §12 item
 * 5), then the archived ones they own (Restore, Export everything, Delete permanently; `#archived`), with Create a new
 * business and Back to the business they came from. The account frame without the step trail.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDateFormat, useToast } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { accountRoutes } from "@/lib/account-routes";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusinessLogos } from "@/components/logo/useBusinessLogo";
import { ArchivedBusinesses } from "@/components/new/ArchivedBusinesses";
import { LinkButton } from "@/components/new/LinkButton";
import { StudioFrame } from "@/components/new/StudioFrame";
import { BusinessesList } from "./BusinessesList";
import { ExampleBusinesses, splitExampleRows } from "./ExampleBusinesses";

export interface BusinessesScreenProps {
  viewer: { email: string | null };
  /** The business the founder opened last: Back to it, and its row says so. */
  lastBusiness: { id: string; name: string } | null;
}

export function BusinessesScreen({ viewer, lastBusiness }: BusinessesScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const datePrefs = useDateFormat();
  const listQ = useQuery(trpc.founder.businesses.list.queryOptions(undefined, { staleTime: 15_000 }));
  const { own, examples } = splitExampleRows(listQ.data?.businesses ?? []);
  const logos = useBusinessLogos(listQ.data?.businesses, true);
  // Leaving the example: the row goes from this list and from Switch business; the example door offers it again.
  const leave = useMutation(
    trpc.business.example.leave.mutationOptions({
      onSuccess: (result) => {
        const name = examples.find((b) => b.id === result.businessId)?.name ?? "the example";
        void Promise.all(["founder", "business"].map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));
        toast({ title: `Left ${name}`, description: "Nothing was deleted. Open it again from New business whenever you like.", tone: "good" });
      },
      onError: (err) => toast({ title: "Could not leave the example", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <StudioFrame
      title="Your businesses"
      lede="Every business you belong to. Open one, change its settings, or create a new one."
      viewer={viewer}
      actions={
        <>
          {lastBusiness ? (
            <LinkButton variant="ghost" icon={ArrowLeft} href={routes.home(lastBusiness.id)} data-testid="businesses-back">
              Back to {lastBusiness.name}
            </LinkButton>
          ) : null}
          <LinkButton variant="primary" icon={Plus} href={accountRoutes.newBusiness} data-testid="businesses-create">
            Create a new business
          </LinkButton>
        </>
      }
    >
      <BusinessesList rows={own} logos={logos} lastBusinessId={lastBusiness?.id ?? null} prefs={datePrefs} loading={listQ.isLoading} error={listQ.error ? "Could not load your businesses." : null} onRetry={() => void listQ.refetch()} onCreate={() => router.push(accountRoutes.newBusiness)} />
      <ExampleBusinesses rows={examples} logos={logos} leaving={leave.isPending ? leave.variables?.businessId : null} onLeave={(businessId) => leave.mutate({ businessId })} />
      <ArchivedBusinesses />
    </StudioFrame>
  );
}
