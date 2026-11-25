/**
 * Visits counted by Foundmill (founder, Nov 25, 2026; packages/shared `page-visits.ts`): the last 7 and 28 days and
 * where they came from, labeled an estimate. Product › Public page shows the page's (0175), Product › Site the Site's
 * (0176); `note` says how that surface counts. Free on every plan.
 */
import { Term } from "@foundmill/dugout";
import { PAGE_VISIT_SOURCE_LABELS, type PageVisitSummary } from "@foundmill/shared/page-visits";

const n = (v: number) => v.toLocaleString("en-US");

export function PageVisits({ visits, note }: { visits: PageVisitSummary; note: string }) {
  return (
    <section className="flex flex-col gap-1" data-testid="page-visits">
      <p className="t-body text-primary tabular-nums">
        {visits.total === 0
          ? `No visits counted in the last ${visits.windowDays} days yet.`
          : `${n(visits.last7)} ${visits.last7 === 1 ? "visit" : "visits"} in the last 7 days, ${n(visits.total)} in the last ${visits.windowDays} days.`}{" "}
        <Term id="estimate" always>
          Estimate
        </Term>
      </p>
      {visits.bySource.length ? (
        <p className="t-small text-secondary tabular-nums" data-testid="page-visit-sources">
          {visits.bySource.map((x) => `${PAGE_VISIT_SOURCE_LABELS[x.source]} ${n(x.visits)}`).join(" · ")}
        </p>
      ) : null}
      <p className="t-small text-secondary">{note}</p>
    </section>
  );
}
