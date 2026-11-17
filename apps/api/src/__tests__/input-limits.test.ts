/**
 * Every list and map an api input takes is bounded before zod reads its elements (GHSA-mrhx-c7xc-m3w5). zod builds an
 * issue per failing element of an array without `.max()` and of any record, so a signed-in member's 2 MB body could
 * make the api build hundreds of thousands of issues. An array now carries `.max(n)` first in its chain (zod 4.6.7
 * stops there without reading an element) and a record sits behind `boundedRecord` (its keys counted first).
 *
 * - A walk over every procedure's input schema: no array, set or map without a length cap first, no record without its
 *   key guard (a new input fails here until it is bounded).
 * - Each bounded site through the tRPC caller: one more than the limit, and 100,000 junk elements or keys, are a
 *   BAD_REQUEST whose error stays short with few issues; the limit itself passes the procedure's input parser; a small
 *   valid input still gets past input validation; a few representative calls still succeed end to end.
 */
import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@foundmill/config";
import { SESSION_EVENT_KINDS } from "@foundmill/events";
import { DECISION_TYPES, EMAIL_NOTIFICATION_KINDS, ENTITY_KINDS, EVENT_TYPES, INBOX_ITEM_TYPES, INBOX_STATES, MATCHDAY_LEVELS, MODULE_KEYS, NOTIFICATION_KINDS, PLAYBOOK_PARAMS_MAX_KEYS, PLAYBOOK_WHERE_MAX_KEYS, SECTIONS, TASK_STATUSES } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError, type ZodType } from "zod";
import { appRouter, type Caller } from "../router";
import { createApiHarness, type ApiHarness } from "./harness";

// --- the walk ---------------------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- zod's internal definitions are walked as plain data */
/** zod 4.6.7's rule (util.sizeCaps): the leading run of length checks, one of them a maximum, caps the input before it is read. */
const capped = (checks: any[] | undefined): boolean => {
  for (const ch of checks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check)) return false;
    if ((d.maximum ?? d.length ?? d.size) >= 0) return true;
  }
  return false;
};

/** Paths in one input schema that zod would read element by element without a cap. */
function unbounded(schema: any, path = "input", guarded = false, seen = new Set<any>(), out: string[] = []): string[] {
  if (!schema?._zod || seen.has(schema)) return out;
  seen.add(schema);
  const def = schema._zod.def;
  switch (def.type) {
    case "object":
      for (const [key, value] of Object.entries(def.shape)) unbounded(value, `${path}.${key}`, false, seen, out);
      if (def.catchall) unbounded(def.catchall, `${path}.*`, false, seen, out);
      break;
    case "array":
    case "set":
      if (!capped(def.checks)) out.push(`${def.type} ${path}`);
      unbounded(def.element ?? def.valueType, `${path}[]`, false, seen, out);
      break;
    case "map":
      if (!capped(def.checks)) out.push(`map ${path}`);
      unbounded(def.keyType, `${path}<key>`, false, seen, out);
      unbounded(def.valueType, `${path}<value>`, false, seen, out);
      break;
    case "record":
      if (!guarded) out.push(`record ${path}`);
      unbounded(def.valueType, `${path}{}`, false, seen, out);
      break;
    case "tuple":
      def.items.forEach((item: any, i: number) => unbounded(item, `${path}[${i}]`, false, seen, out));
      if (def.rest) out.push(`tuple rest ${path}`);
      break;
    case "pipe":
      unbounded(def.in, path, guarded, seen, out);
      // `boundedRecord`: a custom guard counts the keys, then the record parses.
      unbounded(def.out, path, guarded || def.in?._zod?.def?.type === "custom", seen, out);
      break;
    case "union":
      def.options.forEach((option: any, i: number) => unbounded(option, `${path}|${i}`, false, seen, out));
      break;
    case "intersection":
      unbounded(def.left, path, false, seen, out);
      unbounded(def.right, path, false, seen, out);
      break;
    case "lazy":
      unbounded(def.getter(), path, false, seen, out);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      unbounded(def.innerType, path, guarded, seen, out);
      break;
  }
  return out;
}

