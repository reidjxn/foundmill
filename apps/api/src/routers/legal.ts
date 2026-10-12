/**
 * legal.recommend / incorporate.start/status / import.lookup/confirm / contracts.* / compliance.list (BUILD §11.11).
 * Information, not legal or tax advice; signing and submission are founder clicks (AC-11.11.4).
 */
import { mockIntegrationRecord, type ToolContext } from "@foundmill/connectors";
import { HOUSE_STYLE } from "@foundmill/agents";
import { CreateContractInput, UpdateContractInput, repos } from "@foundmill/db";
import { INCORPORATION_ROUTES, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { modelLimited } from "../services/model-limits";
import { Id, audit, emit, router, sectionAdmin, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

const read = sectionRead("legal");
const write = sectionWrite("legal");
const admin = sectionAdmin("legal");

const JurisdictionCard = z.object({
  jurisdiction: z.string().min(1),
  entity_type: z.string().min(1),
  formation_cost_minor: z.number().int().nonnegative(),
  annual_cost_minor: z.number().int().nonnegative(),
  minimum_capital_minor: z.number().int().nonnegative(),
  time_to_form_days: z.number().int().nonnegative(),
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

async function call<T>(ctx: BusinessContext, connectorKey: string, tool: string, args: unknown): Promise<T> {
  const connector = ctx.connectors.get(connectorKey, ctx.env.INTEGRATIONS_MODE);
  const result = await connector.callTool(tool, args, toolCtx(ctx, connectorKey));
  if (!result.ok) throw new ValidationError(`${connectorKey}.${tool} failed: ${result.error?.message ?? "unknown error"}`);
  const data = result.data as { untrusted?: boolean; content?: T } | T;
  return (data && typeof data === "object" && "untrusted" in (data as object) && "content" in (data as object) ? (data as { content: T }).content : (data as T)) as T;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
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
      if (workflow.queued) await repos.legal.updateIncorporation(ctx.db, ctx.businessId, started.incorporation.id, { workflowId, status: "in_progress" });
      return { ...started, workflow, founderSubmits: true as const };
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
    founderSubmitted: admin.input(z.object({ incorporationId: Id })).mutation(async ({ ctx, input }) => {
      const pending = await ctx.rls((tx) => repos.legal.getIncorporation(tx, ctx.businessId, input.incorporationId));
      if (pending.status !== "awaiting_founder") throw new ValidationError(`The incorporation is ${pending.status.replace(/_/g, " ")}, not waiting for your submission`, { incorporationId: pending.id, status: pending.status });
      const workflow = await ctx.temporal.signal(workflowIds.incorporation(pending.id), "founderSubmit", { kind: "submitted", by: ctx.userId, at: new Date().toISOString() });
      const incorporation = await ctx.rls(async (tx) => {
        const i = await repos.legal.updateIncorporation(tx, ctx.businessId, pending.id, { status: "submitted" });
        await audit(tx, ctx, { action: "legal.incorporate.founder_submitted", target: { kind: "incorporation", id: i.id }, details: { queued: workflow.queued } });
        return i;
      });
      return { incorporation, workflow };
    }),
  }),

  import: router({
    /** Registry lookup through the connectors (mock fixtures in mock mode). Third-party content is untrusted. */
    lookup: read.input(LookupInput).use(modelLimited("lookup")).mutation(async ({ ctx, input }): Promise<LookupResult> => {
      const checkedAt = new Date().toISOString();
      if (input.country === "gb") {
        const company = await call<Record<string, unknown>>(ctx, "companies_house", "get_company", { companyNumber: input.regNo });
        const officers = await call<{ items: Record<string, unknown>[] }>(ctx, "companies_house", "list_officers", { companyNumber: input.regNo });
        const acc = company.accounts as { nextDueOn: string | null } | undefined;
        const cs = company.confirmationStatement as { nextDueOn: string | null } | undefined;
        return {
          source: "companies_house",
          legalName: str(company.name) ?? input.regNo,
          regNo: str(company.companyNumber) ?? input.regNo,
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
        const org = await call<Record<string, unknown>>(ctx, "bolagsverket", "get_organisation", { organisationNumber: input.regNo });
        return { source: "bolagsverket", legalName: str(org.name) ?? input.regNo, regNo: str(org.organisationNumber) ?? input.regNo, jurisdiction: "se", entityType: str(org.legalForm) ?? "AB", status: str(org.status), formedAt: str(org.registeredAt), registeredAddress: addr(org.address), officers: [], deadlines: [], checkedAt, untrusted: true };
      }
      const company = await call<Record<string, unknown>>(ctx, "opencorporates", "get_company", { jurisdictionCode: input.jurisdictionCode, companyNumber: input.regNo });
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
          const entity = await repos.legal.importEntity(tx, ctx.businessId, { ...input, officers: input.officers, status: "active", source: input.source });
          const people: string[] = [];
          for (const o of input.officers) {
            const person = await repos.entities.create(tx, ctx.businessId, { kind: "person", displayName: o.name, source: input.source, lawfulBasis: "legitimate_interest" });
            await repos.entities.addRole(tx, ctx.businessId, person.id, { role: "officer", stage: o.role, startedAt: o.appointedOn ? new Date(o.appointedOn) : undefined });
            people.push(person.id);
          }
          if (input.shareCapitalMinor !== null) await repos.capTable.createSecurity(tx, ctx.businessId, { class: "Ordinary", kind: "common", currency: input.currency, terms: { shareCapitalMinor: input.shareCapitalMinor, source: input.source } });
          for (const d of input.deadlines) await repos.legal.createCompliance(tx, ctx.businessId, { legalEntityId: entity.id, kind: d.kind, title: d.kind.replace(/_/g, " "), dueAt: new Date(d.dueAt), recurrence: "yearly" });
          await audit(tx, ctx, { action: "legal.import.confirm", target: { kind: "legal_entity", id: entity.id }, details: { source: input.source, regNo: input.regNo, officers: people.length, deadlines: input.deadlines.length } });
          return { entity, people };
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
    /** Signing is founder-only (hard gate): recording `signed` requires owner/admin and names the human who signed. */
    setStatus: write.input(z.object({ contractId: Id, status: z.enum(CONTRACT_STATUSES), provider: z.enum(["dropbox_sign", "docusign", "manual", "other"]).default("manual") })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.status === "signed" && !["owner", "admin"].includes(ctx.role)) throw new ValidationError("Only the founder (owner/admin) can record a signature");
        const contract = await repos.legal.setContractStatus(tx, ctx.businessId, input.contractId, input.status);
        if (input.status === "signed" && contract.counterpartyEntityId) {
          await emit(tx, ctx, { type: "contract.signed", payload: { contractId: contract.id, counterpartyEntityId: contract.counterpartyEntityId, kind: contract.kind, title: contract.title || contract.kind, signedAt: new Date().toISOString(), signedBy: { kind: "user", id: ctx.userId }, value: contract.valueMinor === null ? null : { amountMinor: contract.valueMinor, currency: contract.currency }, provider: input.provider, docRef: contract.docRef, obligationCount: (contract.obligations as unknown[]).length }, entityIds: [contract.counterpartyEntityId] });
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
});
