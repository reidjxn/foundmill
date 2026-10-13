/**
 * legal.recommend / incorporate.start/status / import.lookup/confirm / contracts.* / compliance.list (BUILD §11.11).
 * Information, not legal or tax advice; signing and submission are founder clicks (AC-11.11.4).
 */
import { mockIntegrationRecord, type ToolContext } from "@foundmill/connectors";
import { HOUSE_STYLE } from "@foundmill/agents";
import { CANCELABLE_INCORPORATION_STATUSES, CreateContractInput, UpdateContractInput, repos } from "@foundmill/db";
import { AppError, ConflictError, INCORPORATION_ROUTES, ValidationError } from "@foundmill/shared";
import { SECTOR_GATES, SECTOR_KEYS } from "@foundmill/shared/sectors";
import { z } from "zod";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { Id, audit, emit, router, sectionAdmin, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

const read = sectionRead("legal");
const write = sectionWrite("legal");
const admin = sectionAdmin("legal");

// Bounds a real jurisdiction never exceeds (formation and yearly costs under 1,000,000.00, minimum capital under
// 100,000,000.00, under two years to form), so neither a model nor the mock can put an absurd figure on a card.
const JurisdictionCard = z.object({
  jurisdiction: z.string().min(1).max(80),
  entity_type: z.string().min(1).max(80),
  formation_cost_minor: z.number().int().nonnegative().max(100_000_000),
  annual_cost_minor: z.number().int().nonnegative().max(100_000_000),
  minimum_capital_minor: z.number().int().nonnegative().max(10_000_000_000),
  time_to_form_days: z.number().int().nonnegative().max(730),
  banking: z.string(),
  investor_familiarity: z.number().int().min(1).max(5),
  tax_notes: z.string(),
  advantages: z.array(z.string()),
  disadvantages: z.array(z.string()),
  route: z.enum(INCORPORATION_ROUTES),
});
const JurisdictionRecommendation = z.object({ headline: z.string().min(1), cards: z.array(JurisdictionCard).min(1).max(6) });

const CONTRACT_STATUSES = ["draft", "review", "awaiting_signature", "signed", "active", "expired", "terminated"] as const;
const NIL = "00000000-0000-0000-0000-000000000000";

const LookupInput = z.discriminatedUnion("country", [
  z.object({ country: z.literal("gb"), regNo: z.string().min(2).max(20) }),
  z.object({ country: z.literal("se"), regNo: z.string().min(6).max(20) }),
  z.object({ country: z.literal("other"), jurisdictionCode: z.string().min(2).max(10), regNo: z.string().min(1).max(40) }),
]);

export interface LookupResult {
  source: "companies_house" | "bolagsverket" | "opencorporates";
  legalName: string;
  regNo: string;
  jurisdiction: string;
  entityType: string;
  status: string | null;
  formedAt: string | null;
  registeredAddress: Record<string, string>;
  officers: { name: string; role: string; appointedOn: string | null }[];
  deadlines: { kind: string; dueAt: string }[];
  checkedAt: string;
  untrusted: true;
}

function toolCtx(ctx: BusinessContext, connectorKey: string): ToolContext {
  const mode = ctx.env.INTEGRATIONS_MODE;
  return { businessId: ctx.businessId, agentId: NIL, sessionId: NIL, integration: mockIntegrationRecord(connectorKey, ctx.businessId, mode === "live" ? { status: "connected" } : {}), log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined }, mode };
}

/** The registries in words, for messages the founder reads (never a connector or tool key). */
const REGISTRY_NAME: Record<string, string> = { companies_house: "Companies House", bolagsverket: "Bolagsverket", opencorporates: "OpenCorporates" };

/**
 * A registry tool call. A company the registry does not know is "not found" in the registry's own name; any other
 * failure says the registry could not be reached, never the internal connector and tool names.
 */
