"use client";
/**
 * `/i/<token>` (THESIS_REVIEW package 3.1; docs/NETWORK.md F5; DESIGN §9f): an invitation to a project, from 390 px.
 * The design system's `InvitationCard` in the brand frame, with what the api's public `invitation.byToken` said (the
 * project, who invited them, the role in plain words; nothing else).
 *
 *   - signed out: "Sign in to accept" goes to /login with `next` back here, so the invitation survives sign-up; on a
 *     deployment that is invite-only the invitation is itself the admission (`invitation.accept` needs a signed-in,
 *     confirmed address and nothing else);
 *   - signed in: Accept (`invitation.accept`, then the project) or Not now (nothing happens); "Decline" says no for good.
 * Opening the page changes nothing: a mail scanner that follows the link accepts nothing.
 */
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, InvitationCard, type InvitationCardState } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { signInThenBackTo } from "@/lib/people";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export type InvitationPreview = { state: "pending"; projectName: string; inviterName: string | null; role: "cofounder" | "collaborator"; roleWord: string; roleSentence: string } | { state: "unavailable" };

export interface InvitationScreenProps {
  token: string;
  preview: InvitationPreview;
  signedIn: boolean;
}

export function InvitationScreen({ token, preview, signedIn }: InvitationScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [declined, setDeclined] = useState(false);
  const accept = useMutation(trpc.invitation.accept.mutationOptions({ onSuccess: (r) => router.push(routes.today(r.businessId)) }));
  const decline = useMutation(trpc.invitation.decline.mutationOptions({ onSuccess: () => setDeclined(true) }));
  const state: InvitationCardState = declined ? "declined" : accept.isSuccess ? "accepted" : preview.state;
  const pending = preview.state === "pending" ? preview : null;
  const here = `/i/${token}`;

  const actions =
    state !== "pending" ? (
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
