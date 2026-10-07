"use client";
/**
 * React side of lib/trpc.ts: the @trpc/tanstack-react-query context (a React context, so it lives in a client
 * module and never in server code).
 *
 *   const trpc = useTRPC();
 *   const q = useQuery(trpc.business.get.queryOptions({ businessId }));
 *   const m = useMutation(trpc.business.update.mutationOptions());
 */
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@foundmill/api/router";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
