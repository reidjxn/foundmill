/** Channel Board logic (BUILD §11.7): channel families, icons, the quadrant layout, board/tray grouping and the toggle. Pure. */
import { Calendar, FileText, Handshake, Mail, Mailbox, Megaphone, MessageSquareQuote, Mic, Newspaper, Radio, Search, Share2, Signpost, Star, Target } from "lucide-react";
import { CHANNEL_LINES, CHANNEL_META, type ChannelKey, type ChannelLine } from "@foundmill/shared/constants";
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

/** A cost-trend cell in words: how the week's cost per customer sat against the channel's cost target. */
export const FORM_WORDS: Record<FormCell, string> = { good: "under target", warn: "near target", bad: "over target", none: "no data" };

/** The user-facing name of the five-cell strip (the identifier `form` stays). */
// plain-allow: a label constant; every screen that shows it defines it (<Term id="cost_trend"> or a DataTable column `term`).
export const COST_TREND_LABEL = "Cost trend";

/**
 * The key a founder reads on hover: "Last 5 weeks against the cost target: 4 under, 1 near". Weeks without data are
 * left out of the count; with no data at all it says so.
 */
export function costTrendKey(form: readonly FormCell[]): string {
  const cells = Array.from({ length: 5 }, (_, i) => form[form.length - 5 + i] ?? "none");
  const count = (cell: FormCell) => cells.filter((c) => c === cell).length;
  const parts = [
    [count("good"), "under"],
    [count("warn"), "near"],
    [count("bad"), "over"],
  ].filter(([n]) => (n as number) > 0) as [number, string][];
  const lead = "Last 5 weeks against the cost target";
  if (parts.length === 0) return `${lead}: no data yet`;
  return `${lead}: ${parts.map(([n, word]) => `${n} ${word}`).join(", ")}`;
}

export function channelLabel(key: ChannelKey): string {
  return CHANNEL_META[key].label;
}

export function channelLine(key: ChannelKey): ChannelLine {
  return CHANNEL_META[key].line;
}

/** Active channels grouped by family in board order (Acquisition, Engagement, Organic, Offline), each family by fit. */
export function pitchLines(channels: readonly ChannelTokenData[]): ChannelLineGroup[] {
  return CHANNEL_LINES.map((line) => ({
    line,
    label: LINE_LABELS[line],
    channels: channels.filter((c) => c.enabled && channelLine(c.key) === line).slice().sort((a, b) => b.fit - a.fit),
  }));
}

/** Off the board: everything not running, best fit first. */
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

/** Recommended channels in the order they join the board (best fit first). */
export function entranceOrder(channels: readonly ChannelTokenData[]): ChannelKey[] {
  return channels
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || b.fit - a.fit)
    .map((c) => c.key);
}

/** Internal zone keys (data-drop-zone); the user-facing words are "on the board" and "off the board". */
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

// ---------------------------------------------------------------------------------------------------------------------
// Quadrant layout (DESIGN "Channel Board")
//
// The board is a 1600 × 1000 unit plane (the 16:10 surface). A hub sits at the centre; each channel family owns one
// quadrant and a running channel sits on the quadrant's diagonal at a distance that encodes fit: the closer to the hub,
// the stronger the fit. Rings mark the fit bands. Channels of the same family fan out across the quadrant and a small
// deterministic relaxation keeps every token clear of every other, so positions are stable between renders.
// ---------------------------------------------------------------------------------------------------------------------

export const BOARD_W = 1600;
export const BOARD_H = 1000;
/** Hub centre, a little above the middle because each token's name hangs below its circle. */
export const HUB = { x: 800, y: 470 } as const;
/** Ellipse radii at t = 1 (the outer edge of the board's usable area). */
export const RX = 700;
export const RY = 380;
/** Distance range used by tokens (t of the ellipse). */
export const T_MIN = 0.3;
export const T_MAX = 0.96;
/** Half-width of the usable wedge around each quadrant's diagonal, in degrees (the axes stay clear). */
export const WEDGE_HALF = 38;
/**
 * Token footprint in board units at the narrowest desktop board (about 0.62 px per unit): the 72 px token or its full
 * name, whichever is wider, plus a gap; vertically the circle, the performance strip and the name.
 */
