/**
 * Person streams `u:{userId}` (docs/ARCHITECTURE.md §5, §12): signals that something on the LIVE network reached one
 * person (a connection request, a message, a community invitation, a post to moderate), so their Network badge and
 * lists refresh in whichever business they have open, Personal or LIVE. Business streams cannot carry these: a person
 * may have no LIVE business, and the business stream is read by every member of the business.
 *
 * A signal carries no content (no names, no message text): the tab refetches what it shows through the api, which
 * applies the visibility rules. It is not a platform event (those are business-scoped and go through the outbox); it is
 * published after the change commits, like `publishSessionEvent`, and losing one only delays the badge until the next
 * poll.
 */
import { z } from "zod";
import { ValidationError } from "@foundmill/shared";
import { userStreamKey } from "./keys";
import type { StreamRedis } from "./redis";

export const USER_SIGNAL_KINDS = ["connection_requested", "connection_changed", "message_received", "community_invited", "moderation"] as const;
export const UserSignalKind = z.enum(USER_SIGNAL_KINDS);
export type UserSignalKind = z.infer<typeof UserSignalKind>;

export const UserSignal = z.object({
  type: z.literal("live.signal"),
  kind: UserSignalKind,
  at: z.iso.datetime({ offset: true }),
  /** The thread a message arrived in, when the tab has it open. */
  threadId: z.guid().optional(),
  communityId: z.guid().optional(),
});
export type UserSignal = z.infer<typeof UserSignal>;

/** A person's stream is short: only the latest signals matter to a tab that has just (re)connected. */
export const USER_STREAM_MAXLEN = 200;

/** Appends one signal to `u:{userId}`. Returns the stream entry id. */
export async function publishUserSignal(redis: StreamRedis, userId: string, signal: Omit<UserSignal, "type" | "at"> & { at?: string }): Promise<string> {
  if (!userId) throw new ValidationError("userId is required");
  const parsed = UserSignal.safeParse({ type: "live.signal", at: new Date().toISOString(), ...signal });
  if (!parsed.success) throw new ValidationError(`Invalid user signal: ${z.prettifyError(parsed.error)}`, parsed.error.issues);
  const id = await redis.xadd(userStreamKey(userId), "MAXLEN", "~", USER_STREAM_MAXLEN, "*", "kind", parsed.data.kind, "json", JSON.stringify(parsed.data));
  if (id === null) throw new Error(`publishUserSignal: XADD returned null for ${userStreamKey(userId)}`);
  return id;
}

/** Reads a signal off the wire (`null` for anything else), for the tab's handler. */
export function readUserSignal(raw: unknown): UserSignal | null {
  const r = UserSignal.safeParse(raw);
  return r.success ? r.data : null;
}