const procedures = (appRouter as any)._def.procedures as Record<string, { _def: { inputs?: ZodType[] } }>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A procedure's own input parsers, in order (tRPC merges them): what the caller would accept, without the handler. */
function parsesInput(path: string, input: Record<string, unknown>): { ok: boolean; issues: number } {
  const inputs = procedures[path]?._def.inputs;
  if (!inputs?.length) throw new Error(`no input parser for ${path}`);
  let merged: Record<string, unknown> = {};
  let issues = 0;
  for (const parser of inputs) {
    const r = parser.safeParse(input);
    if (r.success) merged = { ...merged, ...(r.data as Record<string, unknown>) };
    else issues += r.error.issues.length;
  }
  return { ok: issues === 0, issues };
}

describe("every api input is bounded before zod reads its elements (GHSA-mrhx-c7xc-m3w5)", () => {
  it("no procedure's input has an array, set or map without a cap first, or a record without its key guard", () => {
    const names = Object.keys(procedures);
    expect(names.length).toBeGreaterThan(200);
    const found = names.flatMap((name) => (procedures[name]!._def.inputs ?? []).flatMap((input) => unbounded(input).map((p) => `${name}: ${p}`)));
    expect(found).toEqual([]);
  });
});

// --- each site through the caller -------------------------------------------------------------------------------------

const JUNK = 100_000;
const id = () => randomUUID();
const list = (n: number, item: (i: number) => unknown) => Array.from({ length: n }, (_, i) => item(i));
const keyed = (n: number, entry: (i: number) => [string, unknown]) => Object.fromEntries(list(n, entry) as [string, unknown][]);
const cycle = <T,>(values: readonly T[]) => (i: number) => values[i % values.length]!;
const instructions = { role: "Engineer", goals: ["Ship"], rules: ["Ask first"], playbook: ["Plan, then build"], tone: "Plain", examples: [] as unknown[] };

interface Site {
  /** The procedure, as the caller names it. */
  path: string;
  /** The field that is bounded, for the test's name. */
  field: string;
  limit: number;
  /** One valid element (an array) or entry (a record) by index. */
  item?: (i: number) => unknown;
  entry?: (i: number) => [string, unknown];
  /** The procedure's input around the bounded value (without `businessId`, added for business procedures). */
  input: (value: unknown) => Record<string, unknown>;
  /** A user procedure (no business). */
  user?: true;
}

