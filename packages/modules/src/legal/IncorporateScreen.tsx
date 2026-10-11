"use client";
/**
 * Legal › Incorporate (BUILD §11.11): the jurisdiction recommender ("For your business, we recommend X or Y" with up
 * to six cards stamped with the date checked, always captioned "Information, not legal or tax advice"), the route
 * chooser (Stripe Atlas / Companies House / document pack) that starts the supervised session, and the session panel with the
 * workflow's status steps. The final review, submit and payment are founder-only buttons that only open the external
 * page (AC-11.11.4); "I submitted" records the founder's click.
 */
import { useId, useMemo, useState } from "react";
import { Building2, Check, CheckCircle2, Circle, CircleDashed, Compass, FileStack, Landmark, MonitorPlay, Play, Send, UserRound, XCircle } from "lucide-react";
import { Button, Chip, Field, Input, Panel, ProvenanceChip, RadioCard, RadioGroup, SimpleSelect, StarRating, Timeline, cn, useFormatters, type IconComponent, type TimelineEvent } from "@foundmill/dugout";
import { INCORPORATION_ROUTES, type IncorporationRoute } from "@foundmill/shared/constants";
import { routes } from "@foundmill/widgets/shared/routes";
import { useWidgetData } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { ROUTE_META, ROUTE_ORDER, founderCanTakeOver, readSteps, routeForJurisdiction, stepRows, type StepRow } from "./legal-data";
import { FounderLinkOut, FounderOnlyChip, INCORPORATION_PILL, InformationNotice, InlineError, Pill, Screen, fmtMoney, humanise, useAction, useCurrency, useLegalStatus, useNow } from "./shared";
import type { IncorporationStartResponse, JurisdictionCard, RecommendResponse } from "./types";

const FUNDRAISING_OPTIONS = [
  { value: "none", label: "No outside money planned" },
  { value: "angels", label: "Angels" },
  { value: "vc", label: "Venture capital" },
];

const STEP_ICON: Record<StepRow["state"], IconComponent> = { done: CheckCircle2, current: Play, todo: Circle, abandoned: XCircle };
const ROUTE_ICON: Record<IncorporationRoute, IconComponent> = { stripe_atlas: Landmark, companies_house_web: Building2, kit: FileStack };

