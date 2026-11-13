"use client";
/**
 * `/i/<token>` (THESIS_REVIEW package 3.1; docs/NETWORK.md F5; DESIGN §9f): an invitation to a project, from 390 px.
 * The design system's `InvitationCard` in the brand frame, with what the api's public `invitation.byToken` said (the
 * project, who invited them, the role in plain words; nothing else).
 *
 * The browser reads the invitation from the api directly (`directApi`: not the same-origin path, which reaches the api
 * from the web's own addresses), so the api's per-caller limit is this visitor's own. While it asks, the card reads
 * Opening; if the api's limit refused it, "Too many people opened links just now. Try again in a minute." with Try
 * again; any other failure is the one answer for a link that does not work.
 *
 *   - signed out: "Sign in to accept" goes to /login with `next` back here, so the invitation survives sign-up; on a
 *     deployment that is invite-only the invitation is itself the admission (`invitation.accept` needs a signed-in,
 *     confirmed address and nothing else);
 *   - signed in: Accept (`invitation.accept`, then the project) or Not now (nothing happens); "Decline" says no for good.
 * Opening the page changes nothing: a mail scanner that follows the link accepts nothing.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, RotateCw } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, InvitationCard, type InvitationCardState } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { invitationReadFailure, signInThenBackTo } from "@/lib/people";
import { apiTrpcUrl, createApiClient, errorMessage, type ApiClient } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export type InvitationPreview = { state: "pending"; projectName: string; inviterName: string | null; role: "cofounder" | "collaborator"; roleWord: string; roleSentence: string } | { state: "unavailable" };

export interface InvitationScreenProps {
  token: string;
  signedIn: boolean;
  /** Tests and stories: what the api answered, instead of asking it. */
  preview?: InvitationPreview;
}

/** The public read, straight to the api (no bearer: `invitation.byToken` is public). */
let direct: ApiClient | null = null;
const directApi = (): ApiClient => (direct ??= createApiClient({ getToken: () => null, url: apiTrpcUrl() }));

export function InvitationScreen({ token, signedIn, preview: given }: InvitationScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [declined, setDeclined] = useState(false);
  const read = useQuery({ queryKey: ["invitation.byToken", token], queryFn: () => directApi().invitation.byToken.query({ token }), enabled: given === undefined, retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const accept = useMutation(trpc.invitation.accept.mutationOptions({ onSuccess: (r) => router.push(routes.today(r.businessId)) }));
  const decline = useMutation(trpc.invitation.decline.mutationOptions({ onSuccess: () => setDeclined(true) }));
  const preview: InvitationPreview | null = given ?? read.data ?? null;
  const readState: InvitationCardState = preview ? preview.state : read.isError ? invitationReadFailure(read.error) : "checking";
  const state: InvitationCardState = declined ? "declined" : accept.isSuccess ? "accepted" : readState;
  const pending = preview?.state === "pending" ? preview : null;
  const here = `/i/${token}`;

  const actions =
    state === "checking" ? null : state === "busy" ? (
      <Button variant="secondary" size="lg" className="min-h-tap" icon={RotateCw} loading={read.isFetching} onClick={() => void read.refetch()} data-testid="invitation-retry">
        Try again
      </Button>
    ) : state !== "pending" ? (
      <Button asChild variant="secondary" size="lg" className="min-h-tap">
        <a href="/">Go to {APP_NAME}</a>
      </Button>
    ) : signedIn ? (
      <>
        <Button variant="primary" size="lg" className="min-h-tap" icon={Check} loading={accept.isPending} onClick={() => accept.mutate({ token })} data-testid="invitation-accept">
          Accept
        </Button>
        <Button asChild variant="ghost" size="lg" className="min-h-tap">
          <a href="/">Not now</a>
        </Button>
        <Button variant="ghost" size="lg" className="min-h-tap text-secondary" loading={decline.isPending} onClick={() => decline.mutate({ token })} data-testid="invitation-decline">
          Decline
        </Button>
      </>
    ) : (
      <>
        <Button asChild variant="primary" size="lg" className="min-h-tap">
          <a href={signInThenBackTo(here)} data-testid="invitation-sign-in">
            Sign in to accept
          </a>
        </Button>
        <Button asChild variant="ghost" size="lg" className="min-h-tap">
          <a href="/">Not now</a>
        </Button>
      </>
    );

  const failure = accept.error ?? decline.error;
  return (
    <BrandFrame smallScreen>
      <div className="@container" data-testid="invitation" data-state={state}>
        <InvitationCard
          state={state}
          projectName={pending?.projectName ?? null}
          inviterName={pending?.inviterName ?? null}
          roleWord={pending?.roleWord ?? null}
          roleSentence={pending?.roleSentence ?? null}
          actions={actions}
          note={failure ? errorMessage(failure) : !signedIn && state === "pending" ? "Sign in with any email address. New here? The same link creates your account." : null}
        />
      </div>
    </BrandFrame>
  );
}
