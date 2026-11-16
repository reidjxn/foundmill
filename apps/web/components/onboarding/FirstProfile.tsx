"use client";
/**
 * The three questions (WP-04 T1): what a new account answers after keeping a card, on any screen from 390 px. What
 * the team should call you (prefilled from the email), what you are good at or enjoy (optional tags), and what you are
 * here for (`LOOKING_FOR_QUESTION`; "Building on my own" by default, people one answer among the others), then the one
 * "I am 18 or older" box. Two required inputs: the name and the box.
 *
 * Continue creates the profile with `founder.profile.update({ displayName, confirmAdult?, via? })` (the create branch
 * fills the rest). When the person gave either optional answer, `founder.publicProfile.update` saves those two (the
 * public profile stays private) with the rest of its content as it was; a failure there is logged and never holds the
 * person up. Then on to `next` (`onboardingNext`: the kept card's Commit), else /new (an edit: `/`). No toast: the
 * next screen is the answer.
 *
 * Also the profile on a phone for an account that has one (`profile`): the three questions prefilled, from the
 * profile and the public profile; the long form stays for a computer.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FIRST_PROFILE_STRENGTHS, FirstProfileForm, SkeletonText, useToast, type FirstProfileValues } from "@foundmill/dugout";
import { LOOKING_FOR_OPTIONS, LOOKING_FOR_QUESTION, PERSON_TAGS_MAX, PERSON_TAG_MAX, type PersonLookingFor, type PersonProfileContent } from "@foundmill/shared/person-profile";
import { StudioFrame } from "@/components/new/StudioFrame";
import { forgetVia } from "@/app/onboarding/actions";
import { isAdultUnconfirmed } from "@/lib/adult";
import { errorMessage, trpcPathPrefix, validationIssues } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { displayNameFromEmail, profileSaveMessage } from "./profile-form";

export { FIRST_PROFILE_STRENGTHS };
export const FIRST_PROFILE_TITLE = "Three quick things about you";
export const FIRST_PROFILE_LEDE = "So your team works the way you do. You can change any of it later.";

/** How long the first save waits for the attribution cookie to be cleared before it moves on without that. */
const FORGET_VIA_WAIT_MS = 3_000;

/** A new account's public profile: nothing in it yet. */
const EMPTY_CONTENT: PersonProfileContent = { headline: "", about: "", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "" };

export interface FirstProfileProps {
  email: string | null;
  /** The attribution reference (`fm_via`), sent with the save that creates the profile only. */
  via?: string | null;
  /** Where Continue goes (already checked by `onboardingNext`); /new when null. */
  next?: string | null;
  /** Whether "I am 18 or older" is on record; the box is shown when it is not. */
  adultConfirmed: boolean;
  /** An account that has a profile (editing on a phone): its name prefills the first question. */
  profile?: { displayName: string } | null;
}

/** The two optional answers merged into the public profile's content, or null when neither changed from `base`. */
function publicContentFor(base: PersonProfileContent, v: FirstProfileValues): PersonProfileContent | null {
  const same = v.lookingFor === base.lookingFor && v.strengths.length === base.strengths.length && v.strengths.every((s, i) => s === base.strengths[i]);
  return same ? null : { ...base, strengths: v.strengths, lookingFor: v.lookingFor as PersonLookingFor };
}

export function FirstProfile({ email, via = null, next = null, adultConfirmed, profile = null }: FirstProfileProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const editing = profile !== null;
  const handOver = editing ? null : via;
  const current = useQuery({ ...trpc.founder.publicProfile.get.queryOptions(undefined, { staleTime: 5_000 }), enabled: editing });
  /** What the public profile holds now: nothing for a new account; null while (or if) an edit could not read it. */
  const base: PersonProfileContent | null = editing ? (current.data?.content ?? null) : EMPTY_CONTENT;
  const [values, setValues] = useState<FirstProfileValues>(() => ({ name: profile?.displayName ?? (email ? displayNameFromEmail(email) : ""), strengths: [], lookingFor: "on_my_own" }));
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!editing || prefilled || !current.data) return;
    setPrefilled(true);
    setValues((v) => ({ ...v, strengths: current.data.content.strengths, lookingFor: current.data.content.lookingFor }));
  }, [editing, prefilled, current.data]);

  // The api refused the save for want of the confirmation: ask for it, whatever the page was told.
  const [serverAsked, setServerAsked] = useState(false);
  const askAdult = !adultConfirmed || serverAsked;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveProfile = useMutation(trpc.founder.profile.update.mutationOptions());
  const savePublic = useMutation(trpc.founder.publicProfile.update.mutationOptions());

  async function submit(v: FirstProfileValues & { confirmAdult: boolean }) {
    setBusy(true);
    setError(null);
    try {
      await saveProfile.mutateAsync({ displayName: v.name, ...(v.confirmAdult ? { confirmAdult: true as const } : {}), ...(handOver ? { via: handOver } : {}) });
    } catch (err) {
      if (isAdultUnconfirmed(err)) setServerAsked(true);
      const message = profileSaveMessage(validationIssues(err), errorMessage(err));
      setError(message);
      toast({ title: "Profile not saved", description: message, tone: "bad" });
      setBusy(false);
      return;
    }
    // The api has read the reference (it reads it once): clear the cookie, and never hold the person up for it.
    if (handOver) await Promise.race([forgetVia().catch(() => undefined), new Promise((done) => setTimeout(done, FORGET_VIA_WAIT_MS))]);
    const content = base ? publicContentFor(base, v) : null;
    if (content) {
      try {
        const saved = await savePublic.mutateAsync({ content });
        if (saved.outcome === "held") console.warn("first profile: the public profile's answers were held", saved.reason);
      } catch (err) {
        console.warn("first profile: the public profile's answers were not saved", err);
      }
    }
    await queryClient.invalidateQueries({ queryKey: trpcPathPrefix("founder") as unknown[] });
    // An edit on a phone goes back to the signed-in index (Today, or the person's home), which works on a phone; /new does not yet.
    router.push(next ?? (editing ? "/" : "/new"));
    router.refresh();
  }

  return (
    <StudioFrame step="profile" smallScreen width="measure" title={FIRST_PROFILE_TITLE} lede={FIRST_PROFILE_LEDE} viewer={{ email }}>
      {editing && current.isPending ? (
        <SkeletonText lines={4} label="Loading your profile" />
      ) : (
        <FirstProfileForm
          values={values}
          onChange={setValues}
          strengthSuggestions={FIRST_PROFILE_STRENGTHS}
          lookingForQuestion={LOOKING_FOR_QUESTION}
          lookingForOptions={LOOKING_FOR_OPTIONS}
          maxTags={PERSON_TAGS_MAX}
          maxTagLength={PERSON_TAG_MAX}
          askAdult={askAdult}
          saving={busy}
          error={error}
          onSubmit={(v) => void submit(v)}
          className="mx-auto pb-12"
        />
      )}
    </StudioFrame>
  );
}
