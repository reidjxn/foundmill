import { ENTITY_MARKUP_RE } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { ComposerOutput } from "../schemas";
import { MockModelClient, numbersIn, wordCount } from "./index";
import { COMPOSER_MAX_WORDS, recommendedBecause } from "./inboxComposer";
import { AGENT_PRIYA, AGENT_TOMAS, COMPOSER_INPUT, EVENT_1, EVENT_2, MANIFEST, ORG_ALDER, PERSON_MARA, promptWith } from "./fixtures.test-helpers";

/** Numbers a note may legitimately contain: every digit token in the input plus the major-unit forms of its minor amounts. */
function allowedNumbers(input: unknown): Set<string> {
  const text = JSON.stringify(input);
  const allowed = numbersIn(text);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (/_minor$|Minor$/.test(k) && typeof val === "number") {
          const major = val / 100;
          allowed.add(String(major));
          allowed.add(major.toFixed(2));
          allowed.add(major.toFixed(0));
        }
        walk(val);
      }
    }
  };
  walk(input);
  return allowed;
}

/**
 * What a mock-mode tester must never read (UX plan §7.19, E2, E4): developer notes, the plumbing, the replace-tier
 * jargon, and the old mechanism-first sentences.
 */
const NEVER_IN_A_NOTE = /Mock citation|replace with|See note\.|named query|\bexhibit\b|policy cap|request_human_action|\bICP\b|\bCPA\b|concurrency|time box|\btriage\b|\bpolicy\b|hard gate|\bengine\b|differ in (what they )?cost|\byour call\b|needs a call from you|outside the current policy caps/i;

function assertComposerInvariants(out: ComposerOutput, input: Record<string, unknown>, manifestIds: Set<string>) {
  expect(ComposerOutput.safeParse(out).success).toBe(true);
  const words = wordCount(out.body_md);
  // Under 180 words and never padded: there is no floor (a clear short note beats a padded one).
  expect(words).toBeGreaterThan(0);
  expect(words).toBeLessThanOrEqual(COMPOSER_MAX_WORDS);
  expect(out.subject.length).toBeLessThanOrEqual(80);
  for (const m of out.body_md.matchAll(ENTITY_MARKUP_RE)) expect(manifestIds.has(m[1] as string), `unknown entity id ${m[1]}`).toBe(true);
  for (const text of [out.subject, out.body_md, ...(out.decision?.options.flatMap((o) => [o.label, o.consequence, o.because ?? ""]) ?? [])]) expect(text).not.toMatch(NEVER_IN_A_NOTE);
  if (out.decision) {
    expect(out.decision.options.length).toBeGreaterThanOrEqual(2);
    expect(out.decision.options.length).toBeLessThanOrEqual(4);
    const recommended = out.decision.options.filter((o) => o.recommended);
    expect(recommended).toHaveLength(1);
    // The recommended option always says why (voice guide §8.1 rule 4).
    expect(recommended[0]!.because, `no because on "${recommended[0]!.label}"`).toMatch(/\S/);
  }
  const queryIds = new Set(((input.named_queries as Array<{ id: string }> | undefined) ?? []).map((q) => q.id));
  if (out.exhibit.kind === "none") expect(out.exhibit.spec_ref).toBeNull();
  else expect(queryIds.has(out.exhibit.spec_ref as string)).toBe(true);
  const allowed = allowedNumbers(input);
  for (const n of numbersIn(out.body_md)) expect(allowed.has(n), `invented number "${n}" in: ${out.body_md}`).toBe(true);
  for (const n of numbersIn(out.subject)) expect(allowed.has(n), `invented number "${n}" in subject`).toBe(true);
}