const sites: Site[] = [
  // agent
  { path: "agent.training.saveDraft", field: "tools", limit: INPUT_LIMITS.agentToolGrants, item: (i) => ({ connectorKey: `connector_${i}`, tools: ["read"] }), input: (tools) => ({ agentId: id(), instructions, tools }) },
  { path: "agent.training.saveDraft", field: "tools[].tools", limit: INPUT_LIMITS.agentToolsPerGrant, item: (i) => `tool_${i}`, input: (tools) => ({ agentId: id(), instructions, tools: [{ connectorKey: "github", tools }] }) },
  ...(["goals", "rules", "playbook"] as const).map((key): Site => ({ path: "agent.training.saveDraft", field: `instructions.${key}`, limit: INPUT_LIMITS.agentInstructionLines, item: (i) => `line ${i}`, input: (lines) => ({ agentId: id(), instructions: { ...instructions, [key]: lines } }) })),
  { path: "agent.training.saveDraft", field: "instructions.examples", limit: INPUT_LIMITS.agentInstructionLines, item: (i) => ({ input: `in ${i}`, output: `out ${i}` }), input: (examples) => ({ agentId: id(), instructions: { ...instructions, examples } }) },
  { path: "agent.negotiation.set", field: "negotiation.topics", limit: INPUT_LIMITS.negotiationTopics, item: (i) => `topic ${i}`, input: (topics) => ({ agentId: id(), negotiation: { enabled: false, topics } }) },
  // business
  { path: "business.startHoliday", field: "authority", limit: DECISION_TYPES.length, item: cycle(DECISION_TYPES), input: (authority) => ({ until: { kind: "return" }, authority }) },
  { path: "business.startHoliday", field: "wakeEvents", limit: EVENT_TYPES.length, item: cycle(EVENT_TYPES), input: (wakeEvents) => ({ until: { kind: "return" }, wakeEvents }) },
  { path: "business.update", field: "glossary", limit: INPUT_LIMITS.glossaryTerms, entry: (i) => [`term${i}`, `meaning ${i}`], input: (glossary) => ({ glossary }) },
  // crm
  { path: "crm.entity.create", field: "aliases", limit: INPUT_LIMITS.entityAliases, item: (i) => `alias ${i}`, input: (aliases) => ({ kind: "person", displayName: "Ada", aliases }) },
  { path: "crm.entity.create", field: "identifiers", limit: INPUT_LIMITS.entityIdentifiers, entry: (i) => [`id_${i}`, `value-${i}`], input: (identifiers) => ({ kind: "person", displayName: "Ada", identifiers }) },
  { path: "crm.entity.update", field: "patch.aliases", limit: INPUT_LIMITS.entityAliases, item: (i) => `alias ${i}`, input: (aliases) => ({ entityId: id(), patch: { aliases } }) },
  { path: "crm.entity.update", field: "patch.identifiers", limit: INPUT_LIMITS.entityIdentifiers, entry: (i) => [`id_${i}`, `value-${i}`], input: (identifiers) => ({ entityId: id(), patch: { identifiers } }) },
  { path: "crm.search", field: "kinds", limit: ENTITY_KINDS.length, item: cycle(ENTITY_KINDS), input: (kinds) => ({ q: "ada", kinds }) },
  { path: "crm.entity.list", field: "kind", limit: ENTITY_KINDS.length, item: cycle(ENTITY_KINDS), input: (kind) => ({ kind }) },
  { path: "crm.entity.count", field: "kind", limit: ENTITY_KINDS.length, item: cycle(ENTITY_KINDS), input: (kind) => ({ kind }) },
  // departments, screens, dashboards
  { path: "department.create", field: "moduleKeys", limit: MODULE_KEYS.length, item: cycle(MODULE_KEYS), input: (moduleKeys) => ({ name: "Ops", moduleKeys }) },
  { path: "department.create", field: "approvers", limit: INPUT_LIMITS.departmentApprovers, item: () => ({ kind: "user", id: id() }), input: (approvers) => ({ name: "Ops", approvers }) },
  { path: "department.update", field: "patch.moduleKeys", limit: MODULE_KEYS.length, item: cycle(MODULE_KEYS), input: (moduleKeys) => ({ departmentId: id(), patch: { moduleKeys } }) },
  { path: "department.update", field: "patch.approvers", limit: INPUT_LIMITS.departmentApprovers, item: () => ({ kind: "user", id: id() }), input: (approvers) => ({ departmentId: id(), patch: { approvers } }) },
  { path: "department.split", field: "department.moduleKeys", limit: MODULE_KEYS.length, item: cycle(MODULE_KEYS), input: (moduleKeys) => ({ sourceId: id(), department: { name: "Ops", moduleKeys } }) },
  { path: "department.split", field: "department.approvers", limit: INPUT_LIMITS.departmentApprovers, item: () => ({ kind: "user", id: id() }), input: (approvers) => ({ sourceId: id(), department: { name: "Ops", approvers } }) },
  { path: "department.reorder", field: "orderedIds", limit: INPUT_LIMITS.departmentIds, item: () => id(), input: (orderedIds) => ({ orderedIds }) },
  { path: "screen.update", field: "layout.widgets", limit: INPUT_LIMITS.screenWidgets, item: (i) => ({ key: "kpi", x: 0, y: i, w: 1, h: 1 }), input: (widgets) => ({ screenId: id(), layout: { widgets } }) },
  { path: "screen.update", field: "layout.widgets[].settings", limit: INPUT_LIMITS.widgetSettings, entry: (i) => [`s${i}`, i], input: (settings) => ({ screenId: id(), layout: { widgets: [{ key: "kpi", x: 0, y: 0, w: 1, h: 1, settings }] } }) },
  { path: "dashboard.update", field: "layout.widgets", limit: INPUT_LIMITS.screenWidgets, item: (i) => ({ key: "kpi", x: 0, y: i, w: 1, h: 1 }), input: (widgets) => ({ dashboardId: id(), layout: { widgets } }) },
  { path: "dashboard.update", field: "layout.widgets[].settings", limit: INPUT_LIMITS.widgetSettings, entry: (i) => [`s${i}`, i], input: (settings) => ({ dashboardId: id(), layout: { widgets: [{ key: "kpi", x: 0, y: 0, w: 1, h: 1, settings }] } }) },
  // team
  { path: "team.agents.clone", field: "departmentIds", limit: INPUT_LIMITS.departmentIds, item: () => id(), input: (departmentIds) => ({ agentId: id(), name: "Copy", departmentIds }) },
  { path: "team.humans.role", field: "sectionPermissions", limit: SECTIONS.length, entry: (i) => [SECTIONS[i] ?? `section_${i}`, "read"], input: (sectionPermissions) => ({ userId: id(), sectionPermissions }) },
  // dev
  { path: "dev.sessions.replay", field: "kinds", limit: SESSION_EVENT_KINDS.length, item: cycle(SESSION_EVENT_KINDS), input: (kinds) => ({ sessionId: id(), kinds }) },
  { path: "dev.tasks.list", field: "status", limit: TASK_STATUSES.length, item: cycle(TASK_STATUSES), input: (status) => ({ status }) },
  { path: "dev.simulate", field: "params", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`p${i}`, i], input: (params) => ({ eventName: "payment.received", params }) },
  // founder (no business)
  { path: "founder.profile.update", field: "skills", limit: INPUT_LIMITS.founderProfileList, entry: (i) => [`skill${i}`, 10], input: (skills) => ({ skills }), user: true },
  { path: "founder.profile.update", field: "targetMarkets", limit: INPUT_LIMITS.founderProfileList, item: (i) => `market ${i}`, input: (targetMarkets) => ({ targetMarkets }), user: true },
  { path: "founder.profile.update", field: "constraints", limit: INPUT_LIMITS.founderProfileList, item: (i) => `constraint ${i}`, input: (constraints) => ({ constraints }), user: true },
  { path: "founder.preferences.update", field: "explainersSeen", limit: 50, entry: (i) => [`screen-${i}`, true], input: (explainersSeen) => ({ explainersSeen }), user: true },
  { path: "founder.preferences.update", field: "toursDone", limit: 50, entry: (i) => [`tour-${i}`, true], input: (toursDone) => ({ toursDone }), user: true },
  { path: "founder.preferences.update", field: "notifications", limit: NOTIFICATION_KINDS.length, entry: (i) => [NOTIFICATION_KINDS[i] ?? `kind_${i}`, true], input: (notifications) => ({ notifications }), user: true },
  { path: "founder.preferences.update", field: "email", limit: EMAIL_NOTIFICATION_KINDS.length, entry: (i) => [EMAIL_NOTIFICATION_KINDS[i] ?? `kind_${i}`, true], input: (email) => ({ email }), user: true },
  { path: "founder.email.update", field: "email", limit: EMAIL_NOTIFICATION_KINDS.length, entry: (i) => [EMAIL_NOTIFICATION_KINDS[i] ?? `kind_${i}`, true], input: (email) => ({ email }), user: true },
  // legal
  ...(
    [
      ["registeredAddress", INPUT_LIMITS.addressLines, undefined, (i: number) => [`line${i}`, `Street ${i}`]],
      ["officers", INPUT_LIMITS.registerOfficers, (i: number) => ({ name: `Officer ${i}`, role: "director" }), undefined],
      ["deadlines", INPUT_LIMITS.registerDeadlines, (i: number) => ({ kind: "annual_accounts", dueAt: `2027-0${(i % 9) + 1}-01` }), undefined],
    ] as const
  ).map(([field, limit, item, entry]): Site => ({ path: "legal.import.confirm", field, limit, item, entry: entry as Site["entry"], input: (value) => ({ source: "companies_house", legalName: "Acme Ltd", regNo: "01234567", jurisdiction: "england-wales", entityType: "ltd", [field]: value }) })),
  { path: "legal.contracts.create", field: "obligations", limit: INPUT_LIMITS.contractObligations, item: (i) => ({ what: `Obligation ${i}` }), input: (obligations) => ({ kind: "nda", obligations }) },
  { path: "legal.contracts.update", field: "patch.obligations", limit: INPUT_LIMITS.contractObligations, item: (i) => ({ what: `Obligation ${i}` }), input: (obligations) => ({ contractId: id(), patch: { obligations } }) },
  { path: "legal.policies.publish", field: "content", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => (i === 0 ? ["type", "doc"] : [`k${i}`, i]), input: (content) => ({ title: "Privacy policy", content }) },
  // product
  { path: "product.spec.editBlock", field: "patch.sources", limit: INPUT_LIMITS.linkedIds, item: () => id(), input: (sources) => ({ blockId: id(), patch: { sources } }) },
  { path: "product.spec.editBlock", field: "patch.content", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => (i === 0 ? ["type", "doc"] : [`k${i}`, i]), input: (content) => ({ blockId: id(), patch: { content } }) },
  { path: "product.roadmap.upsert", field: "specBlockIds", limit: INPUT_LIMITS.linkedIds, item: () => id(), input: (specBlockIds) => ({ title: "Checkout", specBlockIds }) },
  { path: "product.roadmap.link", field: "specBlockIds", limit: INPUT_LIMITS.linkedIds, item: () => id(), input: (specBlockIds) => ({ itemId: id(), specBlockIds }) },
  { path: "product.roadmap.link", field: "taskIds", limit: INPUT_LIMITS.linkedIds, item: () => id(), input: (taskIds) => ({ itemId: id(), taskIds }) },
  { path: "product.proposals.decideHunk", field: "edited", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => (i === 0 ? ["type", "doc"] : [`k${i}`, i]), input: (edited) => ({ hunkId: id(), decision: "edited", edited }) },
  { path: "pageQuiz.save", field: "definition", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`k${i}`, i], input: (definition) => ({ definition }) },
  { path: "pageQuiz.approve", field: "definition", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`k${i}`, i], input: (definition) => ({ definition }) },
  // finance, distribution
  { path: "finance.forecast.update", field: "series", limit: INPUT_LIMITS.forecastSeries, item: (i) => ({ month: i, cashMinor: 100 }), input: (series) => ({ scenario: "base", series }) },
  { path: "finance.forecast.update", field: "drivers", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`d${i}`, i], input: (drivers) => ({ scenario: "base", drivers }) },
  { path: "finance.capTable.createSecurity", field: "terms", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`t${i}`, i], input: (terms) => ({ class: "Ordinary", kind: "common", terms }) },
  { path: "distribution.campaigns.create", field: "config", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`c${i}`, i], input: (config) => ({ channelId: id(), name: "Launch", config }) },
  { path: "distribution.campaigns.update", field: "patch.config", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`c${i}`, i], input: (config) => ({ campaignId: id(), patch: { config } }) },
  // inbox, journeys, integrations
  { path: "inbox.list", field: "state", limit: INBOX_STATES.length, item: cycle(INBOX_STATES), input: (state) => ({ state }) },
  { path: "inbox.list", field: "type", limit: INBOX_ITEM_TYPES.length, item: cycle(INBOX_ITEM_TYPES), input: (type) => ({ type }) },
  { path: "journey.list", field: "matchdayLevel", limit: MATCHDAY_LEVELS.length, item: cycle(MATCHDAY_LEVELS), input: (matchdayLevel) => ({ matchdayLevel }) },
  { path: "integrations.connect", field: "input", limit: INPUT_LIMITS.jsonObjectKeys, entry: (i) => [`f${i}`, `v${i}`], input: (value) => ({ connectorKey: "no_such_connector", input: value }) },
];

