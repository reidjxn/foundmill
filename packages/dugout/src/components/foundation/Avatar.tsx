import type { HTMLAttributes } from "react";
import type { AgentStatus, DeptColourToken } from "@founder-manager/shared";
import { cn } from "../../lib/cn";
import { deptColourVar, mixWith } from "../../lib/colour";
import { initials } from "../../lib/format";
import { createRng } from "../../lib/seed";

export const AVATAR_SIZES = [20, 24, 32, 48, 64] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarRing = "good" | "warn" | "bad" | "idle" | "none";

export interface AgentAvatarSpec {
  /** `avatar_seed` from the agent row. */
  seed: string | number;
  /** Department colour token; the palette is derived from it. */
  dept: DeptColourToken;
  /** Drawing is a 64×64 viewBox; this sets width/height attributes. Default 32. */
  size?: number;
  title?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Four tones from one department token, with no colour literals (CSS color-mix at paint time). */
export function deptPalette(dept: DeptColourToken): string[] {
  const base = deptColourVar(dept);
  return [base, mixWith(base, "white", 28), mixWith(base, "ink", 35), mixWith(base, "ink", 60)];
}

/**
 * Procedural geometric portrait (DESIGN §8): three to five overlapping shapes in the department palette,
 * seeded by avatar_seed. Pure and deterministic.
 */
export function generateAvatar(spec: AgentAvatarSpec): string {
  const rng = createRng(`avatar:${spec.seed}`);
  const palette = deptPalette(spec.dept);
  const id = `avatar-${rng.int(100000, 999999)}`;
  const count = rng.int(3, 5);
  const size = spec.size ?? 32;
  const title = esc(spec.title ?? "Agent avatar");
  const shapes: string[] = [];
  for (let i = 0; i < count; i++) {
    const kind = rng.pick(["circle", "square", "triangle", "arc"] as const);
    const fill = esc(palette[(i + 1) % palette.length] as string);
    const cx = rng.range(14, 50);
    const cy = rng.range(14, 50);
    const r = rng.range(10, 24);
    const rot = rng.int(0, 359);
    const opacity = (0.75 + rng.next() * 0.25).toFixed(2);
    switch (kind) {
      case "circle":
        shapes.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" opacity="${opacity}"/>`);
        break;
      case "square":
        shapes.push(
          `<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" rx="3" fill="${fill}" opacity="${opacity}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`,
        );
        break;
      case "triangle": {
        const p = [0, 1, 2].map((k) => {
          const a = (Math.PI * 2 * k) / 3 - Math.PI / 2;
          return `${(cx + Math.cos(a) * r * 1.15).toFixed(1)},${(cy + Math.sin(a) * r * 1.15).toFixed(1)}`;
        });
        shapes.push(`<polygon points="${p.join(" ")}" fill="${fill}" opacity="${opacity}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`);
        break;
      }
      case "arc":
        shapes.push(
          `<path d="M ${(cx - r).toFixed(1)} ${cy.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(cx + r).toFixed(1)} ${cy.toFixed(1)} Z" fill="${fill}" opacity="${opacity}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`,
        );
        break;
    }
  }
  const base = esc(palette[3] as string);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${title}" data-avatar-shapes="${count}">` +
    `<title>${title}</title>` +
    `<defs><clipPath id="${id}"><circle cx="32" cy="32" r="32"/></clipPath></defs>` +
    `<g clip-path="url(#${id})"><rect width="64" height="64" fill="${base}"/>${shapes.join("")}</g>` +
    `</svg>`
  );
}

/** Map the shared agent status vocabulary to a ring tone. */
export function ringForStatus(status: AgentStatus | undefined): AvatarRing {
  switch (status) {
    case "healthy":
      return "good";
    case "degraded":
    case "paused":
      return "warn";
    case "failing":
    case "injured":
      return "bad";
    case "idle":
      return "idle";
    default:
      return "none";
  }
}

const RING_CLASS: Record<AvatarRing, string> = {
  good: "ring-2 ring-status-good",
  warn: "ring-2 ring-status-warn",
  bad: "ring-2 ring-status-bad",
  idle: "ring-2 ring-subtle",
  none: "",
};

const RING_WORD: Record<AvatarRing, string> = { good: "healthy", warn: "waiting", bad: "failing", idle: "idle", none: "" };

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: AvatarSize | number;
  /** Display name; used for the accessible label and for human initials. */
  name: string;
  /** Agent portrait when set; otherwise a human initials avatar. */
  agent?: { seed: string | number; dept: DeptColourToken };
  /** Status ring (2 px). Pass `status` from the shared vocabulary or a ring tone directly. */
  status?: AgentStatus;
  ring?: AvatarRing;
  /** Image for humans with a photo; falls back to initials if absent. */
  src?: string;
}

/** Agents get a procedural portrait; humans get initials on bg-panel-alt. Sizes 20, 24, 32, 48, 64 (DESIGN §8). */
export function Avatar({ size = 32, name, agent, status, ring, src, className, ...rest }: AvatarProps) {
  const tone = ring ?? ringForStatus(status);
  const word = RING_WORD[tone];
  const label = word ? `${name}, ${word}` : name;
  const fontSize = Math.max(8, Math.round(size * 0.38));
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-panel-alt align-middle", RING_CLASS[tone], className)}
      style={{ width: size, height: size }}
      data-ring={tone}
      {...rest}
    >
      {agent ? (
        <span aria-hidden className="block size-full [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: generateAvatar({ seed: agent.seed, dept: agent.dept, size, title: name }) }} />
      ) : src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden className="font-display font-semibold uppercase leading-none text-secondary" style={{ fontSize }}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}

export interface AvatarStackProps {
  items: Array<Pick<AvatarProps, "name" | "agent" | "status" | "ring" | "src">>;
  size?: AvatarSize | number;
  max?: number;
  className?: string;
}

/** Overlapping squad strip; shows "+N" after `max`. */
export function AvatarStack({ items, size = 24, max = 6, className }: AvatarStackProps) {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((it, i) => (
        <Avatar key={`${it.name}-${i}`} size={size} {...it} className={cn("ring-offset-panel", i > 0 && "-ml-1.5")} />
      ))}
      {extra > 0 ? (
        <span
          className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-panel-alt font-mono text-mono text-secondary"
          style={{ width: size, height: size }}
          aria-label={`${extra} more`}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