const VARIANTS: Array<Record<string, unknown>> = [
  COMPOSER_INPUT,
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "channel.threshold_breached", payload: { channel_key: "paid_ads", metric: "cpa", value: 38.5, cap: 25 } }] },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "runway.threshold_crossed", payload: { months: 2.5 } }], metrics: [{ metric: "runway_months", value: 2.5, source: "finance.runway" }] },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "task.completed", payload: { agent_id: AGENT_TOMAS, title: "Retail portal checkout" } }], from_agent: { id: AGENT_TOMAS, name: "Tomas Berg", role: "Backend engineer" } },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "approval.requested", payload: { agent_id: AGENT_PRIYA, title: "Influencer seeding budget", amount_minor: 120000, currency: "EUR" } }] },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "message.received", payload: { entity_id: PERSON_MARA, subject: "Wholesale terms" } }] },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "signup.created", payload: { customer_name: "Mara", channel_key: "seo" } }], named_queries: [] },
  { ...COMPOSER_INPUT, source_events: [], metrics: [] },
  { ...COMPOSER_INPUT, type: "decision", options: [{ id: "x", label: "Ship Friday", consequence: "Earlier feedback", cost_minor: 0, reversible: true, recommended: true }, { id: "y", label: "Ship next week", consequence: "More polish", cost_minor: 2500, reversible: true }] },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "contract.signed", payload: { title: "Retail agreement with Alder & Finch", entity_id: ORG_ALDER } }] },
  { ...COMPOSER_INPUT, manifest: [], source_events: [{ id: EVENT_1, type: "payment.received", payload: { customer_name: "Someone New", amount_minor: 1999, currency: "USD" } }] },
  { ...COMPOSER_INPUT, source_events: [{ id: EVENT_2, type: "cycle.completed", payload: { title: "Cycle seven" } }], business: { name: "Ledgerly", brief: "Bookkeeping for freelancers." } },
];

