"use client";
/**
 * "Ask to connect" (BUILD §11.14 request/accept/block; audit #66): the one way a founder starts a connection, offered on
 * community members and post authors. A dialog takes an optional note and calls
 * `live.connections.request` from the current business (a LIVE business the founder speaks for); a request to a
 * business reaches its owner. The person's state (connected, requested, waiting for you) comes from the
 * founder's own connection rows, so a button never offers to ask twice.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, UserPlus } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Textarea, useToast } from "@foundmill/dugout";
import { askToConnectBlocker, connectStateOf, requestOutcome, type ConnectState } from "@/lib/live";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useLiveViewer } from "./viewer";

/** Who a request goes to: a person, or a listed business (its owner). `name` is what the founder sees. */
export type ConnectTarget = { userId: string; businessId?: undefined; name: string } | { businessId: string; userId?: undefined; name: string };

const NOTE_MAX = 1000;

/** The viewer's state with each person, from their own connection rows (one cached query for the whole page). */
export function useConnectStates(): { stateOf: (userId: string) => ConnectState; loading: boolean } {
  const trpc = useTRPC();
  const viewer = useLiveViewer();
  const q = useQuery(trpc.live.connections.list.queryOptions(undefined, { staleTime: 15_000 }));
  return useMemo(() => ({ stateOf: (userId: string) => connectStateOf(q.data ?? [], viewer.userId, userId), loading: q.isLoading }), [q.data, q.isLoading, viewer.userId]);
}

/** Whether the current business can send a request, and why not. */
export function useAskToConnectBlocker(): string | null {
  const { data } = useBusiness();
  return askToConnectBlocker({ business: data.business, membership: data.membership });
}

/** A request dialog for one target at a time: `ask(target)` opens it, `dialog` renders it. */
export function useAskToConnect(): { ask: (target: ConnectTarget) => void; blocker: string | null; dialog: ReactNode } {
  const [target, setTarget] = useState<ConnectTarget | null>(null);
  const blocker = useAskToConnectBlocker();
  return { ask: setTarget, blocker, dialog: <AskToConnectDialog target={target} onOpenChange={(open) => !open && setTarget(null)} /> };
}

export function AskToConnectDialog({ target, onOpenChange }: { target: ConnectTarget | null; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { businessId, data } = useBusiness();
  const viewer = useLiveViewer();
  const [note, setNote] = useState("");
  const request = useMutation(
    trpc.live.connections.request.mutationOptions({
      onSuccess: (row) => {
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.connections") as unknown[] });
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("live.summary") as unknown[] });
        const name = target?.name ?? "them";
        const outcome = requestOutcome(row, viewer.userId);
        toast(
          outcome === "connected"
            ? { title: `You are already connected with ${name}`, description: "Write to them from Network.", tone: "info" }
            : outcome === "incoming"
              ? { title: `${name} already asked to connect with you`, description: "Accept their request in Requests on Network.", tone: "info" }
              : { title: `Request sent to ${name}`, description: "It waits in Sent requests on Network until they answer.", tone: "good" },
        );
        setNote("");
        onOpenChange(false);
      },
      onError: (err) => toast({ title: "Request not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const send = () => {
    if (!target) return;
    const message = note.trim() || undefined;
    request.mutate(target.userId ? { businessId, toUserId: target.userId, message } : { businessId, toBusinessId: target.businessId!, message });
  };
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="ask-to-connect-dialog">
        <DialogHeader>
          <DialogTitle>Ask {target?.name ?? ""} to connect</DialogTitle>
          <DialogDescription>
            {target?.businessId ? "The request goes to the founder who owns this business. " : ""}Once they accept, you can message each other. Sent from {data.business.name}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field htmlFor="connect-note" label="A note with the request" hint="Optional, up to 1,000 characters.">
            <Textarea id="connect-note" rows={3} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Say why you would like to connect" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={UserPlus} loading={request.isPending} onClick={send} data-testid="ask-to-connect-send">
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A person's connection state as a small control: "Connected", "Requested" or "Asked you" as chips, or an "Ask to
 * connect" button (disabled, with the reason, when the current business cannot send one).
 */
export function ConnectControl({ state, name, blocker, onAsk }: { state: ConnectState; name: string; blocker: string | null; onAsk: () => void }) {
  if (state === "self" || state === "blocked") return null;
  if (state === "connected") return <Chip tone="good" icon={Check}>Connected</Chip>;
  if (state === "requested") return <Chip tone="neutral" icon={Clock}>Requested</Chip>;
  if (state === "incoming") return <Chip tone="info" icon={Clock}>Asked you</Chip>;
  return (
    <Button size="sm" variant="ghost" icon={UserPlus} disabled={!!blocker} title={blocker ?? undefined} aria-label={`Ask ${name} to connect`} onClick={onAsk} data-testid="ask-to-connect">
      Connect
    </Button>
  );
}
