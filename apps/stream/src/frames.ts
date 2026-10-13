/** Server-side validation of inbound frames (Zod). Kept apart from protocol.ts so the browser client stays dependency-free. */
import { z } from "zod";
import type { ClientFrame } from "./protocol";

const Channel = z.string().min(4).max(64);

export const ClientFrameSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("sub"), ch: Channel, focus: z.boolean().optional() }),
  z.object({ t: z.literal("unsub"), ch: Channel }),
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("focus"), ch: Channel, focused: z.boolean() }),
  z.object({ t: z.literal("auth"), token: z.string().min(1).max(7_000) }),
]);

/** Largest inbound frame we accept; clients send tiny control frames, and now and then a refreshed access token. */
export const MAX_INBOUND_BYTES = 8192;

export type ParsedFrame = { ok: true; frame: ClientFrame } | { ok: false; reason: string };

export function parseClientFrame(raw: unknown): ParsedFrame {
  const text = typeof raw === "string" ? raw : raw instanceof Uint8Array ? new TextDecoder().decode(raw) : null;
  if (text === null) return { ok: false, reason: "frame must be text" };
  if (text.length > MAX_INBOUND_BYTES) return { ok: false, reason: "frame too large" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "frame is not JSON" };
  }
  const r = ClientFrameSchema.safeParse(json);
  if (!r.success) return { ok: false, reason: z.prettifyError(r.error) };
  return { ok: true, frame: r.data };
}
