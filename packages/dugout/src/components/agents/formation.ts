/** Formation Board logic (BUILD §11.7): lines, icons, board/bench grouping and the toggle. Pure. */
import { Calendar, FileText, Handshake, Mail, Mailbox, Megaphone, MessageSquareQuote, Mic, Newspaper, Radio, Search, Share2, Signpost, Star, Target } from "lucide-react";
import { CHANNEL_LINES, CHANNEL_META, type ChannelKey, type ChannelLine } from "@foundmill/shared";
import type { IconComponent } from "../foundation/Icon";
import type { ChannelLineGroup, ChannelTokenData, FormCell } from "./types";

export const CHANNEL_ICONS: Record<ChannelKey, IconComponent> = {
  lead_generation: Target,
  email_automation: Mail,
  seo: Search,
  geo: MessageSquareQuote,
  content: FileText,
  social: Share2,
  paid_ads: Megaphone,
  influencer: Star,
  affiliate: Handshake,
  direct_mail: Mailbox,
  print: Newspaper,
  broadcast: Radio,
  outdoor: Signpost,
  pr: Mic,
  events: Calendar,
};

export const LINE_LABELS: Record<ChannelLine, string> = { attack: "Acquisition", midfield: "Engagement", defence: "Organic", wings: "Offline" };
export const LINE_HINTS: Record<ChannelLine, string> = {
  attack: "Lead generation, paid advertising, affiliate",
  midfield: "Email, social, influencer, PR, events",
  defence: "SEO, GEO, content",
  wings: "Direct mail, print, broadcast, outdoor",
};

export const FORM_WORDS: Record<FormCell, string> = { good: "under cap", warn: "near cap", bad: "over cap", none: "no data" };

export function channelLabel(key: ChannelKey): string {
  return CHANNEL_META[key].label;
}

export function channelLine(key: ChannelKey): ChannelLine {
  return CHANNEL_META[key].line;
}

/** Active channels grouped by line in board order (Acquisition at the top, Offline at the bottom), each line by fit. */
export function pitchLines(channels: readonly ChannelTokenData[]): ChannelLineGroup[] {
  return CHANNEL_LINES.map((line) => ({
    line,
    label: LINE_LABELS[line],
    channels: channels.filter((c) => c.enabled && channelLine(c.key) === line).slice().sort((a, b) => b.fit - a.fit),
  }));
}

/** Bench: everything not on the board, best fit first. */
export function benchChannels(channels: readonly ChannelTokenData[]): ChannelTokenData[] {
  return channels
    .filter((c) => !c.enabled)
    .slice()
    .sort((a, b) => b.fit - a.fit || a.key.localeCompare(b.key));
}

/** Immutable toggle; returns the same array when nothing changes. */
export function toggleChannel(channels: readonly ChannelTokenData[], key: ChannelKey, enabled: boolean): ChannelTokenData[] {
  const i = channels.findIndex((c) => c.key === key);
  if (i < 0 || channels[i]!.enabled === enabled) return channels.slice();
  return channels.map((c, idx) => (idx === i ? { ...c, enabled } : c));
}

/** Recommended channels in the order they walk onto the board (best fit first). */
export function entranceOrder(channels: readonly ChannelTokenData[]): ChannelKey[] {
  return channels
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.fit - a.fit)
    .map((c) => c.key);
}

/** Internal zone keys (data-drop-zone); the user-facing words are "board" and "bench". */
export type DropZone = "pitch" | "bench";

/** Which drop zone is under a screen point, using `data-drop-zone` markers. */
export function dropZoneAt(x: number, y: number, doc: Document = document): DropZone | null {
  const el = doc.elementFromPoint(x, y) as HTMLElement | null;
  const zone = el?.closest<HTMLElement>("[data-drop-zone]")?.dataset.dropZone;
  return zone === "pitch" || zone === "bench" ? zone : null;
}

/** Share of the fit-weighted budget for a token, 0–1, for the profile card when the app gives none. */
export function fitShare(channels: readonly ChannelTokenData[], key: ChannelKey): number {
  const on = channels.filter((c) => c.enabled);
  const total = on.reduce((s, c) => s + c.fit, 0);
  const me = on.find((c) => c.key === key);
  return me && total > 0 ? me.fit / total : 0;
}