const CLEAR_Y = 142;
const GAP_X = 14;
export function halfWidth(key: ChannelKey): number {
  return Math.max(61, channelLabel(key).length * 5.9);
}

/** Family accents: four department hues that never collide with the red/amber/green rating ramp. */
export const FAMILY_ACCENT: Record<ChannelLine, string> = {
  attack: "var(--dept-8)",
  midfield: "var(--dept-6)",
  defence: "var(--dept-1)",
  wings: "var(--dept-5)",
};

/** Quadrant per family: the angle of its diagonal (0° = right, 90° = down) and the corner its label sits in. */
export const FAMILY_QUADRANT: Record<ChannelLine, { angle: number; corner: "tl" | "tr" | "bl" | "br" }> = {
  attack: { angle: -135, corner: "tl" },
  midfield: { angle: -45, corner: "tr" },
  defence: { angle: 135, corner: "bl" },
  wings: { angle: 45, corner: "br" },
};

/** Fit 1–20 → distance t: 20 sits just outside the hub, 1 at the edge. */
export function fitToT(fit: number): number {
  const f = Math.min(20, Math.max(1, fit));
  return T_MIN + 0.02 + ((20 - f) / 19) * (T_MAX - T_MIN - 0.04);
}

/** The four fit bands as rings (outer edge of each band), strongest first; the words are the rating ramp's own (`ratingBandLabel`). */
export const FIT_RINGS: ReadonlyArray<{ band: string; range: string; t: number }> = [
  { band: "Excellent", range: "16–20", t: fitToT(15.5) },
  { band: "Good", range: "11–15", t: fitToT(10.5) },
  { band: "Average", range: "6–10", t: fitToT(5.5) },
  { band: "Poor", range: "1–5", t: T_MAX + 0.02 },
];

export function polar(angleDeg: number, t: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: HUB.x + Math.cos(a) * RX * t, y: HUB.y + Math.sin(a) * RY * t };
}

