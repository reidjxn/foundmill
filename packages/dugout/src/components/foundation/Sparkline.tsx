import { useId, type SVGAttributes } from "react";
import { area as d3Area, curveMonotoneX, line as d3Line } from "d3-shape";
import { cn } from "../../lib/cn";

export interface SparklineProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height" | "fill"> {
  data: readonly number[];
  /** Default 48×16 (DESIGN §9). */
  width?: number;
  height?: number;
  /** Stroke uses currentColor: set the colour with a text-* class (e.g. text-kit-primary). */
  strokeWidth?: number;
  /** Area under the line: a three-stop gradient of the line's colour (22 % → 6 % → 0). */
  fill?: boolean;
  /** Dot on the last point, with a halo: the "now" end of the line. */
  dot?: boolean;
  /** Fixed y domain; otherwise min/max of the data (flat data gets a 1-unit band). */
  domain?: [number, number];
  /** Accessible description. Default summarises first → last. */
  label?: string;
  /** Straight segments instead of a monotone curve. */
  linear?: boolean;
}

/**
 * A small SVG line (DESIGN §8): round joins, an optional three-stop area gradient and a haloed end dot, all in
 * currentColor. Pure, deterministic, no axes. Server-safe (useId only).
 */
export function Sparkline({ data, width = 48, height = 16, strokeWidth = 1.5, fill, dot, domain, label, linear, className, ...rest }: SparklineProps) {
  const id = useId();
  const n = data.length;
  const pad = strokeWidth;
  let [lo, hi] = domain ?? [Math.min(...data), Math.max(...data)];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (hi === lo) {
    lo -= 0.5;
    hi += 0.5;
  }
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2);
  const pts = Array.from(data, (v, i) => [x(i), y(v)] as [number, number]);
  const curve = linear ? undefined : curveMonotoneX;
  const lineGen = d3Line<[number, number]>()
    .x((d) => d[0])
    .y((d) => d[1]);
  const areaGen = d3Area<[number, number]>()
    .x((d) => d[0])
    .y0(height - pad)
    .y1((d) => d[1]);
  if (curve) {
    lineGen.curve(curve);
    areaGen.curve(curve);
  }
  const linePath = n > 0 ? (lineGen(pts) ?? "") : "";
  const areaPath = fill && n > 1 ? (areaGen(pts) ?? "") : "";
  const first = data[0];
  const last = data[n - 1];
  const auto = n === 0 ? "No data" : n === 1 ? `Single value ${first}` : `${n} points, from ${first} to ${last}`;
  return (
    <svg
      role="img"
      aria-label={label ?? auto}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block shrink-0 overflow-visible align-middle", className)}
      {...rest}
    >
      {areaPath ? (
        <>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
              <stop offset="60%" stopColor="currentColor" stopOpacity={0.06} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${id}-fill)`} stroke="none" data-testid={`${id}-area`} />
        </>
      ) : null}
      {linePath ? <path d={linePath} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {dot && n > 0 ? (
        <>
          <circle cx={x(n - 1)} cy={y(last as number)} r={strokeWidth + 2.5} fill="currentColor" opacity={0.22} data-sparkline-halo="" />
          <circle cx={x(n - 1)} cy={y(last as number)} r={strokeWidth + 0.5} fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
