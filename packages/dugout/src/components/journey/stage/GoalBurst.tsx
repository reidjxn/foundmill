import { useEffect, useRef } from "react";
import type { Application } from "pixi.js";
import { createRng } from "../../../lib/seed";
import { cn } from "../../../lib/cn";

/**
 * The Goal moment's particle burst (DESIGN §7): a PixiJS 8 ParticleContainer of a few hundred particles in
 * kit-secondary and gold, fired from the centre and falling for 1.2 s. Deterministic from `seed`. pixi.js is
 * imported lazily; when the renderer cannot start nothing is drawn (the static gold card carries the facts).
 */
export interface GoalBurstProps {
  width: number;
  height: number;
  /** Hex colours; typically [kit.secondary, "#E8C56B"]. */
  colours: string[];
  seed: string | number;
  /** Particle count. Default 260. */
  count?: number;
  durationMs?: number;
  className?: string;
  /** Reduced motion or `overlay="none"`: render nothing. */
  enabled?: boolean;
}

export const GOAL_BURST_MS = 1200;

function hexToNumber(hex: string): number {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

export function GoalBurst({ width, height, colours, seed, count = 260, durationMs = GOAL_BURST_MS, className, enabled = true }: GoalBurstProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !host.current || width <= 0 || height <= 0) return;
    let cancelled = false;
    let app: Application | null = null;
    (async () => {
      try {
        const pixi = await import("pixi.js");
        if (cancelled || !host.current) return;
        app = new pixi.Application();
        await app.init({ width, height, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: "webgl" });
        if (cancelled || !host.current) {
          app.destroy(true, { children: true });
          return;
        }
        host.current.appendChild(app.canvas);
        const container = new pixi.ParticleContainer({ dynamicProperties: { position: true, scale: true, color: true, rotation: false, vertex: false } });
        app.stage.addChild(container);
        const rng = createRng(`goal:${seed}`);
        const palette = colours.length > 0 ? colours.map(hexToNumber) : [0xffffff];
        const cx = width / 2;
        const cy = height / 2;
        const sim = Array.from({ length: count }, () => {
          const angle = rng.range(0, Math.PI * 2);
          const speed = rng.range(0.18, 0.62); // px per ms
          const size = rng.range(0.18, 0.5);
          const particle = new pixi.Particle({ texture: pixi.Texture.WHITE, x: cx, y: cy, scaleX: size, scaleY: size * rng.range(0.6, 1.4), anchorX: 0.5, anchorY: 0.5, tint: rng.pick(palette), alpha: 1 });
          container.addParticle(particle);
          return { particle, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 0.25, size, life: rng.range(0.7, 1) * durationMs };
        });
        let elapsed = 0;
        app.ticker.add((ticker) => {
          const dt = ticker.deltaMS;
          elapsed += dt;
          for (const p of sim) {
            const t = Math.min(1, elapsed / p.life);
            p.vy += 0.0012 * dt;
            p.particle.x += p.vx * dt;
            p.particle.y += p.vy * dt;
            p.particle.alpha = 1 - t * t;
            const s = p.size * (1 - t * 0.5);
            p.particle.scaleX = s;
            p.particle.scaleY = s;
          }
          if (elapsed > durationMs * 1.1 && app) app.ticker.stop();
        });
      } catch {
        /* no renderer: the static card carries the moment */
      }
    })();
    return () => {
      cancelled = true;
      if (app) {
        try {
          app.destroy(true, { children: true });
        } catch {
          /* already destroyed */
        }
        app = null;
      }
    };
  }, [enabled, width, height, colours, seed, count, durationMs]);
  if (!enabled) return null;
  return <div ref={host} aria-hidden className={cn("pointer-events-none absolute inset-0 [&>canvas]:block", className)} data-goal-burst />;
}
