"use client";
/**
 * Entity profile (BUILD §11.12 "Profile tabs"): ProfileHeader (kind, roles, owner, since, relationship strength
 * 1–20, lead score stars) and the tabs Overview · Activity · Relationships (graph + intro paths) · Commercial ·
 * Documents · Notes · Journey (re-watch replays). Merge from the header, unmerge from the merge history
 * (AC-11.12.3): Unmerge reverts only what that merge changed, and while a later merge relies on it the history
 * says which merge to undo first instead of offering the button. Data duties (export, deletion request) live in
 * the header actions.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Download, GitMerge, Handshake, Mail, MessageSquare, Pencil, Phone, Play, ScrollText, StickyNote, Trash2, Undo2, UserRoundPlus, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, Button, Chip, ENTITY_KIND_ICONS, ENTITY_KIND_LABELS, EntityLink, Icon, KeyValueList, Panel, ProfileHeader, ProvenanceChip, RatingBar, StarRating, StatusPill, StatusStrip, Term, Textarea, Timeline, formatMoney, formatRelative, useToast, useFormatters, type MetricTileProps, type ProfileChip, type ProfileFact, type TabItem, type TimelineEvent } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { FOLLOW_PENDING_LINE, followConsentLine } from "@foundmill/shared/project-page";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage, trpcErrorCode } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { plainWords } from "@/lib/format";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { NotFoundPanel, RefreshFailedNotice, isMissing, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { AddRoleDialog, DeleteRequestDialog, EditEntityDialog, ExportDialog, MergeDialog, useCrmInvalidate } from "./dialogs";
import { AMOUNTS_HIDDEN, ENTITY_TABS, KIND_WORD, LAWFUL_BASIS_LABEL, STAGE_TONE, VISIBILITY_WORD, activityItems, commercialSummary, documentItems, introPaths, isCustomerWin, leadScore, mergeBanner, moneyHidden, primaryRole, relationshipStrength, containerWord, roleWord, sourceWord, stageWord, strengthRating, type EntityGet, type EntityTab, type OwnerRef } from "./logic";
import { RelationshipGraph } from "./RelationshipGraph";
import { ReplyThread } from "./ReplyThread";

export interface EntityScreenProps {
  entityId: string;
  tab: EntityTab;
}

/** Who made a merge, in words. */
const MERGED_BY: Record<string, string> = { user: "by you", founder: "by you", agent: "by an agent", system: "automatically", import: "during an import" };

/** An identifier on the profile, or a quiet "None" when the record has none. */
function identifier(value: unknown): ReactNode {
  return typeof value === "string" && value ? value : <span className="font-body text-body text-tertiary">None</span>;
}

const ACTIVITY_ICON = { email: Mail, meeting: Users, call: Phone, message: MessageSquare, note: StickyNote, mention: ScrollText, conversion: Play } as const;

