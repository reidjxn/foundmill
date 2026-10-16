/**
 * The app frame while a layout loads its business (app/b/loading.tsx, the LIVE layout): the sidebar rail, the top bar
 * and the screen skeleton, all shimmering bars (DESIGN §7). It lets the server send the document head, and the browser
 * start on the scripts, before the layout's data is in. Neutral, not brand-colored: the business is not known yet.
 * Server-safe (Skeleton and Panel are pure CSS).
 */
import { Skeleton } from "@foundmill/dugout";
import { ScreenSkeleton } from "./ScreenSkeleton";

/** Sidebar entries of uneven length, as real labels are. */
const RAIL_ITEMS = ["w-28", "w-20", "w-24", "w-32", "w-20", "w-28", "w-32", "w-16"];

export function ShellSkeleton() {
  return (
    <div className="flex h-screen w-full min-w-(--min-viewport) overflow-hidden canvas-lit text-primary" aria-busy="true" aria-label="Loading" data-testid="shell-skeleton">
      <div className="shell-rail flex h-full w-sidebar shrink-0 flex-col gap-4 px-5 pt-5" aria-hidden>
        {RAIL_ITEMS.map((width, i) => (
          <Skeleton key={i} index={i} className={width} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="rule-under flex h-kitbar shrink-0 items-center gap-3 px-4" aria-hidden>
          <Skeleton shape="circle" className="size-8" />
          <Skeleton className="h-4 w-40" index={1} />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScreenSkeleton />
        </div>
      </div>
    </div>
  );
}