/** The bounded value with `n` valid elements or entries. */
const valueOf = (site: Site, n: number): unknown => (site.item ? list(n, site.item) : keyed(n, site.entry!));
/** 100,000 elements or keys that are each wrong for the schema. */
const junkOf = (site: Site): unknown => (site.item ? list(JUNK, () => 42) : keyed(JUNK, (i) => [`junk_${i}`, { bad: [i] }]));

type Outcome = { ok: true } | { ok: false; code?: string; message: string; zodIssues: number | null };
async function call(caller: Caller, path: string, input: Record<string, unknown>): Promise<Outcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the procedure is named by its path
  const procedure = path.split(".").reduce<any>((node, key) => node[key], caller);
  try {
    await procedure(input);
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message: string; cause?: unknown };
    return { ok: false, code: err.code, message: String(err.message), zodIssues: err.cause instanceof ZodError ? err.cause.issues.length : null };
  }
}

describe("each bounded api input: past its limit a short BAD_REQUEST, within it parsed as before", () => {
  let hz: ApiHarness;
  let owner: Caller;
  const inputFor = (site: Site, value: unknown) => (site.user ? site.input(value) : { businessId: hz.A.businessId, ...site.input(value) });

  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "input-limits" });
    owner = hz.caller({ userId: hz.A.ownerId });
  }, 120_000);
  afterAll(() => hz.close());

  it("covers every site the walk would otherwise flag (one row per bounded field)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(55);
    for (const site of sites) expect(procedures[site.path], site.path).toBeTruthy();
  });

  for (const site of sites) {
    it(`${site.path} ${site.field}: ${site.limit + 1} and ${JUNK.toLocaleString("en-US")} are refused in short, ${site.limit} parses`, async () => {
      for (const value of [valueOf(site, site.limit + 1), junkOf(site)]) {
        const out = await call(owner, site.path, inputFor(site, value));
        expect(out.ok).toBe(false);
        if (out.ok) continue;
        expect(out.code).toBe("BAD_REQUEST");
        expect(out.zodIssues).not.toBeNull();
        expect(out.zodIssues!).toBeLessThanOrEqual(3);
        expect(out.message.length).toBeLessThan(2_000);
      }
      // The limit itself passes the procedure's own input parsers (what a real client sends is still accepted).
      const atLimit = parsesInput(site.path, inputFor(site, valueOf(site, site.limit)));
      expect(atLimit, `${site.path} ${site.field} at ${site.limit}`).toEqual({ ok: true, issues: 0 });
      // A small valid input gets past input validation (the procedure may still refuse it for its own reasons).
      const small = await call(owner, site.path, inputFor(site, valueOf(site, Math.min(2, site.limit))));
      if (!small.ok) expect(small.zodIssues, `${site.path}: ${small.message}`).toBeNull();
    });
  }

  it("team.playbooks: a flow's `where` and step params are counted before zod reads a key", async () => {
    const flow = (where: unknown, params: unknown) => ({ trigger: { event: "payment.received", where }, steps: [{ action: { type: "create_task", params }, label: "Thank the customer" }] });
    for (const [where, params] of [
      [keyed(PLAYBOOK_WHERE_MAX_KEYS + 1, (i) => [`f${i}`, "x"]), {}],
      [keyed(JUNK, (i) => [`f${i}`, { bad: true }]), {}],
      [{}, keyed(PLAYBOOK_PARAMS_MAX_KEYS + 1, (i) => [`p${i}`, i])],
      [{}, keyed(JUNK, (i) => [`p${i}`, i])],
    ] as const) {
      const out = await call(owner, "team.playbooks.create", { businessId: hz.A.businessId, sourceText: "When a payment arrives, thank the customer", flow: flow(where, params) });
      expect(out.ok).toBe(false);
      if (out.ok) continue;
      expect(out.code).toBe("BAD_REQUEST");
      expect(out.message.length).toBeLessThan(2_000);
    }
  });

  it("representative valid inputs still succeed end to end", async () => {
    const { businessId } = hz.A;
    await owner.department.resetDefaults({ businessId });
    const departments = await owner.department.list({ businessId });
    expect(departments.length).toBeGreaterThan(1);
    const order = [...departments].reverse().map((d) => d.id);
    const reordered = await owner.department.reorder({ businessId, orderedIds: order });
    expect(reordered.map((d) => d.id)).toEqual(order);

    const entity = await owner.crm.entity.create({ businessId, kind: "person", displayName: "Ada Lovelace", identifiers: { email: "ada@example.com" }, aliases: ["Ada", "Countess of Lovelace"] });
    expect(entity.aliases).toEqual(["Ada", "Countess of Lovelace"]);
    expect((entity.identifiers as Record<string, unknown>).email).toBe("ada@example.com");

    const business = await owner.business.update({ businessId, glossary: { customer: "client", order: "booking" } });
    expect(business.glossary).toEqual({ customer: "client", order: "booking" });

    const prefs = await owner.founder.preferences.update({ explainersSeen: { home: true, crm: true }, notifications: { [NOTIFICATION_KINDS[0]]: false } });
    expect(prefs.explainersSeen).toMatchObject({ home: true, crm: true });

    const member = await owner.team.humans.role({ businessId, userId: hz.A.memberId, sectionPermissions: { crm: "read", finance: "none" } });
    expect(member.sectionPermissions).toMatchObject({ crm: "read", finance: "none" });
  });
});
