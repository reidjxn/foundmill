"use client";
/**
 * `/i/<token>` (THESIS_REVIEW package 3.1; docs/NETWORK.md F5; DESIGN §9h): an invitation to a project, from 390 px.
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
 *     A person whose "I am 18 or older" is not on record yet (`founder.adult.get`) ticks it above Accept, which sends it
 *     with the accept (0100); one who confirmed already is never shown the box.
 * Opening the page changes nothing: a mail scanner that follows the link accepts nothing.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, RotateCw } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { AdultCheck, Button, Field, InvitationCard, Input, type InvitationCardState } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { invitationReadFailure, signInThenBackTo } from "@/lib/people";
import { apiTrpcUrl, createApiClient, errorMessage, type ApiClient } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { isAdultUnconfirmed } from "@/lib/adult";

export type InvitationPreview = { state: "pending"; projectName: string; inviterName: string | null; role: "cofounder" | "collaborator"; roleWord: string; roleSentence: string } | { state: "unavailable" };

export interface InvitationScreenProps {
  token: string;
  signedIn: boolean;
  /** Tests and stories: what the api answered, instead of asking it. */
  preview?: InvitationPreview;
  /** Tests and stories: whether "I am 18 or older" is on record, instead of asking `founder.adult.get`. */
  adultConfirmed?: boolean;
}

/** The public read, straight to the api (no bearer: `invitation.byToken` is public). */
let direct: ApiClient | null = null;
const directApi = (): ApiClient => (direct ??= createApiClient({ getToken: () => null, url: apiTrpcUrl() }));

/** Under the box on an invitation: asked once, for the whole of the product. */
export const INVITATION_ADULT_HINT = "You confirm this once.";
/** Under a new person's first screen in the project: the one thing asked after Accept (WP-12 T2). */
export const INVITATION_NAME_LABEL = "What should we call you?";
export const INVITATION_NAME_HINT = "The people on this project see this name.";
/** Accept pressed with the box empty. */
export const INVITATION_ADULT_NEEDED = "Confirm that you are 18 or older to accept.";

export function InvitationScreen({ token, signedIn, preview: given, adultConfirmed }: InvitationScreenProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [declined, setDeclined] = useState(false);
  const read = useQuery({ queryKey: ["invitation.byToken", token], queryFn: () => directApi().invitation.byToken.query({ token }), enabled: given === undefined, retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const accept = useMutation(
    trpc.invitation.accept.mutationOptions({
      // A person with a profile goes in; a new one names themselves first (the project's layout would otherwise send
      // them to /onboarding, which is desktop only).
      onSuccess: (r) => (r.hasProfile === false ? setNaming(r.businessId) : router.push(routes.today(r.businessId))),
      // The api says the confirmation is not on record: ask for it, whatever this page believed.
      onError: (err) => {
        if (!isAdultUnconfirmed(err)) return;
        setServerAsked(true);
        setAdultMissing(true);
      },
    }),
  );
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const saveName = useMutation(trpc.founder.profile.update.mutationOptions({ onSuccess: () => naming && router.push(routes.today(naming)) }));
  const decline = useMutation(trpc.invitation.decline.mutationOptions({ onSuccess: () => setDeclined(true) }));
  // 18 or older (0100): joining a project needs it on record, asked here once when it is not.
  const adultQ = useQuery(trpc.founder.adult.get.queryOptions(undefined, { enabled: signedIn && adultConfirmed === undefined, retry: false, staleTime: Infinity }));
  const [adult, setAdult] = useState(false);
  const [adultMissing, setAdultMissing] = useState(false);
  const [serverAsked, setServerAsked] = useState(false);
  // Only a confirmation the api reported hides the box: while it is being asked the box waits (and so does Accept), and
  // an answer that did not come (an error) shows it, never assumes it.
  const adultLoading = signedIn && adultConfirmed === undefined && adultQ.isLoading;
  const adultKnown = adultConfirmed ?? (adultQ.isSuccess ? adultQ.data.confirmed : undefined);
  const askAdult = signedIn && !adultLoading && (adultKnown !== true || serverAsked);
  const preview: InvitationPreview | null = given ?? read.data ?? null;
  const readState: InvitationCardState = preview ? preview.state : read.isError ? invitationReadFailure(read.error) : "checking";
  const state: InvitationCardState = declined ? "declined" : accept.isSuccess ? "accepted" : readState;
  const pending = preview?.state === "pending" ? preview : null;
  const here = `/i/${token}`;

  const continueNamed = () => {
    const displayName = name.trim();
    if (!displayName) setNameMissing(true);
    else saveName.mutate({ displayName });
  };

  const actions =
    naming ? (
      <>
        <Field htmlFor="invitation-name" label={INVITATION_NAME_LABEL} hint={INVITATION_NAME_HINT} error={nameMissing ? "Enter a name to continue." : undefined} className="w-full basis-full">
          <Input id="invitation-name" controlSize="lg" value={name} maxLength={80} autoComplete="name" onChange={(e) => (setName(e.target.value), setNameMissing(false))} data-testid="invitation-name" />
        </Field>
        <Button variant="primary" size="lg" className="min-h-tap" loading={saveName.isPending} onClick={continueNamed} data-testid="invitation-continue">
          Continue
        </Button>
      </>
    ) : state === "checking" ? null : state === "busy" ? (
      <Button variant="secondary" size="lg" className="min-h-tap" icon={RotateCw} loading={read.isFetching} onClick={() => void read.refetch()} data-testid="invitation-retry">
        Try again
      </Button>
    ) : state !== "pending" ? (
      <Button asChild variant="secondary" size="lg" className="min-h-tap">
        <a href="/">Go to {APP_NAME}</a>
      </Button>
    ) : signedIn ? (
      <>
        {askAdult ? <AdultCheck checked={adult} onCheckedChange={(v) => (setAdult(v), setAdultMissing(false))} hint={INVITATION_ADULT_HINT} error={adultMissing ? INVITATION_ADULT_NEEDED : undefined} className="w-full basis-full" data-testid="invitation-adult" /> : null}
        <Button
          variant="primary"
          size="lg"
          className="min-h-tap"
          icon={Check}
          loading={accept.isPending}
          disabled={adultLoading}
          onClick={() => {
            if (askAdult && !adult) setAdultMissing(true);
            else accept.mutate(askAdult ? { token, confirmAdult: true } : { token });
          }}
          data-testid="invitation-accept"
        >
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

  // A refusal for want of the confirmation is said by the box itself.
  const failure = (accept.error && !isAdultUnconfirmed(accept.error) ? accept.error : null) ?? decline.error ?? saveName.error;
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