export function JurisdictionCardView({ card, currency, onChoose, chosen }: { card: JurisdictionCard; currency: string; onChoose?: (card: JurisdictionCard) => void; chosen?: boolean }) {
  const { formatDate } = useFormatters();
  const route = ROUTE_META[card.route];
  return (
    <article aria-label={`${card.jurisdiction} ${card.entity_type}`} data-chosen={chosen || undefined} className={cn("surface-raised flex flex-col gap-2 rounded-md p-panel-pad", chosen && "row-selected")}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="t-display-sm text-primary">{card.jurisdiction}</p>
          <p className="t-small text-secondary">{card.entity_type}</p>
        </div>
        <Chip tone={card.route === "kit" ? "neutral" : "info"} className="shrink-0 whitespace-nowrap">
          {route.label}
        </Chip>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div>
          <dt className="t-label">Formation cost</dt>
          <dd className="flex items-center gap-1 t-body text-primary tabular-nums">
            {fmtMoney(card.formation_cost_minor, currency)} <ProvenanceChip kind="estimate" />
          </dd>
        </div>
        <div>
          <dt className="t-label">Annual cost</dt>
          <dd className="flex items-center gap-1 t-body text-primary tabular-nums">
            {fmtMoney(card.annual_cost_minor, currency)} <ProvenanceChip kind="estimate" />
          </dd>
        </div>
        <div>
          <dt className="t-label">Minimum capital</dt>
          <dd className="t-body text-primary tabular-nums">{card.minimum_capital_minor === 0 ? "None" : fmtMoney(card.minimum_capital_minor, currency)}</dd>
        </div>
        <div>
          <dt className="t-label">Time to form</dt>
          <dd className="t-body text-primary tabular-nums">{card.time_to_form_days} day{card.time_to_form_days === 1 ? "" : "s"}</dd>
        </div>
        <div>
          <dt className="t-label">Banking</dt>
          <dd className="t-body text-primary">{card.banking}</dd>
        </div>
        <div>
          <dt className="t-label">Investor familiarity</dt>
          <dd className="t-body text-primary">
            <StarRating value={card.investor_familiarity} label="Investor familiarity" showValue />
          </dd>
        </div>
      </dl>
      <div>
        <p className="t-label">Tax notes for you</p>
        <p className="t-body text-primary">{card.tax_notes}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="t-label">Advantages</p>
          <ul className="list-disc pl-4 t-body text-primary">
            {card.advantages.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="t-label">Disadvantages</p>
          <ul className="list-disc pl-4 t-body text-primary">
            {card.disadvantages.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      </div>
      <footer className="mt-auto flex items-center justify-between gap-2 border-t border-subtle pt-2">
        <span className="t-small text-secondary" data-date-checked={card.dateChecked}>
          Date checked {formatDate(card.dateChecked)}
        </span>
        {onChoose ? (
          <Button size="sm" variant={chosen ? "primary" : "default"} icon={chosen ? Check : Compass} onClick={() => onChoose(card)}>
            {chosen ? "Chosen" : "Choose"}
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

export function IncorporateScreen({ businessId }: ModuleScreenProps) {
  const { formatDate } = useFormatters();
  const now = useNow();
  const currency = useCurrency();
  const { navigate } = useWidgetData();
  const id = useId();
  const status = useLegalStatus();
  const recommend = useAction();
  const start = useAction();
  const submit = useAction();
  const [fundraising, setFundraising] = useState("none");
  const [coFounders, setCoFounders] = useState("0");
  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [route, setRoute] = useState<IncorporationRoute>("stripe_atlas");
  const [jurisdiction, setJurisdiction] = useState("Delaware");
  const [entityType, setEntityType] = useState("C-corp");
  const [legalName, setLegalName] = useState("");
  const [chosenCard, setChosenCard] = useState<string | null>(null);
  const [submittedLocally, setSubmittedLocally] = useState(false);

  const incorporation = status.data?.incorporation ?? null;
  const entity = status.data?.entity ?? null;
  const steps = useMemo(() => stepRows(incorporation), [incorporation]);
  const notes = useMemo<TimelineEvent[]>(() => readSteps(incorporation?.steps).filter((s) => s.at).map((s, i) => ({ id: `${s.step}-${i}`, at: s.at, title: humanise(s.step), description: s.note, tone: s.step === "abandoned" ? "bad" : s.step === "complete" ? "good" : "neutral" })), [incorporation]);
  const active = !!incorporation && incorporation.status !== "complete" && incorporation.status !== "abandoned";
  const routeMeta = ROUTE_META[incorporation?.route ?? route];
  const canTakeOver = founderCanTakeOver(incorporation);
  const founderSubmitted = incorporation?.status === "submitted" || incorporation?.status === "complete" || submittedLocally;

  const runRecommend = async () => {
    const n = Number(coFounders);
    await recommend.run<RecommendResponse>("legal.recommend", { fundraising, coFounders: Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : 0 }, { then: (r) => setResult(r) });
  };

  const chooseCard = (card: JurisdictionCard) => {
    setChosenCard(`${card.jurisdiction}|${card.entity_type}`);
    setRoute(card.route);
    setJurisdiction(card.jurisdiction);
    setEntityType(card.entity_type);
  };

  const onJurisdiction = (value: string) => {
    setJurisdiction(value);
    setRoute(routeForJurisdiction(value));
  };

  const canStart = !active && legalName.trim().length > 0 && jurisdiction.trim().length >= 2 && entityType.trim().length > 0;
  const runStart = async () => {
    await start.run<IncorporationStartResponse>("legal.incorporate.start", { route, jurisdiction: jurisdiction.trim(), entityType: entityType.trim(), legalName: legalName.trim() }, { then: () => status.refetch() });
  };

  const runFounderSubmitted = async () => {
    if (!incorporation) return;
    await submit.run("legal.incorporate.founderSubmitted", { incorporationId: incorporation.id }, {
      then: () => {
        setSubmittedLocally(true);
        status.refetch();
      },
    });
  };

  return (
    <Screen name="legal/incorporate">
      <Panel
        title="Where to incorporate"
        span={12}
        actions={<InformationNotice />}
        footer={
          <span>
            Scored from your citizenship and residence, target markets, fundraising plans, archetype, budget and co-founders. Fees are confirmed by web research and stamped with the date checked; costs are estimates in {currency}. {result?.disclaimer ?? "Partner professionals are available for a review."}
          </span>
        }
      >
        <form
          className="flex flex-wrap items-end gap-3"
          aria-label="Recommender inputs"
          onSubmit={(e) => {
            e.preventDefault();
            if (recommend.pending === null) void runRecommend();
          }}
        >
          <Field htmlFor={`${id}-fund`} label="Fundraising plans" className="w-64">
            <SimpleSelect id={`${id}-fund`} options={FUNDRAISING_OPTIONS} value={fundraising} onValueChange={setFundraising} aria-label="Fundraising plans" />
          </Field>
          <Field htmlFor={`${id}-cof`} label="Co-founders" className="w-32">
            <Input id={`${id}-cof`} numeric inputMode="numeric" value={coFounders} onChange={(e) => setCoFounders(e.target.value)} min={0} max={10} />
          </Field>
          <Button type="submit" icon={Compass} loading={recommend.pending !== null} variant={result ? "default" : "primary"}>
            {result ? "Recommend again" : "Recommend"}
          </Button>
          <InlineError error={recommend.error} />
        </form>
        {result ? (
          <section aria-label="Recommendation" className="mt-4 flex flex-col gap-3">
            <h2 className="t-display-md text-primary">{result.headline}</h2>
            <div className="grid grid-cols-3 gap-gutter">
              {result.cards.slice(0, 6).map((card) => (
                <JurisdictionCardView key={`${card.jurisdiction}|${card.entity_type}`} card={card} currency={currency} onChoose={active ? undefined : chooseCard} chosen={chosenCard === `${card.jurisdiction}|${card.entity_type}`} />
              ))}
            </div>
            <InformationNotice>
              {result.cards.length} jurisdiction{result.cards.length === 1 ? "" : "s"} compared · checked {formatDate(result.cards[0]?.dateChecked ?? now)}
            </InformationNotice>
          </section>
        ) : (
          <p className="mt-3 flex items-center gap-2 t-small text-secondary">
            <Compass size={14} aria-hidden /> Run the recommender to compare up to six jurisdictions for this business.
          </p>
        )}
      </Panel>

      <Panel
        title="Route"
        span={4}
        loading={status.isLoading}
        error={status.error ? status.error.message : undefined}
        onRetry={status.refetch}
        footer={<span>Only Delaware (Stripe Atlas) and UK private limited companies (Companies House) have supervised routes; everything else is a document pack prepared for you to file.</span>}
      >
        <form
          className="flex flex-col gap-3"
          aria-label="Incorporation route"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart && start.pending === null) void runStart();
          }}
        >
          <RadioGroup aria-label="Route" value={route} onValueChange={(v) => setRoute(v as IncorporationRoute)} disabled={active} className="flex flex-col gap-2">
            {ROUTE_ORDER.map((r) => {
              const meta = ROUTE_META[r];
              return <RadioCard key={r} id={`${id}-route-${r}`} value={r} label={`${meta.label} · ${meta.jurisdictionLabel}`} description={meta.who} icon={ROUTE_ICON[r]} />;
            })}
          </RadioGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field htmlFor={`${id}-jur`} label="Jurisdiction">
              <Input id={`${id}-jur`} value={jurisdiction} onChange={(e) => onJurisdiction(e.target.value)} disabled={active} maxLength={40} />
            </Field>
            <Field htmlFor={`${id}-type`} label="Entity type" hint={ROUTE_META[route].entityTypes.join(" / ")}>
              <Input id={`${id}-type`} value={entityType} onChange={(e) => setEntityType(e.target.value)} disabled={active} maxLength={60} />
            </Field>
          </div>
          <Field htmlFor={`${id}-name`} label="Legal name" hint="As it will appear on the register">
            <Input id={`${id}-name`} value={legalName} onChange={(e) => setLegalName(e.target.value)} disabled={active} maxLength={200} placeholder={entity?.legalName ?? "Northwind Skincare, Inc."} />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" icon={Landmark} disabled={!canStart} loading={start.pending !== null}>
              Start supervised session
            </Button>
            {active ? <Chip tone="info">An incorporation is in progress</Chip> : null}
          </div>
          <InlineError error={start.error} />
          <p className="t-small text-secondary">Starting prepares documents only. You sign in, verify your identity, review, submit and pay yourself; the team never handles passwords, identity documents or CAPTCHAs.</p>
        </form>
      </Panel>

      <Panel
        title="Supervised session"
        span={8}
        loading={status.isLoading}
        error={status.error ? status.error.message : undefined}
        onRetry={status.refetch}
        empty={!status.isLoading && !incorporation ? { icon: MonitorPlay, children: "Start a route on the left; the session's steps, the live view and your takeover button appear here." } : undefined}
        actions={incorporation ? <Pill {...INCORPORATION_PILL[incorporation.status]} /> : undefined}
        footer={incorporation ? <span>{routeMeta.who}</span> : undefined}
      >
        {incorporation ? (
          <div className="grid grid-cols-12 gap-gutter">
            <ol aria-label="Session steps" className="col-span-5 flex flex-col gap-2">
              {steps.map((s) => {
                const Icon = STEP_ICON[s.state];
                return (
                  <li key={s.key} data-step={s.key} data-state={s.state} className={cn("flex items-start gap-2 rounded-md px-2.5 py-2", s.state === "current" ? "surface-raised row-selected" : "edge")}>
                    <Icon size={16} aria-hidden className={cn("mt-0.5 shrink-0", s.state === "done" ? "text-status-good" : s.state === "current" ? "text-accent-link" : s.state === "abandoned" ? "text-status-bad" : "text-secondary")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 t-body-strong", s.state === "todo" || s.state === "abandoned" ? "text-secondary" : "text-primary")}>
                        {s.title}
                        {s.owner === "founder" ? <FounderOnlyChip /> : null}
                      </p>
                      <p className="t-small text-secondary">{s.state === "done" ? `${humanise(s.state)}${s.at ? ` · ${formatDate(s.at)}` : ""}` : s.state === "current" ? "In progress" : s.state === "abandoned" ? "Not reached" : "Next"}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="col-span-7 flex flex-col gap-3">
              <section aria-label="Live view" className="edge flex min-h-40 flex-col items-center justify-center gap-2 rounded-md bg-ink p-panel-pad text-center">
                <MonitorPlay size={20} aria-hidden className="text-secondary" />
                {incorporation.browserSessionId ? (
                  <>
                    <p className="t-body text-primary">Supervised browser session</p>
                    <p className="t-mono text-secondary">{incorporation.browserSessionId}</p>
                    <p className="t-small text-secondary">The live view shows the team filling the forms. Take over at any time; you sign in and complete identity checks personally.</p>
                  </>
                ) : (
                  <p className="t-small text-secondary">The live view connects once the team has prepared the documents.</p>
                )}
              </section>
              <div className="flex flex-wrap items-center gap-2">
                {routeMeta.external ? (
                  <FounderLinkOut href={routeMeta.external.href} icon={UserRound} disabled={!canTakeOver && !founderSubmitted}>
                    {founderSubmitted ? routeMeta.external.label : `Take over · ${routeMeta.external.label}`}
                  </FounderLinkOut>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Button icon={Send} onClick={() => navigate(routes.inbox(businessId))} disabled={!canTakeOver}>
                      Open the documents in the Inbox
                    </Button>
                    <FounderOnlyChip />
                  </span>
                )}
                {!founderSubmitted ? (
                  <Button icon={CircleDashed} variant="default" disabled={incorporation.status !== "awaiting_founder"} loading={submit.pending !== null} onClick={() => void runFounderSubmitted()} title="Tell the team you submitted and paid on the registry's page">
                    I submitted and paid
                  </Button>
                ) : (
                  <Chip tone="good" icon={Check}>
                    Submitted by you{incorporation.submittedAt ? ` · ${formatDate(incorporation.submittedAt)}` : ""}
                  </Chip>
                )}
              </div>
              <InlineError error={submit.error} />
              <p className="t-small text-secondary">The buttons above only open the registry's own page. Submitting and paying happen there, by you, signed in as yourself. Nothing on {routeMeta.label} is clicked by an agent (AC-11.11.4).</p>
              {notes.length ? <Timeline aria-label="Session notes" events={notes} now={now} order="desc" /> : null}
            </div>
          </div>
        ) : null}
      </Panel>
      {INCORPORATION_ROUTES.length !== ROUTE_ORDER.length ? <p className="col-span-12 t-small text-status-warn">A route is missing from this screen.</p> : null}
    </Screen>
  );
}
