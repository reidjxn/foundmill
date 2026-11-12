"use client";
/**
 * Starts a team call or a one-to-one call and opens it (the lobby's Start, the agent profile's Call). The opening round
 * comes back with the call, so the call page has it before it asks.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useToast } from "@foundmill/dugout";
import type { TeamCallKind } from "@foundmill/shared/team-call";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";

export interface StartCallInput {
  kind: TeamCallKind;
  agentIds?: string[];
  topic?: string | null;
}

export function useStartCall() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { businessId } = useBusiness();
  const mutation = useMutation(
    trpc.teamCall.start.mutationOptions({
      onSuccess: (call) => {
        queryClient.setQueryData(trpc.teamCall.get.queryKey({ businessId, callId: call.id }), call);
        void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("teamCall.list") as unknown[] });
        router.push(routes.call(businessId, call.id));
      },
      onError: (err) => toast({ title: "The call did not start", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return {
    start: (input: StartCallInput) => mutation.mutate({ businessId, kind: input.kind, agentIds: input.agentIds, topic: input.topic?.trim() || undefined }),
    pending: mutation.isPending,
  };
}
