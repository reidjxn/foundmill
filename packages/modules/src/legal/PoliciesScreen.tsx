"use client";
/**
 * Legal › Policies (BUILD §11.11): privacy policy, terms of service and cookie policy generated from the real
 * integrations and data flows (`integrations.list`), the legal entity and the archetype. The published text lives
 * as spec blocks in the "Policies" section of the product spec; a refresh is a change proposal: the generated text
 * is diffed against the published block hunk by hunk (the same DiffView as Product › Changes) and accepted hunks
 * are written through `product.spec.editBlock` (a human edit, so the block is pinned). Open proposals the Source
 * Watcher raised about policies are listed with a link to Product › Changes.
 */
import { useMemo, useState } from "react";
import { Cookie, FileDiff, FileText, RefreshCw, Scale, ShieldCheck } from "lucide-react";
import { Button, Chip, DiffView, Markdown, MiniTable, Panel, applyDecisions, buildHunks, diffLines, summariseDiff, type HunkDecisionState, type HunkDecisions, type IconComponent } from "@foundmill/dugout";
import { moduleHref, routes, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { pmTitle, pmToText, textToPm } from "../product/prosemirror";
import type { SpecGetResponse } from "../product/types";
import type { ModuleScreenProps } from "../registry";
import { POLICY_KEYS, POLICY_TITLES, dataFlows, formatAddress, generatePolicies, type PolicyKey } from "./legal-data";
import { InformationNotice, InlineError, Screen, useAction, useLegalStatus, useNow } from "./shared";
import type { BusinessGetResponse, IntegrationsListResponse, ProposalsListResponse } from "./types";

const INTEGRATIONS_INPUT: Record<string, unknown> = {};
const BUSINESS_INPUT: Record<string, unknown> = {};
export const POLICIES_SECTION = "Policies";
const SPEC_INPUT = { section: POLICIES_SECTION } as const;
const PROPOSALS_INPUT = { status: "open", limit: 50 } as const;

const POLICY_ICON: Record<PolicyKey, IconComponent> = { privacy: ShieldCheck, terms: Scale, cookies: Cookie };
const POLICY_RE = /polic|privacy|terms|cookie|gdpr/i;

export function PoliciesScreen({ businessId }: ModuleScreenProps) {
  const now = useNow();
  const { navigate } = useWidgetData();
  const integrations = useWidgetQuery<IntegrationsListResponse>("integrations.list", INTEGRATIONS_INPUT);
  const business = useWidgetQuery<BusinessGetResponse>("business.get", BUSINESS_INPUT);
  const status = useLegalStatus();
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", SPEC_INPUT);
  const proposals = useWidgetQuery<ProposalsListResponse>("product.proposals.list", PROPOSALS_INPUT);
  const departments = useDepartments();
  const action = useAction();
  const [active, setActive] = useState<PolicyKey>("privacy");
  const [decisions, setDecisions] = useState<Record<PolicyKey, HunkDecisions>>({ privacy: {}, terms: {}, cookies: {} });
  const [applied, setApplied] = useState<PolicyKey | null>(null);

  const flows = useMemo(() => dataFlows(integrations.data?.integrations, integrations.data?.catalogue), [integrations.data]);
  const entity = status.data?.entity ?? null;
  const generated = useMemo(() => {
    const b = business.data?.business;
    if (!b) return null;
    return generatePolicies({ businessName: b.name, legalName: entity?.legalName ?? null, jurisdiction: entity?.jurisdiction ?? null, entityType: entity?.entityType ?? null, regNo: entity?.regNo ?? null, address: formatAddress(entity?.registeredAddress), region: b.region, archetype: b.archetype, flows, today: now.toISOString().slice(0, 10) });
  }, [business.data, entity, flows, now]);

  const blocks = useMemo(() => {
    const out: Partial<Record<PolicyKey, { id: string; text: string; pinned: boolean }>> = {};
    for (const key of POLICY_KEYS) {
      const block = (spec.data?.blocks ?? []).find((b) => b.section === POLICIES_SECTION && pmTitle(b.content).toLowerCase() === POLICY_TITLES[key].toLowerCase());
      if (block) out[key] = { id: block.id, text: pmToText(block.content), pinned: block.pinned };
    }
    return out;
  }, [spec.data]);

  const current = blocks[active];
  const proposed = generated?.[active] ?? "";
  const diff = useMemo(() => {
    if (!current) return null;
    const ops = diffLines(current.text, proposed);
    const hunks = buildHunks(ops);
    return { ops, hunks, summary: summariseDiff(hunks, decisions[active]) };
  }, [current, proposed, decisions, active]);
  const unchanged = diff !== null && diff.hunks.length === 0;

  const onDecision = (hunkId: string, state: HunkDecisionState) => {
    setDecisions((d) => ({ ...d, [active]: { ...d[active], [hunkId]: state } }));
  };

  const applyAccepted = async () => {
    if (!current || !diff) return;
    const merged = applyDecisions(diff.ops, diff.hunks, decisions[active]);
    await action.run("product.spec.editBlock", { blockId: current.id, patch: { content: textToPm(merged), pinned: true } }, {
      key: active,
      then: () => {
        setApplied(active);
        setDecisions((d) => ({ ...d, [active]: {} }));
        spec.refetch();
      },
    });
  };
  const acceptAll = () => {
    if (!diff) return;
    setDecisions((d) => ({ ...d, [active]: Object.fromEntries(diff.hunks.map((h) => [h.id, { decision: "accepted" as const }])) }));
  };

  const policyProposals = (proposals.data?.items ?? []).filter((p) => POLICY_RE.test(p.title));
  const changesHref = moduleHref(businessId, departments.data, "product", "changes") ?? routes.department(businessId, "product", "changes");
  const loading = integrations.isLoading || business.isLoading || status.isLoading || spec.isLoading;
  const error = integrations.error ?? business.error ?? spec.error ?? null;
  const retry = integrations.error ? integrations.refetch : business.error ? business.refetch : spec.refetch;

  return (
    <Screen name="legal/policies">
      <Panel
        title="Policies"
        span={8}
        loading={loading}
        error={error ? error.message : undefined}
        onRetry={retry}
        actions={
          <div role="tablist" aria-label="Policy" className="flex items-center gap-1">
            {POLICY_KEYS.map((key) => (
              <Button key={key} role="tab" aria-selected={active === key} size="sm" variant={active === key ? "primary" : "ghost"} icon={POLICY_ICON[key]} onClick={() => setActive(key)}>
                {POLICY_TITLES[key]}
              </Button>
            ))}
          </div>
        }
        footer={<span>Generated from {flows.length} connected integration{flows.length === 1 ? "" : "s"}, the legal entity and the archetype on {now.toISOString().slice(0, 10)}. The published text is the "{POLICIES_SECTION}" section of the product spec; accepting hunks edits that block as you.</span>}
      >
        {generated ? (
          current ? (
            <section aria-label={`${POLICY_TITLES[active]} refresh`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={unchanged ? "good" : "info"} icon={FileDiff}>
                  {unchanged ? "Published text is current" : `${diff?.hunks.length ?? 0} change${diff?.hunks.length === 1 ? "" : "s"} proposed`}
                </Chip>
                {current.pinned ? <Chip tone="neutral">Pinned (human-edited)</Chip> : null}
                {applied === active ? <Chip tone="good">Applied</Chip> : null}
                {!unchanged ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={acceptAll}>
                      Accept all
                    </Button>
                    <Button size="sm" variant="primary" icon={RefreshCw} loading={action.pending === active} disabled={!diff || diff.summary.accepted + diff.summary.edited === 0} onClick={() => void applyAccepted()}>
                      Apply accepted hunks
                    </Button>
                  </>
                ) : null}
              </div>
              <InlineError error={action.error} />
              {unchanged ? (
                <Markdown variant="body">{current.text}</Markdown>
              ) : (
                <DiffView title={POLICY_TITLES[active]} original={current.text} proposed={proposed} decisions={decisions[active]} onDecision={onDecision} labels={{ original: "Published", proposed: "Generated now" }} maxHeight={520} />
              )}
            </section>
          ) : (
            <section aria-label={`${POLICY_TITLES[active]} preview`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="warn" icon={FileText}>
                  Not yet in the spec
                </Chip>
                <span className="t-small text-secondary">The Product lead publishes the first version as a change proposal in the "{POLICIES_SECTION}" section; until then this preview is the generated text.</span>
              </div>
              <Markdown variant="body">{proposed}</Markdown>
            </section>
          )
        ) : null}
      </Panel>

      <Panel title="Data map" span={4} loading={integrations.isLoading} error={integrations.error ? integrations.error.message : undefined} onRetry={integrations.refetch} empty={!integrations.isLoading && flows.length === 0 ? { icon: ShieldCheck, children: "Connect integrations in Settings; each processor and the data it sees appears here and in the policies." } : undefined} footer={<span>Every connected integration is a processor named in the privacy policy; cookies they set appear in the cookie policy.</span>}>
        <MiniTable<(typeof flows)[number]>
          aria-label="Data flows"
          rows={flows}
          getRowKey={(f) => f.connectorKey}
          maxRows={20}
          columns={[
            { id: "processor", header: "Processor", cell: (f) => <span className="t-body-strong text-primary">{f.processor}</span> },
            { id: "purpose", header: "Purpose", cell: (f) => <span className="text-secondary">{f.purpose}</span> },
            { id: "cookies", header: "Cookies", numeric: true, width: 70, cell: (f) => <span className="tabular-nums">{f.cookies.length}</span> },
          ]}
        />
      </Panel>

      <Panel title="Open change proposals" span={12} loading={proposals.isLoading} error={proposals.error ? proposals.error.message : undefined} onRetry={proposals.refetch} empty={!proposals.isLoading && policyProposals.length === 0 ? "When an integration or data flow changes, the Source Watcher raises a change proposal for the policies; it appears here and in Product › Changes." : undefined} actions={<Button size="sm" variant="ghost" icon={FileDiff} onClick={() => navigate(changesHref)}>Product › Changes</Button>}>
        <ul aria-label="Policy proposals" className="flex flex-col gap-1">
          {policyProposals.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <Chip tone={p.severity === "critical" ? "bad" : p.severity === "normal" ? "info" : "neutral"}>{p.severity}</Chip>
              <span className="t-body-strong text-primary">{p.title}</span>
              <Button size="sm" variant="ghost" onClick={() => navigate(`${changesHref}?proposal=${p.id}`)}>
                Decide
              </Button>
            </li>
          ))}
        </ul>
        <InformationNotice className="mt-2">a professional reviews the policies before they are published to customers</InformationNotice>
      </Panel>
    </Screen>
  );
}