/** Angle (degrees, -180..180) and distance t of a board point, measured on the ellipse. */
function toPolar(x: number, y: number): { angle: number; t: number } {
  const nx = (x - HUB.x) / RX;
  const ny = (y - HUB.y) / RY;
  return { angle: (Math.atan2(ny, nx) * 180) / Math.PI, t: Math.hypot(nx, ny) };
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export interface BoardSlot {
  key: ChannelKey;
  line: ChannelLine;
  /** Board units (0–1600, 0–1000). */
  x: number;
  y: number;
  /** Percent of the board, for CSS. */
  left: number;
  top: number;
}

/** Half-width of the corridor kept clear above the hub for the fit-band captions, in board units. */
export const CAPTION_CORRIDOR = 128;
/**
 * The hub and its sweep ring, in board units at the narrowest desktop board (the hub is drawn at a fixed pixel size,
 * so it covers the most board on the smallest board), plus a gap. No token's footprint comes closer to the hub centre.
 */
export const HUB_CLEAR = 104;
/** A token's footprint above and below its circle's centre in board units: the circle above; strip and name below. */
export const TOKEN_UP = 44;
export const TOKEN_DOWN = 100;

/** True when a token's footprint (its label's half-width either side, TOKEN_UP above, TOKEN_DOWN below) meets the hub. */
export function hitsHub(p: { x: number; y: number }, hw: number): boolean {
  const nx = Math.max(p.x - hw, Math.min(HUB.x, p.x + hw));
  const ny = Math.max(p.y - TOKEN_UP, Math.min(HUB.y, p.y + TOKEN_DOWN));
  return Math.hypot(nx - HUB.x, ny - HUB.y) < HUB_CLEAR;
}

/**
 * Where every channel lives on the map, running or not, so a channel always lights up in the same place and nothing
 * reshuffles when one is toggled. Deterministic: same channels in, same positions out. Each family starts as an even
 * fan across its wedge at fit distance, best fit on the diagonal; a fixed number of relaxation passes then push
 * overlapping tokens apart (in token-footprint units) while keeping each one inside its wedge, inside the usable ring
 * and out of the caption corridor above the hub.
 */
export function boardLayout(channels: readonly ChannelTokenData[]): BoardSlot[] {
  const pts: Array<{ key: ChannelKey; line: ChannelLine; x: number; y: number; home: number; hw: number }> = [];
  for (const line of CHANNEL_LINES) {
    const members = channels.filter((c) => channelLine(c.key) === line).slice().sort((a, b) => b.fit - a.fit || a.key.localeCompare(b.key));
    const n = members.length;
    const centre = FAMILY_QUADRANT[line].angle;
    members.forEach((c, i) => {
      const side = i === 0 ? 0 : (i % 2 === 1 ? -1 : 1) * Math.ceil(i / 2);
      const step = n > 1 ? (WEDGE_HALF * 2 * 0.8) / Math.max(2, n - 1) : 0;
      const p = polar(centre + side * step, fitToT(c.fit));
      pts.push({ key: c.key, line, x: p.x, y: p.y, home: centre, hw: halfWidth(c.key) });
    });
  }
  const project = (p: (typeof pts)[number]) => {
    const { angle, t } = toPolar(p.x, p.y);
    const delta = Math.max(-WEDGE_HALF, Math.min(WEDGE_HALF, angleDelta(angle, p.home)));
    // Step outwards along the token's own ray until its footprint clears the hub (the collision fix: a strong fit
    // in a crowded quadrant used to be pushed onto the hub); the board's edges are never crossed.
    let tt = Math.max(T_MIN, Math.min(T_MAX, t));
    for (let k = 0; k < 80; k++) {
      const q = polar(p.home + delta, tt);
      p.x = q.x;
      p.y = q.y;
      const corridor = CAPTION_CORRIDOR + p.hw - 61;
      if (p.y < HUB.y && Math.abs(p.x - HUB.x) < corridor) p.x = HUB.x + Math.sign(p.x - HUB.x || Math.cos((p.home * Math.PI) / 180)) * corridor;
      p.x = Math.max(p.hw + 8, Math.min(BOARD_W - p.hw - 8, p.x));
      p.y = Math.max(TOKEN_UP + 8, Math.min(BOARD_H - TOKEN_DOWN - 8, p.y));
      if (!hitsHub(p, p.hw)) break;
      tt += 0.01;
    }
  };
  pts.forEach(project);
  for (let pass = 0; pass < 240; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const clearX = a.hw + b.hw + GAP_X;
        const dx = (b.x - a.x) / clearX;
        const dy = (b.y - a.y) / CLEAR_Y;
        const d = Math.hypot(dx, dy);
        if (d >= 1) continue;
        moved = true;
        // Coincident points split along the wedge's tangent so the result does not depend on float noise.
        const ux = d > 1e-6 ? dx / d : -Math.sin((a.home * Math.PI) / 180);
        const uy = d > 1e-6 ? dy / d : Math.cos((a.home * Math.PI) / 180);
        const push = (1 - d) / 2 + 0.01;
        a.x -= ux * push * clearX;
        a.y -= uy * push * CLEAR_Y;
        b.x += ux * push * clearX;
        b.y += uy * push * CLEAR_Y;
      }
    }
    pts.forEach(project);
    if (!moved) break;
  }
  // Rounded so server and browser print identical CSS (float formatting differs between them and breaks hydration).
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return pts.map((p) => ({ key: p.key, line: p.line, x: r4(p.x), y: r4(p.y), left: r4((p.x / BOARD_W) * 100), top: r4((p.y / BOARD_H) * 100) }));
}

/** A gentle curve from the hub to a token: the control point leans off the straight line, alternating by family. */
export function signalPath(slot: Pick<BoardSlot, "x" | "y" | "line">): string {
  const mx = (HUB.x + slot.x) / 2;
  const my = (HUB.y + slot.y) / 2;
  const dx = slot.x - HUB.x;
  const dy = slot.y - HUB.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = (slot.line === "attack" || slot.line === "defence" ? 1 : -1) * Math.min(60, len * 0.12);
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M ${HUB.x} ${HUB.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${slot.x.toFixed(1)} ${slot.y.toFixed(1)}`;
}
