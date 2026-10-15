/**
 * The founder profile a layout's gate has just read (`founder.profile.get`), handed to the browser's query cache with
 * the layout's other server-started queries (lib/hydrate.server.tsx), so the shell's business menu, the Inbox and the
 * reading pane read it at once instead of asking again after hydration (audit WEB-9). The key is the one their hooks
 * build: the procedure with no input.
 */
import type { QueryClient } from "@tanstack/react-query";
import { trpcQueryKey, type RouterOutputs } from "./trpc";

export const FOUNDER_PROFILE_KEY = trpcQueryKey("founder.profile.get");

export function handOverProfile(queryClient: QueryClient, profile: RouterOutputs["founder"]["profile"]["get"]): QueryClient {
  queryClient.setQueryData(FOUNDER_PROFILE_KEY, profile);
  return queryClient;
}