async function call<T>(ctx: BusinessContext, connectorKey: string, tool: string, args: unknown, regNo: string): Promise<T> {
  const connector = ctx.connectors.get(connectorKey, ctx.env.INTEGRATIONS_MODE);
  const result = await connector.callTool(tool, args, toolCtx(ctx, connectorKey));
  const registry = REGISTRY_NAME[connectorKey] ?? "the registry";
  if (!result.ok) {
    if (result.error?.status === 404 || result.error?.code === "not_found") throw new AppError("not_found", `No company with number ${regNo} at ${registry}`, 404);
    throw new ValidationError(`${registry} could not be reached. Try again in a minute.`, { connector: connectorKey, tool, code: result.error?.code ?? null });
  }
  const data = result.data as { untrusted?: boolean; content?: T } | T;
  return (data && typeof data === "object" && "untrusted" in (data as object) && "content" in (data as object) ? (data as { content: T }).content : (data as T)) as T;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** "LINDQVIST, Sara" (the registry's form) → "Sara Lindqvist"; other names are kept as given. */
export function officerName(raw: string): string {
  const m = /^\s*([^,]+),\s*(.+?)\s*$/.exec(raw);
  if (!m || /\b(ltd|limited|llp|plc|inc|ab|gmbh)\b/i.test(raw)) return raw.trim();
  const title = (w: string) => w.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  return `${title(m[2]!)} ${title(m[1]!)}`;
}
const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

const POLICIES_SECTION = "Policies";
const POLICY_TITLES = ["Privacy policy", "Terms of service", "Cookie policy"] as const;

/** The text of a ProseMirror document's first heading (a policy block is matched by it). */
function docTitle(doc: Record<string, unknown>): string {
  const nodes = Array.isArray(doc.content) ? (doc.content as Record<string, unknown>[]) : [];
  const heading = nodes.find((n) => n.type === "heading");
  const text = (n: Record<string, unknown>): string => (typeof n.text === "string" ? n.text : Array.isArray(n.content) ? (n.content as Record<string, unknown>[]).map(text).join("") : "");
  return heading ? text(heading).trim() : "";
}
const addr = (v: unknown): Record<string, string> => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string" && x).map(([k, x]) => [k, x as string])) : {});

export const legalRouter = router({
  /** Jurisdiction recommender (AC-11.11.1): two-jurisdiction headline, up to 6 cards with a date-checked stamp. */
  recommend: write.input(z.object({ fundraising: z.enum(["none", "angels", "vc"]).default("none"), coFounders: z.number().int().min(0).max(10).default(0) })).use(modelLimited("recommend")).mutation(async ({ ctx, input }) => {
    const profile = await repos.founders.get(ctx.db, ctx.userId);
    const result = await ctx.models.complete({
      route: "departmentLead",
      schema: JurisdictionRecommendation,
      system: `You are the Legal agent. Recommend two jurisdictions for this founder and business with up to six cards. Information only, never legal or tax advice. ${HOUSE_STYLE}`,
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ founder: profile ? { citizenship: profile.citizenship, residence: profile.residence, target_markets: profile.targetMarkets, budget_minor: profile.budgetMinor } : null, business: { archetype: ctx.business.archetype, name: ctx.business.name }, fundraising: input.fundraising, co_founders: input.coFounders }) + "\n```" }],
      attribution: { businessId: ctx.businessId, kind: "jurisdiction_recommender" },
    });
    await ctx.rls((tx) => audit(tx, ctx, { action: "legal.recommend", target: { kind: "business", id: ctx.businessId }, details: { headline: result.json.headline, costMinor: result.cost.costMinorInt } }));
    const checkedAt = new Date().toISOString().slice(0, 10);
    return { ...result.json, cards: result.json.cards.map((c) => ({ ...c, dateChecked: checkedAt, costLabel: "Estimate" as const })), disclaimer: "Information, not legal or tax advice. Partner professionals are available for a review.", mode: result.mode };
  }),

  incorporate: router({
    /** Starts the route (Atlas / Companies House / kit) on the orchestrator; the founder signs in, reviews, submits and pays. */
    start: admin.input(z.object({ route: z.enum(INCORPORATION_ROUTES), jurisdiction: z.string().min(2).max(40), entityType: z.string().min(1).max(60), legalName: z.string().min(1).max(200) })).mutation(async ({ ctx, input }) => {
      const started = await ctx.rls(async (tx) => {
        if (await repos.legal.activeIncorporation(tx, ctx.businessId)) throw new ValidationError("An incorporation is already in progress");
        const entity = await repos.legal.createEntity(tx, ctx.businessId, { jurisdiction: input.jurisdiction, entityType: input.entityType, legalName: input.legalName, status: "forming" });
        const incorporation = await repos.legal.startIncorporation(tx, ctx.businessId, { legalEntityId: entity.id, route: input.route, status: "draft", steps: [], workflowId: null });
        await audit(tx, ctx, { action: "legal.incorporate.start", target: { kind: "incorporation", id: incorporation.id }, details: { route: input.route, jurisdiction: input.jurisdiction } });
        return { entity, incorporation };
      });
      const workflowId = workflowIds.incorporation(started.incorporation.id);
      const workflow = await ctx.temporal.start(WORKFLOWS.incorporation, { workflowId, args: [{ businessId: ctx.businessId, incorporationId: started.incorporation.id, route: input.route }] });
      // A start that never reached the orchestrator must not sit in "draft" (an active status) and block every later start.
      const incorporation = workflow.queued
        ? await repos.legal.updateIncorporation(ctx.db, ctx.businessId, started.incorporation.id, { workflowId, status: "in_progress" })
        : await repos.legal.abandonIncorporation(ctx.db, ctx.businessId, started.incorporation.id, `Could not start: ${workflow.reason ?? "the orchestrator is unreachable"}. Nothing was prepared; start again.`);
      return { ...started, incorporation, workflow, founderSubmits: true as const };
    }),
    status: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [incorporation, entity, all] = await Promise.all([repos.legal.activeIncorporation(tx, ctx.businessId), repos.legal.primaryEntity(tx, ctx.businessId), repos.legal.listIncorporations(tx, ctx.businessId)]);
        return { incorporation, entity, history: all };
      }),
    ),
    /**
     * The founder clicked submit in the supervised session (the only way past awaiting_founder, AC-11.11.4). The
     * incorporation is loaded under this business first (audit ARB-01): one from another business is "not found" and no
     * workflow hears anything; one not waiting for the founder is refused. The workflow id comes from that row.
     */
    founderSubmitted: admin.input(z.object({ incorporationId: Id, reference: z.string().trim().max(60).optional() })).mutation(async ({ ctx, input }) => {
      const pending = await ctx.rls((tx) => repos.legal.getIncorporation(tx, ctx.businessId, input.incorporationId));
      if (pending.status !== "awaiting_founder") throw new ValidationError(`The incorporation is ${pending.status.replace(/_/g, " ")}, not waiting for your submission`, { incorporationId: pending.id, status: pending.status });
      const reference = input.reference ? input.reference : undefined;
      const workflow = await ctx.temporal.signal(workflowIds.incorporation(pending.id), "founderSubmit", { kind: "submitted", by: ctx.userId, at: new Date().toISOString(), ...(reference ? { payload: { reference } } : {}) });
      // Nothing heard it: nothing is recorded, so the pack still waits for the founder (and can be canceled).
      if (!workflow.queued) throw new AppError("unavailable", `Your submission could not be recorded: ${workflow.reason ?? "the orchestrator is unreachable"}. Nothing changed; try again in a minute.`, 503);
      const incorporation = await ctx.rls(async (tx) => {
        // Only from awaiting_founder: a second click, or a submit racing a cancel, changes nothing.
        const i = await repos.legal.transitionIncorporation(tx, ctx.businessId, pending.id, ["awaiting_founder"], { status: "submitted" });
        if (!i) throw new ValidationError("The incorporation is no longer waiting for your submission", { incorporationId: pending.id });
        await audit(tx, ctx, { action: "legal.incorporate.founder_submitted", target: { kind: "incorporation", id: i.id }, details: { queued: workflow.queued, reference: reference ?? null } });
        return i;
      });
      return { incorporation, workflow };
    }),
    /**
     * Cancels an incorporation that has not been filed (draft, in progress, or waiting for the founder). The workflow is
     * told (`founderSubmit` `cancel`, which it verifies came from an owner or admin) and abandons it; when no workflow
     * hears the signal (it never started, or the orchestrator is unreachable) the row is abandoned here. Either way
     * the forming entity is archived and a new incorporation can start.
     */
    cancel: admin.input(z.object({ incorporationId: Id })).mutation(async ({ ctx, input }) => {
      const current = await ctx.rls((tx) => repos.legal.getIncorporation(tx, ctx.businessId, input.incorporationId));
      if (!(CANCELABLE_INCORPORATION_STATUSES as readonly string[]).includes(current.status)) {
        throw new ValidationError(current.status === "submitted" ? "The filing is already with the registry; it cannot be canceled here" : `The incorporation is ${current.status.replace(/_/g, " ")}`, { incorporationId: current.id, status: current.status });
      }
      const workflow = current.workflowId ? await ctx.temporal.signal(workflowIds.incorporation(current.id), "founderSubmit", { kind: "cancel", by: ctx.userId, at: new Date().toISOString() }) : { queued: false, reason: "no workflow was started" };
      const incorporation = await ctx.rls(async (tx) => {
        const i = await repos.legal.abandonIncorporation(tx, ctx.businessId, current.id, "Canceled by the founder.");
        await audit(tx, ctx, { action: "legal.incorporate.cancel", target: { kind: "incorporation", id: i.id }, details: { queued: workflow.queued } });
        return i;
      });
      return { incorporation, workflow };
    }),
  }),

  entity: router({
    /**
     * The founder records what the registry issued after filing (the registration number, the date of formation): an
     * incorporation completes before the registry answers, so these arrive later, typed in by the founder.
     */
    update: admin.input(z.object({ legalEntityId: Id, regNo: z.string().trim().min(1).max(60).nullable().optional(), formedAt: z.string().date().nullable().optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const entity = await repos.legal.updateEntity(tx, ctx.businessId, input.legalEntityId, { ...(input.regNo !== undefined ? { regNo: input.regNo } : {}), ...(input.formedAt !== undefined ? { formedAt: input.formedAt } : {}) });
        await audit(tx, ctx, { action: "legal.entity.update", target: { kind: "legal_entity", id: entity.id }, details: { fields: Object.keys(input).filter((k) => k !== "legalEntityId" && k !== "businessId") } });
        return entity;
      }),
    ),
  }),

  import: router({
    /** Registry lookup through the connectors (mock fixtures in mock mode). Third-party content is untrusted. */
    lookup: read.input(LookupInput).use(modelLimited("lookup")).mutation(async ({ ctx, input }): Promise<LookupResult> => {
      const checkedAt = new Date().toISOString();
      if (input.country === "gb") {
        const regNo = input.regNo.replace(/\s+/g, "").toUpperCase();
        const company = await call<Record<string, unknown>>(ctx, "companies_house", "get_company", { companyNumber: regNo }, regNo);
        const officers = await call<{ items: Record<string, unknown>[] }>(ctx, "companies_house", "list_officers", { companyNumber: regNo }, regNo);
        const acc = company.accounts as { nextDueOn: string | null } | undefined;
        const cs = company.confirmationStatement as { nextDueOn: string | null } | undefined;
        return {
          source: "companies_house",
          legalName: str(company.name) ?? regNo,
          regNo: str(company.companyNumber) ?? regNo,
          jurisdiction: str(company.jurisdiction) ?? "england-wales",
          entityType: str(company.type) ?? "ltd",
          status: str(company.status),
          formedAt: str(company.dateOfCreation),
          registeredAddress: addr(company.registeredOfficeAddress),
          officers: officers.items.map((o) => ({ name: str(o.name) ?? "Officer", role: str(o.role) ?? "officer", appointedOn: str(o.appointedOn) })),
          deadlines: [acc?.nextDueOn ? { kind: "annual_accounts", dueAt: acc.nextDueOn } : null, cs?.nextDueOn ? { kind: "confirmation_statement", dueAt: cs.nextDueOn } : null].filter((d): d is { kind: string; dueAt: string } => d !== null),
          checkedAt,
          untrusted: true,
        };
      }
      if (input.country === "se") {
        const org = await call<Record<string, unknown>>(ctx, "bolagsverket", "get_organisation", { organisationNumber: input.regNo }, input.regNo);
        return { source: "bolagsverket", legalName: str(org.name) ?? input.regNo, regNo: str(org.organisationNumber) ?? input.regNo, jurisdiction: "se", entityType: str(org.legalForm) ?? "AB", status: str(org.status), formedAt: str(org.registeredAt), registeredAddress: addr(org.address), officers: [], deadlines: [], checkedAt, untrusted: true };
      }
      const company = await call<Record<string, unknown>>(ctx, "opencorporates", "get_company", { jurisdictionCode: input.jurisdictionCode, companyNumber: input.regNo }, input.regNo);
      return { source: "opencorporates", legalName: str(company.name) ?? input.regNo, regNo: str(company.companyNumber) ?? input.regNo, jurisdiction: input.jurisdictionCode, entityType: str(company.companyType) ?? "company", status: str(company.currentStatus), formedAt: str(company.incorporationDate), registeredAddress: addr(company.registeredAddress), officers: [], deadlines: [], checkedAt, untrusted: true };
    }),

    /** Confirm: legal entity, officers as CRM people, share-capital seed on the cap table, compliance calendar (AC-11.11.3). */
    confirm: admin
      .input(
        z.object({
          source: z.enum(["companies_house", "bolagsverket", "opencorporates"]),
          legalName: z.string().min(1).max(200),
          regNo: z.string().min(1).max(60),
          jurisdiction: z.string().min(2).max(40),
          entityType: z.string().min(1).max(60),
          formedAt: z.string().date().nullable().default(null),
          registeredAddress: z.record(z.string(), z.string()).default({}),
          officers: z.array(z.object({ name: z.string().min(1), role: z.string().min(1), appointedOn: z.string().nullable().default(null) })).default([]),
          shareCapitalMinor: z.number().int().nonnegative().nullable().default(null),
          currency: z.string().length(3).default("EUR"),
          deadlines: z.array(z.object({ kind: z.string().min(1), dueAt: z.string() })).default([]),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.rls(async (tx) => {
          // Idempotent: the same company (jurisdiction + number) imported again updates what the first import wrote.
          const { entity, created } = await repos.legal.importEntity(tx, ctx.businessId, { ...input, officers: input.officers.map((o) => ({ ...o, name: officerName(o.name) })), status: "active", source: input.source });
          const known = await repos.entities.listByRole(tx, ctx.businessId, "officer", { limit: 500 });
          const people: string[] = [];
          for (const o of input.officers) {
            const name = officerName(o.name);
            const existing = known.items.find((p) => sameName(p.displayName, name) || p.aliases.some((a) => sameName(a, o.name)));
            if (existing) {
              if (existing.role.stage !== o.role) await repos.entities.updateRole(tx, ctx.businessId, existing.role.id, { stage: o.role });
              people.push(existing.id);
              continue;
            }
            const person = await repos.entities.create(tx, ctx.businessId, { kind: "person", displayName: name, aliases: name === o.name ? [] : [o.name], source: input.source, lawfulBasis: "legitimate_interest" });
            await repos.entities.addRole(tx, ctx.businessId, person.id, { role: "officer", stage: o.role, startedAt: o.appointedOn ? new Date(o.appointedOn) : undefined });
            people.push(person.id);
          }
          if (input.shareCapitalMinor !== null) {
            // The registry's issued share capital on the business's ordinary class: reused when the cap table has it.
            const ordinary = await repos.capTable.findSecurityByClass(tx, ctx.businessId, "Ordinary");
            if (ordinary) await repos.capTable.updateSecurity(tx, ctx.businessId, ordinary.id, { terms: { ...(ordinary.terms as Record<string, unknown>), shareCapitalMinor: input.shareCapitalMinor, source: input.source } });
            else await repos.capTable.createSecurity(tx, ctx.businessId, { class: "Ordinary", kind: "common", currency: input.currency, terms: { shareCapitalMinor: input.shareCapitalMinor, source: input.source } });
          }
          let deadlines = 0;
          for (const d of input.deadlines) {
            const dueAt = new Date(d.dueAt);
            if (Number.isNaN(dueAt.getTime()) || (await repos.legal.findCompliance(tx, ctx.businessId, d.kind, dueAt))) continue;
            await repos.legal.createCompliance(tx, ctx.businessId, { legalEntityId: entity.id, kind: d.kind, title: d.kind.replace(/_/g, " "), dueAt, recurrence: "yearly" });
            deadlines += 1;
          }
          await audit(tx, ctx, { action: "legal.import.confirm", target: { kind: "legal_entity", id: entity.id }, details: { source: input.source, regNo: input.regNo, created, officers: people.length, deadlinesAdded: deadlines } });
          return { entity, people, created };
        }),
      ),
  }),

  contracts: router({
    list: read.input(z.object({ status: z.enum(CONTRACT_STATUSES).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.legal.listContracts(tx, ctx.businessId, input ?? {}))),
    get: read.input(z.object({ contractId: Id })).query(({ ctx, input }) => ctx.rls((tx) => repos.legal.getContract(tx, ctx.businessId, input.contractId))),
    create: write.input(CreateContractInput).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const contract = await repos.legal.createContract(tx, ctx.businessId, { ...input, status: "draft" });
        await audit(tx, ctx, { action: "legal.contracts.create", target: { kind: "contract", id: contract.id }, details: { kind: input.kind } });
        return contract;
      }),
    ),
    update: write.input(z.object({ contractId: Id, patch: UpdateContractInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const contract = await repos.legal.updateContract(tx, ctx.businessId, input.contractId, input.patch);
        await audit(tx, ctx, { action: "legal.contracts.update", target: { kind: "contract", id: contract.id }, details: { fields: Object.keys(input.patch) } });
        return contract;
      }),
    ),
    /**
     * Signing is founder-only (hard gate): recording `signed` requires owner/admin and names the human who signed.
     * Setting the status a contract already has changes nothing: no event, no audit row (a double click or a retry).
     * Moving to `awaiting_signature` sends nothing anywhere; the founder sends the envelope from the e-signature tool.
     */
    setStatus: write.input(z.object({ contractId: Id, status: z.enum(CONTRACT_STATUSES), provider: z.enum(["dropbox_sign", "manual", "other"]).default("manual") })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.status === "signed" && !["owner", "admin"].includes(ctx.role)) throw new ValidationError("Only the founder (owner/admin) can record a signature");
        const { contract, changed } = await repos.legal.transitionContract(tx, ctx.businessId, input.contractId, input.status);
        if (!changed) return contract;
        if (input.status === "signed" && contract.counterpartyEntityId) {
          await emit(tx, ctx, {
            type: "contract.signed",
            payload: { contractId: contract.id, counterpartyEntityId: contract.counterpartyEntityId, kind: contract.kind, title: contract.title || contract.kind, signedAt: (contract.signedAt ?? new Date()).toISOString(), signedBy: { kind: "user", id: ctx.userId }, value: contract.valueMinor === null ? null : { amountMinor: contract.valueMinor, currency: contract.currency }, provider: input.provider, docRef: contract.docRef, obligationCount: (contract.obligations as unknown[]).length },
            entityIds: [contract.counterpartyEntityId],
            idempotencyKey: `contract.signed:${contract.id}`,
          });
        }
        await audit(tx, ctx, { action: "legal.contracts.set_status", target: { kind: "contract", id: contract.id }, details: { status: input.status } });
        return contract;
      }),
    ),
  }),

  compliance: router({
    list: read.input(z.object({ pendingOnly: z.boolean().default(true), days: z.number().int().min(1).max(365).default(90) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const [events, deadlines, filings] = await Promise.all([repos.legal.listCompliance(tx, ctx.businessId, { pendingOnly: input?.pendingOnly ?? true }), repos.legal.upcomingDeadlines(tx, ctx.businessId, input?.days ?? 90), repos.legal.listFilings(tx, ctx.businessId, { limit: 200 })]);
        return { events, upcoming: deadlines, filings: filings.items };
      }),
    ),
  }),

  policies: router({
    /**
     * Publishes the first version of a policy (privacy policy, terms, cookie policy) as a block in the product spec's
     * "Policies" section, written as the founder (a pinned human edit). Later versions are per-hunk refreshes of that
     * block through `product.spec.editBlock`; publishing a policy that already has a block is a conflict.
     */
    publish: write.input(z.object({ title: z.enum(POLICY_TITLES), content: z.record(z.string(), z.unknown()) })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (docTitle(input.content).toLowerCase() !== input.title.toLowerCase()) throw new ValidationError(`The policy must start with the heading "${input.title}"`);
        const existing = (await repos.product.listBlocks(tx, ctx.businessId)).find((b) => b.section === POLICIES_SECTION && docTitle(b.content as Record<string, unknown>).toLowerCase() === input.title.toLowerCase());
        if (existing) throw new ConflictError(`The ${input.title.toLowerCase()} is already in the spec; refresh it instead`, { blockId: existing.id });
        const block = await repos.product.createBlock(tx, ctx.businessId, { section: POLICIES_SECTION, content: input.content, authoredByKind: "user", authoredBy: ctx.userId, pinned: true });
        await audit(tx, ctx, { action: "legal.policies.publish", target: { kind: "spec_block", id: block.id }, details: { title: input.title } });
        return block;
      }),
    ),
  }),

  regulatory: router({
    /** The founder's regulated-sector choices; a sector without one falls back to the suggestion on the screen. */
    list: read.query(({ ctx }) => ctx.rls((tx) => repos.legal.listSectorChoices(tx, ctx.businessId))),
    /** Whether a sector applies, and which of its checklist items are done. Open gates go into the team's brief. */
    set: write
      .input(z.object({ sector: z.enum(SECTOR_KEYS as unknown as [string, ...string[]]), applies: z.boolean().optional(), done: z.array(z.string().min(1).max(60)).max(20).optional() }))
      .mutation(({ ctx, input }) =>
        ctx.rls(async (tx) => {
          const known = new Set(SECTOR_GATES[input.sector as keyof typeof SECTOR_GATES].checklist.map((i) => i.id));
          const unknown = (input.done ?? []).filter((id) => !known.has(id));
          if (unknown.length) throw new ValidationError(`Not on the ${SECTOR_GATES[input.sector as keyof typeof SECTOR_GATES].label} checklist: ${unknown.join(", ")}`);
          const gate = await repos.legal.setSectorChoice(tx, ctx.businessId, { sector: input.sector, applies: input.applies, done: input.done, decidedBy: ctx.userId });
          await audit(tx, ctx, { action: "legal.regulatory.set", target: { kind: "regulatory_gate", id: gate.id }, details: { sector: input.sector, applies: gate.applies, done: gate.done.length } });
          return gate;
        }),
      ),
  }),
});
