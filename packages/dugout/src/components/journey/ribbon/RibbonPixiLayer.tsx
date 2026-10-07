import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Application, Graphics } from "pixi.js";
import { cn } from "../../../lib/cn";

/**
 * The Ribbon's PixiJS 8 overlay: a transparent canvas above the SVG that draws the flow-in light sweep (1.2 s,
 * following the SVG reveal mask) and the live ripples into the Today line (300 ms rings, DESIGN §7).
 *
 * pixi.js is imported lazily on mount so the SVG ribbon renders (and tests run) without WebGL. When the renderer
 * cannot start (no WebGL, SSR, reduced motion) the layer renders nothing and the ribbon falls back to SVG rings.
 */

export interface PixiRipple {
  x: number;
  y: number;
  /** Hex colour (Pixi cannot read CSS variables). */
  colour: string;
  /** Final radius in px. Default 28. */
  radius?: number;
}

export interface RibbonPixiLayerHandle {
  ripple(r: PixiRipple): void;
  /** Start the flow-in sweep: a light edge travelling 0 → width over `durationMs`. */
  sweep(durationMs: number, colour: string, band: { top: number; bottom: number }): void;
  /** True once the renderer is running (tests and fallbacks read it). */
  ready(): boolean;
}

export interface RibbonPixiLayerProps {
  width: number;
  height: number;
  /** Disable entirely (reduced motion, `overlay="svg"`). */
  enabled?: boolean;
  className?: string;
  /** Called when the renderer failed to start so the owner can use the SVG fallback. */
  onUnavailable?: () => void;
}

const loadPixi = () => import("pixi.js");
type PixiModule = Awaited<ReturnType<typeof loadPixi>>;

interface LiveRipple {
  g: Graphics;
  x: number;
  y: number;
  colour: number;
  radius: number;
  t: number;
}

interface LiveSweep {
  g: Graphics;
  colour: number;
  top: number;
  bottom: number;
  t: number;
  duration: number;
}

export const RIPPLE_MS = 300;

function hexToNumber(hex: string): number {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

/** Ease-out used for ripples and the sweep (the Dugout curve's spirit; Pixi has no CSS easing). */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export const RibbonPixiLayer = forwardRef<RibbonPixiLayerHandle, RibbonPixiLayerProps>(function RibbonPixiLayer({ width, height, enabled = true, className, onUnavailable }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const pixiRef = useRef<PixiModule | null>(null);
  const ripples = useRef<LiveRipple[]>([]);
  const sweeps = useRef<LiveSweep[]>([]);
  const readyRef = useRef(false);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !host.current) return;
    let cancelled = false;
    let app: Application | null = null;
    (async () => {
      try {
        const pixi = await loadPixi();
        if (cancelled) return;
        app = new pixi.Application();
        await app.init({
          width: Math.max(1, width),
          height: Math.max(1, height),
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
          autoDensity: true,
          preference: "webgl",
        });
        if (cancelled || !host.current) {
          app.destroy(true, { children: true });
          return;
        }
        host.current.appendChild(app.canvas);
        pixiRef.current = pixi;
        appRef.current = app;
        readyRef.current = true;
        app.ticker.add((ticker) => {
          const dt = ticker.deltaMS;
          for (const r of ripples.current) {
            r.t += dt;
            const p = Math.min(1, r.t / RIPPLE_MS);
            const e = easeOut(p);
            r.g.clear();
            r.g.circle(r.x, r.y, 3 + e * (r.radius - 3)).stroke({ width: 2 - e, color: r.colour, alpha: 1 - e });
            r.g.circle(r.x, r.y, 2 + e * 4).fill({ color: r.colour, alpha: 0.9 * (1 - e) });
          }
          ripples.current = ripples.current.filter((r) => {
            if (r.t < RIPPLE_MS) return true;
            r.g.destroy();
            return false;
          });
          for (const s of sweeps.current) {
            s.t += dt;
            const p = Math.min(1, s.t / s.duration);
            const x = easeOut(p) * width;
            s.g.clear();
            // A soft leading edge: a few translucent bars trailing the reveal front.
            for (let i = 0; i < 6; i++) {
              const w = 10;
              s.g.rect(x - (i + 1) * w, s.top, w, s.bottom - s.top).fill({ color: s.colour, alpha: 0.22 * (1 - i / 6) * (1 - p * 0.6) });
            }
            s.g.rect(x - 1.5, s.top - 4, 3, s.bottom - s.top + 8).fill({ color: 0xffffff, alpha: 0.55 * (1 - p) });
          }
          sweeps.current = sweeps.current.filter((s) => {
            if (s.t < s.duration) return true;
            s.g.destroy();
            return false;
          });
        });
      } catch {
        readyRef.current = false;
        unavailableRef.current?.();
      }
    })();
    return () => {
      cancelled = true;
      readyRef.current = false;
      ripples.current = [];
      sweeps.current = [];
      const a = appRef.current ?? app;
      appRef.current = null;
      if (a) {
        try {
          a.destroy(true, { children: true });
        } catch {
          /* renderer already gone */
        }
      }
    };
    // Size changes are handled by resize below; (re)creating the app per size would drop in-flight ripples.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const app = appRef.current;
    if (app && readyRef.current) app.renderer.resize(Math.max(1, width), Math.max(1, height));
  }, [width, height]);

  useImperativeHandle(
    ref,
    () => ({
      ready: () => readyRef.current,
      ripple(r) {
        const app = appRef.current;
        const pixi = pixiRef.current;
        if (!app || !pixi || !readyRef.current) return;
        const g = new pixi.Graphics();
        app.stage.addChild(g);
        ripples.current.push({ g, x: r.x, y: r.y, colour: hexToNumber(r.colour), radius: r.radius ?? 28, t: 0 });
      },
      sweep(durationMs, colour, band) {
        const app = appRef.current;
        const pixi = pixiRef.current;
        if (!app || !pixi || !readyRef.current) return;
        const g = new pixi.Graphics();
        app.stage.addChild(g);
        sweeps.current.push({ g, colour: hexToNumber(colour), top: band.top, bottom: band.bottom, t: 0, duration: durationMs });
      },
    }),
    [],
  );

  if (!enabled) return null;
  return <div ref={host} aria-hidden className={cn("pointer-events-none absolute inset-0 [&>canvas]:block", className)} data-pixi-layer />;
});
