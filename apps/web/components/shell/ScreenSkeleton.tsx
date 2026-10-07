"use client";
/** Loading state for a screen: shimmering panel bars, never a spinner (DESIGN §7). */
import { Panel, Skeleton, SkeletonRows } from "@foundmill/dugout";

export function ScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" aria-busy="true" aria-label="Loading" data-testid="screen-skeleton">
      <Panel title={<Skeleton className="h-3 w-24" />} span={12} loading />
      <Panel title={<Skeleton className="h-3 w-16" />} span={6}>
        <SkeletonRows rows={rows} cols={3} />
      </Panel>
      <Panel title={<Skeleton className="h-3 w-20" />} span={6}>
        <SkeletonRows rows={rows} cols={3} />
      </Panel>
    </div>
  );
}
