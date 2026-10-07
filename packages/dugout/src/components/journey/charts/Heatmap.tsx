import { cn } from "../../../lib/cn";
import { formatNumber } from "../../../lib/format";
import { ChartTooltip, Responsive, toneVar, useChartTooltip, type SeriesTone } from "./common";

export interface HeatmapProps {
  rows: string[];
  cols: string[];
  /** values[row][col]. */
  values: number[][];
  label: string;
  width?: number;
  /** Cell height. Default 18. */
  cellHeight?: number;
  tone?: SeriesTone;
  /** Upper bound for the colour scale; default the max value. */
  max?: number;
  format?: (v: number) => string;
  /** Show every Nth column label. Default: fit. */
  colLabelEvery?: number;
  onSelect?: (row: number, col: number, value: number) => void;
  className?: string;
}

/** Cells in one tone at value alpha (0.08 → 0.95). Hover shows the value; zero cells stay hairline. */
export function Heatmap({ rows, cols, values, label, width, cellHeight = 18, tone = "kit", max, format = (v) => formatNumber(v, { maxDigits: 1 }), colLabelEvery, onSelect, className }: HeatmapProps) {
  const labelW = 72;
  const height = rows.length * cellHeight + 20;
  return (
    <Responsive width={width} height={height} className={className}>
      {(w) => <HeatmapSvg rows={rows} cols={cols} values={values} label={label} width={w} height={height} cellHeight={cellHeight} tone={tone} max={max} format={format} labelW={labelW} colLabelEvery={colLabelEvery} onSelect={onSelect} />}
    </Responsive>
  );
}

function HeatmapSvg({ rows, cols, values, label, width, height, cellHeight, tone, max, format, labelW, colLabelEvery, onSelect }: Required<Omit<HeatmapProps, "className" | "colLabelEvery" | "onSelect" | "max" | "width">> & { width: number; height: number; labelW: number; max?: number; colLabelEvery?: number; onSelect?: HeatmapProps["onSelect"] }) {
  const cellW = Math.max(2, (width - labelW) / Math.max(1, cols.length));
  const top = Math.max(1e-9, max ?? Math.max(0, ...values.flat()));
  const every = colLabelEvery ?? Math.max(1, Math.ceil(28 / cellW));
  const { tip, show, hide } = useChartTooltip<{ r: number; c: number; v: number }>();
  const total = values.flat().reduce((s, v) => s + v, 0);
  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`${label}. ${rows.length} rows by ${cols.length} columns, total ${format(total)}, peak ${format(top)}`} className="block">
        {cols.map((c, j) => (j % every === 0 ? (
          <text key={c} x={labelW + j * cellW + cellW / 2} y={12} textAnchor="middle" fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={11}>
            {c}
          </text>
        ) : null))}
        {rows.map((r, i) => (
          <g key={r} data-heat-row={r}>
            <text x={labelW - 8} y={20 + i * cellHeight + cellHeight / 2} textAnchor="end" dominantBaseline="central" fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={12}>
              {r}
            </text>
            {cols.map((c, j) => {
              const v = values[i]?.[j] ?? 0;
              const a = v <= 0 ? 0 : 0.08 + 0.87 * Math.min(1, v / top);
              const interactive = !!onSelect;
              return (
                <rect
                  key={c}
                  x={labelW + j * cellW + 0.5}
                  y={20 + i * cellHeight + 0.5}
                  width={Math.max(1, cellW - 1)}
                  height={cellHeight - 1}
                  rx={1}
                  fill={v <= 0 ? "var(--bg-panel-alt)" : toneVar(tone)}
                  fillOpacity={v <= 0 ? 1 : a}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-label={interactive ? `${r}, ${c}: ${format(v)}` : undefined}
                  className={cn(interactive && "cursor-pointer outline-none focus-visible:stroke-link focus-visible:[stroke-width:2]")}
                  onPointerMove={() => show(labelW + j * cellW + cellW / 2, 20 + i * cellHeight, { r: i, c: j, v })}
                  onPointerLeave={hide}
                  onClick={() => onSelect?.(i, j, v)}
                  onKeyDown={(e) => {
                    if (interactive && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect?.(i, j, v);
                    }
                  }}
                  data-heat-cell={`${i}:${j}`}
                >
                  <title>{`${r}, ${c}: ${format(v)}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      {tip ? (
        <ChartTooltip x={tip.x} y={tip.y} width={width}>
          <div className="t-label">
            {rows[tip.datum.r]} · {cols[tip.datum.c]}
          </div>
          <div className="tabular-nums">{format(tip.datum.v)}</div>
        </ChartTooltip>
      ) : null}
    </>
  );
}
