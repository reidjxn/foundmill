import { useId, type CSSProperties, type HTMLAttributes } from "react";
import { CircleAlert, CircleX, Pause, TriangleAlert } from "lucide-react";
import type { AgentStatus, DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { deptColourVar, mixWith } from "../../lib/colour";
import { initials } from "../../lib/format";
import { createRng, hashSeed } from "../../lib/seed";
import { Icon, type IconComponent } from "./Icon";
import { agentStatusTone } from "./StatusPill";

/** DESIGN §6: 18–64, plus 68 for the conversation's presence portrait. Any number works; these are the steps. */
export const AVATAR_SIZES = [18, 20, 22, 24, 26, 28, 32, 36, 48, 64, 68] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarRing = "good" | "warn" | "bad" | "idle" | "none";

/**
 * Where the agent is, separate from its health ring (DESIGN §8 "Avatar"): live (in a conversation now) and working
 * (in a session) breathe; available is a solid dot; away is hollow; down carries a bar. The words go in the label.
 */
export type AvatarPresence = "live" | "working" | "available" | "away" | "down";
export const AVATAR_PRESENCES: readonly AvatarPresence[] = ["live", "working", "available", "away", "down"];

/** The surface behind the avatar, for the presence dot's cut-out. Default surface-1 (a panel). */
export type AvatarSurface = "canvas" | "rail" | "surface-1" | "surface-2" | "surface-3" | "ink";

export interface AgentAvatarSpec {
  /** `avatar_seed` from the agent row. */
  seed: string | number;
  /** Department colour token; the palette is derived from it. */
  dept: DeptColourToken;
  /** Drawing is a 40×40 viewBox; this sets the width/height attributes. Default 32. */
  size?: number;
  title?: string;
  /** Appended to the SVG's internal ids, so two drawings of one seed on a page never share defs. */
  uid?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The portrait's tones from one department token, with no colour literals (CSS color-mix at paint time):
 * [base, head (bright), shard (light), body (dark), ground light, ground deep, collar, hair shade].
 */
export function deptPalette(dept: DeptColourToken): string[] {
  const base = deptColourVar(dept);
  return [
    base,
    mixWith(base, "white", 18),
    mixWith(base, "white", 50),
    mixWith(base, "ink", 30),
    mixWith(base, "ink", 70),
    mixWith(base, "ink", 84),
    mixWith(base, "ink", 55),
    mixWith(base, "ink", 15),
  ];
}

const f1 = (n: number) => n.toFixed(1);

/**
 * Procedural head-and-shoulders portrait (DESIGN §8 "Avatar"), seeded by avatar_seed in the department palette: a
 * diagonal two-tone ground, a light shard and a small accent square, the shoulders in the dark tint with a collar line,
 * and the head in the bright tint with a shaded top half (the hair). Faceless by design. Pure and deterministic: the
 * same seed and department always draw the same portrait.
 */
export function generateAvatar(spec: AgentAvatarSpec): string {
  const rng = createRng(`avatar:${spec.seed}`);
  const [, head, shard, body, groundLight, groundDeep, collar, hair] = deptPalette(spec.dept).map(esc) as [string, string, string, string, string, string, string, string];
  const uid = (spec.uid ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  const id = `avatar-${hashSeed(`${spec.seed}|${spec.dept}`).toString(36)}${uid}`;
  const size = spec.size ?? 32;
  const title = esc(spec.title ?? "Agent avatar");

  const hx = 17 + rng.next() * 6;
  const hy = 15 + rng.next() * 3;
  const hr = 6.6 + rng.next() * 1.6;
  const bx = 20 + (rng.next() - 0.5) * 4;
  const brx = 13 + rng.next() * 3;
  const s1 = rng.next() * 40;
  const s2 = rng.next() * 40;
  const side = rng.next() > 0.5;
  const shardPts = side ? `0,${f1(s1)} 40,${f1(s2 * 0.4)} 40,0 0,0` : `0,${f1(s1 * 0.5)} ${f1(14 + s2 * 0.5)},0 0,0`;
  const ax = 6 + rng.next() * 26;
  const ay = 6 + rng.next() * 10;
  const rot = Math.round(rng.next() * 90);
  const bry = 13 + rng.next() * 2;
  const collarDip = 33 + rng.next() * 3;
  const shade = (0.35 + rng.next() * 0.4).toFixed(2);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-label="${title}" data-avatar="portrait">` +
    `<title>${title}</title>` +
    `<defs><clipPath id="${id}-clip"><circle cx="20" cy="20" r="20"/></clipPath>` +
    `<linearGradient id="${id}-ground" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${groundLight}"/><stop offset="1" style="stop-color:${groundDeep}"/></linearGradient></defs>` +
    `<g clip-path="url(#${id}-clip)">` +
    `<rect width="40" height="40" fill="url(#${id}-ground)"/>` +
    `<polygon points="${shardPts}" style="fill:${shard}" opacity=".16"/>` +
    `<rect x="${f1(ax)}" y="${f1(ay)}" width="5" height="5" rx="1" style="fill:${shard}" opacity=".55" transform="rotate(${rot} ${f1(ax + 2.5)} ${f1(ay + 2.5)})"/>` +
    `<ellipse data-part="body" cx="${f1(bx)}" cy="41" rx="${f1(brx)}" ry="${f1(bry)}" style="fill:${body}"/>` +
    `<path d="M${f1(bx - brx * 0.55)},30 Q${f1(bx)},${f1(collarDip)} ${f1(bx + brx * 0.55)},30" style="stroke:${collar}" stroke-width="1.2" fill="none" opacity=".7"/>` +
    `<circle data-part="head" cx="${f1(hx)}" cy="${f1(hy)}" r="${f1(hr)}" style="fill:${head}"/>` +
    `<path data-part="hair" d="M${f1(hx - hr)},${f1(hy)} A${f1(hr)},${f1(hr)} 0 0 1 ${f1(hx + hr)},${f1(hy)} Z" style="fill:${hair}" opacity="${shade}"/>` +
    `</g></svg>`
  );
}

/** Map the shared agent status vocabulary to a ring tone (paused is neutral, as its pill is: not a warning). */
export function ringForStatus(status: AgentStatus | undefined): AvatarRing {
  switch (status) {
    case "healthy":
      return "good";
    case "degraded":
      return "warn";
    case "failing":
    case "injured":
      return "bad";
    case "idle":
    case "paused":
      return "idle";
    default:
      return "none";
  }
}

/**
 * The shape that goes with the ring's colour, so health never rests on hue alone (DESIGN §2, WCAG 1.4.1): a dashed ring
 * for an agent at rest (idle, paused) and a glyph badge for one that needs looking at (degraded, failing, Down,
 * paused). Exported for tests.
 */
export function statusGlyph(status: AgentStatus | undefined): IconComponent | null {
  switch (status) {
    case "degraded":
      return TriangleAlert;
    case "failing":
      return CircleX;
    case "injured":
      return CircleAlert;
    case "paused":
      return Pause;
    default:
      return null;
  }
}

/** The `--tone` class per ring (idle is text-4: present, not a signal). */
const RING_TONE: Record<Exclude<AvatarRing, "none">, string> = {
  good: "tone-status-good",
  warn: "tone-status-warn",
  bad: "tone-status-bad",
  idle: "tone-disabled",
};

const PRESENCE_TONE: Record<AvatarPresence, string> = {
  live: "tone-status-good",
  working: "tone-status-info",
  available: "tone-status-good",
  away: "tone-tertiary",
  down: "tone-status-bad",
};

/** Words for a bare ring tone (no status given). With a status, the label uses the status's own word (agentStatusTone). */
const RING_WORD: Record<AvatarRing, string> = { good: "healthy", warn: "needs attention", bad: "failing", idle: "idle", none: "" };
const PRESENCE_WORD: Record<AvatarPresence, string> = { live: "live", working: "working", available: "available", away: "away", down: "down" };

/**
 * Ring and dot geometry by size: the ring sits 3 px out (2 px at 26–28, 1.5 px at 24 and under, so dense rows keep
 * their footprint); the dot is 9 px (7 px at 24 and under, 12 px from 48) with a 2 px cut-out (1.5 px when small),
 * centred on the face's edge at 45°.
 */
export function avatarGeometry(size: number): { gap: number; dot: number; cut: number; dotInset: number } {
  const gap = size <= 24 ? 1.5 : size <= 28 ? 2 : 3;
  const dot = size <= 24 ? 7 : size < 48 ? 9 : 12;
  const cut = size <= 24 ? 1.5 : 2;
  // The 45° point on the circle sits size/2 * (1 - 1/√2) in from the box's corner.
  const dotInset = Math.round(((size / 2) * (1 - Math.SQRT1_2) - dot / 2) * 10) / 10;
  return { gap, dot, cut, dotInset };
}

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: AvatarSize | number;
  /** Display name; used for the accessible label and for human initials. */
  name: string;
  /** Agent portrait when set; otherwise a human initials avatar. */
  agent?: { seed: string | number; dept: DeptColourToken };
  /** Status ring (1.5 px, a few px out). Pass `status` from the shared vocabulary or a ring tone directly. */
  status?: AgentStatus;
  ring?: AvatarRing;
  /** Presence: the breathing ring (live, working) and the presence dot. Named in the label. */
  presence?: AvatarPresence;
  /** The surface the avatar sits on, so the presence dot's cut-out matches it. Default surface-1. */
  surface?: AvatarSurface;
  /** Image for humans with a photo; falls back to initials if absent. */
  src?: string;
  /** In an overlapping strip: the face and ring are cut out of `surface`, so rings never cross a neighbour's face. */
  stacked?: boolean;
}

/**
 * Agents get a procedural portrait; humans get initials (Inter 600, text-2) on surface 2, or their photo. A 10 % white
 * hairline keeps every face apart from its surface. Server-safe: the breathing ring is CSS.
 */
export function Avatar({ size = 32, name, agent, status, ring, presence, surface, src, stacked, className, style, ...rest }: AvatarProps) {
  const uid = useId();
  const tone = ring ?? ringForStatus(status);
  // The status's own word ("degraded", "paused", "down"), as its pill says it; a bare ring falls back to its tone's word.
  const statusWord = status && !ring ? agentStatusTone(status).word.toLowerCase() : RING_WORD[tone];
  const words = [statusWord, presence ? PRESENCE_WORD[presence] : ""].filter(Boolean);
  const glyph = ring ? null : statusGlyph(status);
  const label = words.length ? `${name}, ${words.join(", ")}` : name;
  const geo = avatarGeometry(size);
  const breathes = presence === "live" || presence === "working";
  const fontSize = Math.max(7, Math.round(size * 0.36));
  const box = {
    width: size,
    height: size,
    "--avatar-gap": `${geo.gap}px`,
    "--avatar-cut-width": `${geo.cut}px`,
    ...(surface ? { "--avatar-cut": `var(--${surface})` } : null),
    ...style,
  } as CSSProperties;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("relative inline-flex shrink-0 align-middle", tone !== "none" ? RING_TONE[tone] : presence ? PRESENCE_TONE[presence] : null, stacked && "avatar-stacked", className)}
      style={box}
      data-ring={tone}
      data-presence={presence}
      {...rest}
    >
      <span aria-hidden className={cn("avatar-face", agent ? null : "bg-surface-2")}>
        {agent ? (
          <span className="contents" dangerouslySetInnerHTML={{ __html: generateAvatar({ seed: agent.seed, dept: agent.dept, size, title: name, uid }) }} />
        ) : src ? (
          <img src={src} alt="" className="object-cover" />
        ) : (
          <span className="font-body font-semibold leading-none text-secondary" style={{ fontSize }}>
            {initials(name)}
          </span>
        )}
      </span>
      {tone !== "none" ? <span aria-hidden className="avatar-ring" data-lit={breathes || undefined} data-dashed={tone === "idle" || undefined} /> : null}
      {glyph ? (
        <span aria-hidden className="avatar-glyph" style={{ width: geo.dot + 2, height: geo.dot + 2, right: geo.dotInset - 1, top: geo.dotInset - 1 }} data-glyph={status}>
          <Icon icon={glyph} size={geo.dot} strokeWidth={2.25} />
        </span>
      ) : null}
      {breathes ? <span aria-hidden className="avatar-breathe" /> : null}
      {presence ? (
        <span
          aria-hidden
          className={cn("presence-dot", PRESENCE_TONE[presence])}
          data-presence={presence}
          style={{ width: geo.dot, height: geo.dot, right: geo.dotInset, bottom: geo.dotInset }}
        />
      ) : null}
    </span>
  );
}

export interface AvatarStackProps {
  items: Array<Pick<AvatarProps, "name" | "agent" | "status" | "ring" | "src" | "presence">>;
  size?: AvatarSize | number;
  max?: number;
  /** The surface behind the stack, for the presence dots' cut-outs. */
  surface?: AvatarSurface;
  className?: string;
}

/** Overlapping team strip; shows "+N" after `max`. Later faces sit on top, each ring drawn over its neighbour. */
export function AvatarStack({ items, size = 24, max = 6, surface, className }: AvatarStackProps) {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((it, i) => (
        <Avatar key={`${it.name}-${i}`} size={size} surface={surface} stacked {...it} className={cn(i > 0 && "-ml-1.5")} />
      ))}
      {extra > 0 ? (
        <span
          className="avatar-face -ml-1.5 shrink-0 bg-surface-2 px-1.5 font-mono text-micro text-secondary tabular"
          style={{
            width: "auto",
            height: size,
            minWidth: size,
            // Cut out of the surface like the faces before it.
            boxShadow: `0 0 0 1px color-mix(in oklab, var(--white) 10%, transparent), 0 0 0 2px var(--${surface ?? "surface-1"})`,
          }}
          aria-label={`${extra} more`}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
