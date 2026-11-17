"use client";
/**
 * /new/write — a phone start without a card (WP-04 T15): "What do you want to build?", a working name and the idea in
 * the person's own words, and "Shape it". One `idea.write` (the studio's "Use my idea as written", WriteDialog in
 * ideate/dialogs.tsx: the words become the pitch as typed, the Ideation agent rates them and never rewrites them), then
 * Commit. Works from 390 px (`smallScreen`); the kind of business is left to the agent, as WriteDialog's "Any" does.
 */
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WRITE_IDEA_WORDS, WriteIdeaForm, type WriteIdeaValues } from "@foundmill/dugout";
import { useSingleFlight } from "@/lib/single-flight";
import { useTRPC } from "@/lib/trpc-react";
import { LinkButton } from "./LinkButton";
import { StudioFrame } from "./StudioFrame";
import { conceptErrorMessage } from "./ideate/concept-errors";
import { commitHref } from "./ideate/concepts";

export interface WriteIdeaProps {
  viewer: { email: string | null };
}

export function WriteIdea({ viewer }: WriteIdeaProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const [values, setValues] = useState<WriteIdeaValues>({ name: "", pitch: "" });
  const write = useMutation(
    trpc.idea.write.mutationOptions({
      onSuccess: (res) => router.push(commitHref(res.idea.id)),
    }),
  );
  // One press writes one idea: a ref guard, since a double click lands before `isPending` is published.
  const send = useSingleFlight(write.mutateAsync, { closeOnSuccess: true });
  return (
    <StudioFrame
      title={WRITE_IDEA_WORDS.title}
      lede={WRITE_IDEA_WORDS.lede}
      viewer={viewer}
      width="measure"
      smallScreen
      actions={
        <LinkButton variant="ghost" icon={ArrowLeft} href="/home" className="min-h-tap">
          Back
        </LinkButton>
      }
    >
      <WriteIdeaForm
        values={values}
        onChange={setValues}
        // Pending and after success alike: one press writes one idea, and the page is on its way to Commit.
        busy={write.isPending || write.isSuccess}
        error={write.error ? conceptErrorMessage(write.error) : undefined}
        onSubmit={(v) => send({ title: v.name, pitch: v.pitch, archetype: null })}
      />
    </StudioFrame>
  );
}