describe("mock inbox composer (BUILD §11.3, §12.2)", () => {
  it("produces a schema-valid customer_won note from a payment event", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ route: "inboxComposer", messages: promptWith(COMPOSER_INPUT), schema: ComposerOutput });
    const out = r.json;
    expect(out.type).toBe("customer_won");
    expect(out.from_agent_id).toBe(AGENT_PRIYA);
    expect(out.source_event_ids).toEqual([EVENT_1]);
    expect(out.body_md).toContain(`[[ent:${ORG_ALDER}|Alder & Finch]]`);
    expect(out.body_md).toContain("€489");
    // Good news never holds Continue (Nov 7, 2026).
    expect(out.blocks_continue).toBe(false);
    expect(out.status_strip.map((s) => s.metric)).toEqual(["mrr", "runway_months", "customers_week"]);
    expect(out.exhibit).toEqual({ kind: "chart", spec_ref: "q_mrr_12w" });
    expect(out.decision?.options.map((o) => o.label)).toContain("Just celebrate");
    assertComposerInvariants(out, COMPOSER_INPUT, new Set(MANIFEST.map((m) => m.id)));
  });

  it("holds every invariant across varied inputs: under 180 words with no padding, manifest-only ids, one recommended with a because, the chart from the named queries, no invented numbers, no plumbing", async () => {
    const client = new MockModelClient();
    const subjects = new Set<string>();
    for (const input of VARIANTS) {
      const r = await client.complete({ route: "inboxComposer", messages: promptWith(input), schema: ComposerOutput });
      const manifestIds = new Set(((input.manifest as Array<{ id: string }> | undefined) ?? []).map((m) => m.id));
      assertComposerInvariants(r.json, input, manifestIds);
      subjects.add(r.json.subject);
    }
    expect(subjects.size).toBeGreaterThanOrEqual(6);
  });

  it("maps event types to inbox item types and blocking rules", async () => {
    const client = new MockModelClient();
    const warning = (await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[1] as Record<string, unknown>), schema: ComposerOutput })).json;
    expect(warning.type).toBe("warning");
    expect(warning.blocks_continue).toBe(false);
    expect(warning.decision).not.toBeNull();

    const runway = (await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[2] as Record<string, unknown>), schema: ComposerOutput })).json;
    expect(runway.type).toBe("warning");
    expect(runway.blocks_continue).toBe(false); // a Composer note never holds Continue; only the platform's hard stops do (Nov 7, 2026)

    const update = (await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[3] as Record<string, unknown>), schema: ComposerOutput })).json;
    expect(update.type).toBe("update");
    expect(update.decision).toBeNull();
    expect(update.blocks_continue).toBe(false);
    expect(update.from_agent_id).toBe(AGENT_TOMAS);

    const decision = (await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[8] as Record<string, unknown>), schema: ComposerOutput })).json;
    expect(decision.type).toBe("decision");
    expect(decision.decision?.options.map((o) => o.label)).toEqual(["Ship Friday", "Ship next week"]);
    expect(decision.decision?.options.find((o) => o.recommended)?.id).toBe("x");
    expect(decision.decision?.options.find((o) => o.id === "y")?.cost_minor).toBe(2500);
    expect(decision.body_md).not.toContain("2500"); // option costs live on the options, never as raw minor units in prose
    // Options handed over without a reason get one on the recommended option only, written from what they state.
    expect(decision.decision?.options.find((o) => o.id === "x")?.because).toBe(recommendedBecause({ cost_minor: 0, reversible: true }));
    expect(decision.decision?.options.find((o) => o.id === "y")?.because).toBeUndefined();
  });

  it("writes the business stake before the system and keeps a reason the options arrived with (UX plan §7.19)", async () => {
    const client = new MockModelClient();
    const input = {
      ...COMPOSER_INPUT,
      type: "decision",
      options: [
        { id: "trim", label: "Trim spend to extend runway", recommended: true, consequence: "The Finance lead proposes cuts for you to approve.", because: "Recommended because it protects cash without closing any door.", cost_minor: 0, reversible: true },
        { id: "hold", label: "Hold course", recommended: false, consequence: "No change; the warning stays on Home.", because: "On the list because it is the smallest change.", cost_minor: 0, reversible: true },
      ],
    };
    const out = (await client.complete({ route: "inboxComposer", messages: promptWith(input), schema: ComposerOutput })).json;
    expect(out.decision?.options.map((o) => o.because)).toEqual(["Recommended because it protects cash without closing any door.", "On the list because it is the smallest change."]);
    expect(out.body_md).toMatch(/yours to decide because|on your desk because/);
    // An option handed over without a consequence states none rather than a developer note.
    const bare = { ...COMPOSER_INPUT, type: "decision", options: [{ id: "a", label: "Go", recommended: true }, { id: "b", label: "Wait" }] };
    const bareOut = (await client.complete({ route: "inboxComposer", messages: promptWith(bare), schema: ComposerOutput })).json;
    expect(bareOut.decision?.options.map((o) => o.consequence)).toEqual(["", ""]);
    expect(bareOut.decision?.options[0]?.because).toBe(recommendedBecause({ cost_minor: 0, reversible: true }));
  });

  it("defines runway in the sentence and never names the plumbing on a warning", async () => {
    const client = new MockModelClient();
    const runway = (await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[2] as Record<string, unknown>), schema: ComposerOutput })).json;
    expect(runway.body_md).toContain("Runway, the months of cash left at today's spending");
    const breached = (await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[1] as Record<string, unknown>), schema: ComposerOutput })).json;
    expect(breached.body_md).toMatch(/limit/);
    expect(breached.decision?.options.map((o) => o.label)).toContain("Raise the limit and continue");
  });

  it("with no event writes from the grounded next-best decision it is given, never a 'nothing new' filler (composer service parity)", async () => {
    const client = new MockModelClient();
    const input = {
      ...COMPOSER_INPUT,
      source_events: [],
      type: "decision",
      decision_needed: true,
      next_best_decision: { kind: "unblock_tasks", title: "Blocked tasks need a call", facts: { blocked_tasks: 3, running_tasks: 2 } },
      options: [
        { id: "review", label: "Review the blocked tasks now", recommended: true, consequence: "Work resumes this cycle.", cost_minor: 0, reversible: true },
        { id: "park", label: "Park them until the next cycle", recommended: false, consequence: "Dependents wait.", cost_minor: 0, reversible: true },
      ],
    };
    const out = (await client.complete({ route: "inboxComposer", messages: promptWith(input), schema: ComposerOutput })).json;
    expect(out.type).toBe("decision");
    expect(out.subject).toBe("Blocked tasks need a call");
    expect(out.body_md).toContain("blocked tasks: 3");
    expect(out.body_md).not.toMatch(/Quiet period|No fresh events|Decision needed: next step/);
    expect(out.decision?.options.map((o) => o.id)).toEqual(["review", "park"]);
    assertComposerInvariants(out, input, new Set(MANIFEST.map((m) => m.id)));
  });

  it("never emits entity markup when the manifest is empty", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ route: "inboxComposer", messages: promptWith(VARIANTS[10] as Record<string, unknown>), schema: ComposerOutput });
    expect(r.json.body_md).not.toMatch(ENTITY_MARKUP_RE);
    expect(r.json.body_md).toContain("Someone New");
    expect(r.json.body_md).toContain("$19.99");
  });

  it("picks templates by hash so the same event type reads differently for different inputs", async () => {
    const client = new MockModelClient();
    const bodies = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const input = { ...COMPOSER_INPUT, source_events: [{ id: `evt-${i}`, type: "payment.received", payload: { customer_id: ORG_ALDER, amount_minor: 1000 + i, currency: "EUR" } }] };
      const r = await client.complete({ route: "inboxComposer", messages: promptWith(input), schema: ComposerOutput });
      bodies.add(r.json.body_md.split(".")[0] as string);
    }
    expect(bodies.size).toBeGreaterThanOrEqual(2);
  });
});