export function EntityScreen({ entityId, tab }: EntityScreenProps) {
  const { formatDate, formatDateTime } = useFormatters();
  const { businessId, departments } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const search = useSearchParams();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const currency = useBusinessCurrency();

  const getQ = useQuery(trpc.crm.entity.get.queryOptions({ businessId, entityId }, { staleTime: 15_000, retry: (n, err) => trpcErrorCode(err) !== "NOT_FOUND" && n < 2 }));
  const squadQ = useQuery(trpc.team.agents.list.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
  const get = getQ.data;
  const ownerName = (ref: OwnerRef | null | undefined) => (ref ? (ref.kind === "agent" ? squadQ.data?.agents.find((a) => a.id === ref.id)?.name ?? "Agent" : ref.kind === "department" ? departments.find((d) => d.id === ref.id)?.name ?? "Department" : "You") : "Unassigned");

  const tabs = useMemo<TabItem[]>(() => ENTITY_TABS.map((t) => ({ id: t.id, label: t.label, href: routes.crm(businessId, entityId, t.id), badge: t.id === "notes" && get ? get.interactions.filter((i) => i.kind === "note").length || undefined : t.id === "journey" && get ? get.conversions.length || undefined : undefined })), [businessId, entityId, get]);
  useShellChrome(
    { title: get?.entity.displayName ?? "Record", tabs: { tabs, activeId: tab, onChange: (id) => router.push(routes.crm(businessId, entityId, id)), "aria-label": "Entity profile tabs" }, breadcrumbs: [{ label: "CRM", href: routes.crm(businessId) }, { label: get?.entity.displayName ?? "Record" }] },
    [get?.entity.displayName, tabs, tab],
  );

  const [dialog, setDialog] = useState<"merge" | "edit" | "export" | "delete" | "role" | null>(null);
  useEffect(() => {
    if (search.get("export") === "1") setDialog("export");
    // A mention's right-click "Assign agent" / "Add to list" lands here with the role dialog open (lib/entity-resolver).
    else if (search.get("role") === "1") setDialog("role");
  }, [search]);
  // A merged-away id redirects to the surviving record (the API resolves it; keep the URL honest).
  useEffect(() => {
    if (get?.redirectedFrom && get.entity.id !== entityId) router.replace(routes.crm(businessId, get.entity.id, tab));
  }, [get?.redirectedFrom, get?.entity.id, entityId, businessId, tab, router]);

  const unmerge = useMutation(
    trpc.crm.entity.unmerge.mutationOptions({
      onSuccess: (r) => {
        void invalidate();
        toast({ title: "Merge undone", description: `${r.merged.displayName} is a separate record again.`, tone: "good" });
      },
      onError: (err) => {
        // CONFLICT: a later merge relies on this one; the message names the merge to undo first.
        if (trpcErrorCode(err) === "CONFLICT") void invalidate();
        toast({ title: trpcErrorCode(err) === "CONFLICT" ? "This merge cannot be undone yet" : "Unmerge failed", description: errorMessage(err), tone: "bad" });
      },
    }),
  );
  const endRole = useMutation(
    trpc.crm.roles.end.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (err) => toast({ title: "Could not end the role", description: errorMessage(err), tone: "bad" }),
    }),
  );

  if (loadFailed(getQ) && isMissing(getQ.error)) {
    return (
      <NotFoundPanel title="Record" heading="No such record" back={{ label: "Back to the CRM", href: routes.crm(businessId) }}>
        Nothing in this business has this address: the record was deleted, merged away, or the link is wrong.
      </NotFoundPanel>
    );
  }
  if (loadFailed(getQ)) return <ErrorPanel title="Record" message={errorMessage(getQ.error)} onRetry={() => void getQ.refetch()} />;
  if (!get) return <ScreenSkeleton />;

  const entity = get.entity;
  const role = primaryRole(get.roles);
  const strength = relationshipStrength(get.relationships);
  const score = leadScore(get.roles, get.interactions, strength.rating);
  const banner = mergeBanner(get);
  const chips: ProfileChip[] = [{ label: KIND_WORD[entity.kind] ?? ENTITY_KIND_LABELS[entity.kind], icon: ENTITY_KIND_ICONS[entity.kind] }, ...get.roles.filter((r) => !r.endedAt).map((r) => ({ label: roleWord(r.role) }))];
  const facts: ProfileFact[] = [
    { label: "Owner", value: ownerName(role?.ownerRef as OwnerRef | null) },
    { label: "Relationship", value: <span className="inline-flex items-center gap-1.5">{strength.rating}<RatingBar value={strength.rating} name="Relationship strength" /></span> },
    { label: "Since", value: formatDate(entity.createdAt) },
  ];
  const headerActions = (
    <>
      <Button size="sm" icon={Pencil} onClick={() => setDialog("edit")} data-testid="entity-edit">
        Edit
      </Button>
      <Button size="sm" icon={GitMerge} onClick={() => setDialog("merge")} data-testid="entity-merge">
        Merge…
      </Button>
      <Button size="sm" variant="ghost" icon={Download} onClick={() => setDialog("export")} data-testid="entity-export">
        Export
      </Button>
      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDialog("delete")} data-testid="entity-delete">
        Request deletion
      </Button>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="entity-profile" data-entity-id={entity.id} data-tab={tab}>
      {refreshFailed(getQ) ? <RefreshFailedNotice query={getQ} /> : null}
      <ProfileHeader avatar={<Avatar size={64} name={entity.displayName} src={entity.avatarUrl ?? undefined} />} name={entity.displayName} chips={chips} status={role?.stage ? <StatusPill tone={STAGE_TONE[role.stage] ?? "neutral"}>{stageWord(role.stage)}</StatusPill> : undefined} facts={facts} stars={{ current: score.stars }} actions={headerActions} />
      {banner.redirected || banner.absorbed.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-subtle bg-panel-alt px-gutter py-1.5 text-small text-secondary" data-testid="merge-banner">
          <Icon icon={GitMerge} size="inline" />
          {banner.redirected ? <span>You followed a merged record; this is the one that survived.</span> : null}
          {banner.absorbed.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-2">
              Absorbed a duplicate {formatRelative(m.createdAt)}.
              {m.undoBlocked ? (
                <span data-testid="unmerge-blocked">{m.undoBlocked}</span>
              ) : (
                <Button size="sm" variant="ghost" icon={Undo2} loading={unmerge.isPending} onClick={() => unmerge.mutate({ businessId, mergeLogId: m.id })} data-testid="unmerge">
                  Unmerge
                </Button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-12 gap-gutter p-gutter">
          {tab === "overview" ? (
            <>
              <Panel title="Key facts" span={6} data-testid="key-facts">
                <KeyValueList
                  labelClassName="w-36"
                  items={[
                    { label: "Email", value: identifier(entity.identifiers.email), mono: typeof entity.identifiers.email === "string" },
                    { label: "Domain", value: identifier(entity.identifiers.domain), mono: typeof entity.identifiers.domain === "string" },
                    { label: "LinkedIn", value: identifier(entity.identifiers.linkedin), mono: typeof entity.identifiers.linkedin === "string" },
                    { label: "Other names", value: entity.aliases.length ? entity.aliases.join(", ") : <span className="text-tertiary">None</span> },
                    { label: "Source", value: sourceWord(entity.source) || "Unknown" },
                    { label: <Term id="lawful_basis">Lawful basis</Term>, value: entity.lawfulBasis ? LAWFUL_BASIS_LABEL[entity.lawfulBasis] ?? plainWords(entity.lawfulBasis) : entity.kind === "person" ? <Chip tone="warn">Not recorded</Chip> : <span className="text-tertiary">Only recorded for people</span> },
                    // A follower of the public page (package 1.6, double opt-in): when they confirmed, or that they have not yet.
                    ...(get.emailConsentAt
                      ? [{ label: "Consent", value: <span data-testid="email-consent">{followConsentLine(formatDate(get.emailConsentAt))}</span> }]
                      : get.emailConsentPending
                        ? [{ label: "Consent", value: <span data-testid="email-consent">{FOLLOW_PENDING_LINE}</span> }]
                        : []),
                    { label: "Visibility", value: VISIBILITY_WORD[entity.visibility] ?? plainWords(entity.visibility) },
                    { label: "Updated", value: formatDateTime(entity.updatedAt) },
                  ]}
                />
              </Panel>
              <Panel title="Standing" span={6} data-testid="standing">
                <div className="flex flex-col gap-3">
                  <div>
                    <span className="t-label block">Relationship strength</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="t-display-sm tabular-nums text-primary">{strength.rating}</span>
                      <RatingBar value={strength.rating} cellHeight={10} name="Relationship strength" />
                      {strength.via ? <span className="text-small text-secondary">via {strength.via.other.displayName}</span> : <span className="text-small text-secondary">No relationships yet</span>}
                    </span>
                  </div>
                  <div>
                    <span className="t-label block">Lead score</span>
                    <span className="inline-flex items-center gap-2">
                      <StarRating value={score.stars} label="Lead score" showValue />
                      {/* Estimate only once there is something to estimate from. */}
                      {score.reasons.length ? <ProvenanceChip kind="estimate" /> : null}
                      <span className="text-small text-secondary">{score.reasons.join(" · ") || "No signals yet"}</span>
                    </span>
                  </div>
                  <div>
                    <span className="t-label block">Status</span>
                    {role ? (
                      <span className="inline-flex items-center gap-2">
                        <Chip>{roleWord(role.role)}</Chip>
                        {role.stage ? <StatusPill tone={STAGE_TONE[role.stage] ?? "neutral"}>{stageWord(role.stage)}</StatusPill> : null}
                        <span className="text-small text-secondary">since {formatDate(role.startedAt)}</span>
                      </span>
                    ) : (
                      <span className="text-small text-secondary">No active role</span>
                    )}
                  </div>
                  {/* The owner is in the header facts; it is not repeated here. */}
                </div>
              </Panel>
              <Panel title="Roles" span={12} actions={<Button size="sm" icon={UserRoundPlus} onClick={() => setDialog("role")} data-testid="add-role">Add role</Button>} empty={get.roles.length === 0 ? { icon: UserRoundPlus, children: "Roles say what this record is to the business: customer, lead, supplier or investor. Add the first one." } : undefined}>
                <ul className="flex flex-col divide-y divide-line-faint" data-testid="roles-list">
                  {get.roles.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 py-1.5 text-body" data-role-id={r.id}>
                      <Chip>{roleWord(r.role)}</Chip>
                      {r.stage ? <StatusPill tone={STAGE_TONE[r.stage] ?? "neutral"}>{stageWord(r.stage)}</StatusPill> : null}
                      <span className="text-small text-secondary">
                        {formatDate(r.startedAt)} → {r.endedAt ? formatDate(r.endedAt) : "now"} · {r.ownerRef ? `owned by ${ownerName(r.ownerRef as OwnerRef | null)}` : "no owner yet"}
                      </span>
                      {!r.endedAt ? (
                        <Button size="sm" variant="ghost" className="ml-auto" loading={endRole.isPending} onClick={() => endRole.mutate({ businessId, roleId: r.id })}>
                          End role
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
              {get.mergeHistory.length ? (
                <Panel title="Merge history" span={12} data-testid="merge-history">
                  <ul className="flex flex-col divide-y divide-line-faint text-body">
                    {get.mergeHistory.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 py-1.5">
                        <Icon icon={GitMerge} size="inline" className="text-secondary" />
                        <span>
                          {m.keptId === entity.id ? "Absorbed a duplicate record" : "Merged into another record"} {formatRelative(m.createdAt)}, {MERGED_BY[m.byKind] ?? `by ${plainWords(m.byKind).toLowerCase()}`}
                        </span>
                        {m.revertedAt ? (
                          <Chip tone="neutral">Reverted {formatRelative(m.revertedAt)}</Chip>
                        ) : m.keptId !== entity.id ? null : m.undoBlocked ? (
                          <span className="ml-auto max-w-reading text-small text-secondary">{m.undoBlocked}</span>
                        ) : (
                          <Button size="sm" variant="ghost" icon={Undo2} className="ml-auto" loading={unmerge.isPending} onClick={() => unmerge.mutate({ businessId, mergeLogId: m.id })}>
                            Unmerge
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
              <ReplyThread businessId={businessId} entityId={entity.id} />
            </>
          ) : null}

          {tab === "activity" ? <ActivityTab get={get} businessId={businessId} squad={squadQ.data?.agents} /> : null}
          {tab === "relationships" ? <RelationshipsTab get={get} businessId={businessId} /> : null}
          {tab === "commercial" ? <CommercialTab get={get} currency={currency} /> : null}
          {tab === "documents" ? <DocumentsTab get={get} businessId={businessId} /> : null}
          {tab === "notes" ? <NotesTab get={get} businessId={businessId} /> : null}
          {tab === "journey" ? <JourneyTab get={get} businessId={businessId} /> : null}
        </div>
      </div>

      <MergeDialog businessId={businessId} source={entity} open={dialog === "merge"} onOpenChange={(o) => !o && setDialog(null)} onMerged={(keptId) => router.push(routes.crm(businessId, keptId))} />
      <EditEntityDialog businessId={businessId} entity={entity} open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} />
      <ExportDialog get={get} open={dialog === "export"} onOpenChange={(o) => !o && setDialog(null)} />
      <DeleteRequestDialog businessId={businessId} entity={entity} requestedBy="the founder" open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} />
      <AddRoleDialog businessId={businessId} entityId={entity.id} open={dialog === "role"} onOpenChange={(o) => !o && setDialog(null)} roles={get.roles.map((r) => r.role)} />
    </div>
  );
}

// --- tabs -------------------------------------------------------------------------------------------------------------

function ActivityTab({ get, businessId, squad }: { get: EntityGet; businessId: string; squad?: { id: string; name: string; avatarSeed: string; departments: { colourToken: string }[] }[] }) {
  const items = useMemo(() => activityItems(get, { inbox: (id) => routes.inbox(businessId, id), journey: (id) => routes.journey(businessId, id, routes.crm(businessId, get.entity.id, "activity")) }), [get, businessId]);
  const events: TimelineEvent[] = items.map((i) => {
    const agent = i.agentId ? squad?.find((a) => a.id === i.agentId) : undefined;
    return {
      id: i.id,
      at: i.at,
      title: i.href ? (
        <a href={i.href} className="entity-link">
          {i.title}
        </a>
      ) : (
        i.title
      ),
      description: i.description,
      icon: ACTIVITY_ICON[i.kind],
      tone: i.kind === "conversion" ? "good" : i.direction === "inbound" ? "info" : "neutral",
      statusWord: i.kind === "conversion" ? "win" : i.direction ?? undefined,
      actor: agent ? { name: agent.name, agent: { seed: agent.avatarSeed || agent.id, dept: (agent.departments[0]?.colourToken ?? "dept-1") as DeptColourToken } } : undefined,
    };
  });
  return (
    <Panel title="Activity" span={12} empty={events.length === 0 ? { children: "Emails, meetings, calls, messages, notes, mentions and wins involving this record appear here." } : undefined} data-testid="activity-timeline">
      <Timeline events={events} />
    </Panel>
  );
}

function RelationshipsTab({ get, businessId }: { get: EntityGet; businessId: string }) {
  const router = useRouter();
  const nodes = get.relationships.map((r) => ({ id: r.other.id, name: r.other.displayName, kind: r.other.kind, type: r.type, strength: strengthRating(r.strength) }));
  const paths = introPaths(get.entity.displayName, get.relationships);
  return (
    <>
      <Panel title="Graph" span={8} flush empty={nodes.length === 0 ? { icon: Handshake, children: "Relationships appear as agents and imports record who knows whom; strength grows with interactions." } : undefined} data-testid="relationship-graph">
        <div className="p-panel-pad">
          <RelationshipGraph centre={{ id: get.entity.id, name: get.entity.displayName, kind: get.entity.kind }} nodes={nodes} onOpen={(id) => router.push(routes.crm(businessId, id))} width={760} height={400} />
        </div>
      </Panel>
      <Panel title="Intro paths" span={4} empty={paths.length === 0 ? { children: "Who can introduce you appears once a relationship is recorded." } : undefined} footer="Strongest path first. Agents introduce themselves as agents." data-testid="intro-paths">
        <ol className="flex flex-col gap-2">
          {paths.map((p) => (
            <li key={p.via.id} className="flex flex-col gap-0.5 rounded-panel border border-subtle bg-panel-alt p-2">
              <span className="inline-flex items-center gap-1 text-body text-primary">
                You <Icon icon={ArrowRight} size={12} className="text-secondary" />
                <EntityLink entity={{ id: p.via.id, kind: p.via.kind, name: p.via.displayName, href: p.via.kind === "agent" ? routes.agent(businessId, p.via.id) : routes.crm(businessId, p.via.id) }} hoverCard={false} />
                <Icon icon={ArrowRight} size={12} className="text-secondary" /> {get.entity.displayName}
              </span>
              <span className="inline-flex items-center gap-2 text-small text-secondary">
                {plainWords(p.type)} · {p.strength} of 20 <RatingBar value={p.strength} cellHeight={6} name="Path strength" />
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </>
  );
}

function CommercialTab({ get, currency }: { get: EntityGet; currency: string }) {
  const { formatDate, formatDateTime } = useFormatters();
  const s = commercialSummary(get.conversions, currency);
  const payments = get.conversions.filter((c) => c.kind === "payment");
  // Amounts are Finance's: a reader walled off Finance gets them as null, and the tiles say so instead of a total of 0.
  const hidden = moneyHidden(get);
  return (
    <>
      <div className="col-span-12">
        <StatusStrip
          tiles={[
            hidden
              ? { label: "Lifetime value", value: null, caption: AMOUNTS_HIDDEN }
              : { label: "Lifetime value", value: { amountMinor: s.totalMinor, currency: s.currency }, provenance: { source: "Payments from this customer" } },
            { label: "Payments", value: s.payments, format: "integer" },
            hidden ? { label: "Monthly", value: null, caption: AMOUNTS_HIDDEN } : { label: "Monthly", value: s.monthlyMinor === null ? null : { amountMinor: s.monthlyMinor, currency: s.currency }, estimate: "estimate", caption: "Average over active months" },
            { label: "First payment", value: s.firstPaymentAt ? formatDate(s.firstPaymentAt) : "—" },
            { label: "Last payment", value: s.lastPaymentAt ? formatDate(s.lastPaymentAt) : "—" },
          ] satisfies MetricTileProps[]}
        />
      </div>
      <Panel title="Payments" span={12} empty={payments.length === 0 ? { children: "Payments from Stripe, Shopify and invoices show here once this record pays." } : undefined} data-testid="commercial-payments">
        <ul className="flex flex-col divide-y divide-subtle">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1.5 text-body">
              <span className="text-secondary">{formatDateTime(p.occurredAt)}</span>
              <span className="ml-auto tabular-nums" data-testid="payment-amount">{p.amountMinor === null ? "—" : formatMoney({ amountMinor: Number(p.amountMinor), currency: p.currency })}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function DocumentsTab({ get, businessId }: { get: EntityGet; businessId: string }) {
  const docs = documentItems(get, { inbox: (id) => routes.inbox(businessId, id) });
  return (
    <Panel title="Documents" span={12} empty={docs.length === 0 ? { icon: ScrollText, children: "Emails, contracts, sales proposals and notes that mention this record list here. Bodies stay encrypted; this is the index." } : undefined} footer="Encrypted bodies are opened through the integration that holds them, never decrypted into this list." data-testid="documents-list">
      <ul className="flex flex-col divide-y divide-subtle">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-1.5 text-body">
            <Icon icon={ScrollText} size="inline" className="text-secondary" />
            {d.href ? (
              <a href={d.href} className="entity-link">
                {d.title}
              </a>
            ) : (
              <span className="text-primary">{d.title}</span>
            )}
            <Chip>{plainWords(containerWord(d.kind))}</Chip>
            {d.encrypted ? <Chip tone="neutral">Encrypted body</Chip> : null}
            <span className="ml-auto text-small text-secondary">{formatRelative(d.at)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NotesTab({ get, businessId }: { get: EntityGet; businessId: string }) {
  const { formatDateTime } = useFormatters();
  const trpc = useTRPC();
  const { toast } = useToast();
  const invalidate = useCrmInvalidate();
  const notesQ = useQuery(trpc.crm.notes.list.queryOptions({ businessId, entityId: get.entity.id, limit: 100 }, { staleTime: 10_000 }));
  const [draft, setDraft] = useState("");
  const add = useMutation(
    trpc.crm.notes.add.mutationOptions({
      onSuccess: () => {
        setDraft("");
        void invalidate();
        void notesQ.refetch();
      },
      onError: (err) => toast({ title: "Note not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const notes = notesQ.data?.items ?? get.interactions.filter((i) => i.kind === "note");
  return (
    <>
      <Panel title="New note" span={12}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) add.mutate({ businessId, entityId: get.entity.id, note: draft.trim() });
          }}
        >
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="What happened, what was agreed, what to do next. Mention people and agents by name." aria-label="New note" data-testid="note-input" />
          <Button type="submit" variant="primary" icon={StickyNote} className="self-end" disabled={!draft.trim()} loading={add.isPending} data-testid="note-save">
            Add note
          </Button>
        </form>
      </Panel>
      <Panel title="Notes" span={12} loading={notesQ.isLoading && !notesQ.data} empty={!notesQ.isLoading && notes.length === 0 ? { children: "Notes from you and the team appear here, newest first." } : undefined} data-testid="notes-list">
        <ul className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-0.5">
              <span className="text-small text-secondary">
                {formatDateTime(n.occurredAt)}
                {n.agentId ? " · agent" : " · you"}
              </span>
              <p className="t-reading max-w-reading whitespace-pre-wrap text-primary">{n.summary}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function JourneyTab({ get, businessId }: { get: EntityGet; businessId: string }) {
  const { formatDateTime } = useFormatters();
  const router = useRouter();
  // Renewals and repeat orders are revenue (Commercial tab), not wins: they have no replay.
  const wins = get.conversions.filter(isCustomerWin).sort((a, b) => Date.parse(String(b.occurredAt)) - Date.parse(String(a.occurredAt)));
  return (
    <Panel title="Customer Updates" span={12} empty={wins.length === 0 ? { icon: Play, children: "Each win (sign-up, activation, payment) has a replay: first touch, who was involved, the win moment and the debrief." } : undefined} footer="Re-watch opens the Customer Update for that win." data-testid="journey-list">
      <ul className="flex flex-col divide-y divide-subtle">
        {wins.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2 text-body">
            <StatusPill tone={c.kind === "payment" ? "good" : "info"}>{c.kind === "payment" ? "Payment" : c.kind === "activation" ? "Activation" : "Sign-up"}</StatusPill>
            <span className="text-secondary">{formatDateTime(c.occurredAt)}</span>
            {c.kind === "payment" && c.amountMinor !== null ? <span className="tabular-nums">{formatMoney({ amountMinor: Number(c.amountMinor), currency: c.currency })}</span> : null}
            {/* Re-watch opens the win's own Customer Update; a win recorded without one has nothing to replay. */}
            {c.journeyId ? (
              <Button size="sm" icon={Play} className="ml-auto" onClick={() => c.journeyId && router.push(routes.journey(businessId, c.journeyId, routes.crm(businessId, get.entity.id, "journey")))} data-testid="rewatch">
                Re-watch
              </Button>
            ) : (
              <span className="ml-auto text-small text-secondary" data-testid="no-replay">
                No replay recorded
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
