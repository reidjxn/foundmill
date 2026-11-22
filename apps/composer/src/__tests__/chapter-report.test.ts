/**
 * The chapter report (WP-14 T8): closing a chapter writes one Chief of Staff page whose every item is built from a
 * record and names its agent or customer as an entity link; simulated results never reach it; a chapter with little
 * in it says so; one report a chapter.
 */
import { repos, type ComposerItem } from "@foundmill/db";
import { checkComposerText } from "@foundmill/entity-linker";
import { ENTITY_MARKUP_RE, chapterReportKey, chapterReportSubject } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("chapter-report");
}, 120_000);
afterAll(() => hz?.close());

/** The chapter the tests close: the quarter the suite runs in, seen from early in the next one. */
const today = new Date();
const quarterIndex = Math.floor(today.getUTCMonth() / 3);
const QUARTER = `${today.getUTCFullYear()}-Q${quarterIndex + 1}`;
const LABEL = `Q${quarterIndex + 1} ${today.getUTCFullYear()}`;
const AFTER = new Date(Date.UTC(today.getUTCFullYear(), quarterIndex * 3 + 3, 5));

let n = 0;
async function project(name: string) {
  n += 1;
  const b = await repos.businesses.create(hz.db, { name: `${name} ${n}`, archetype: "b2b_saas" });
  await repos.businesses.commit(hz.db, b.id, { archetype: "b2b_saas" });
  const chief = await repos.agents.create(hz.db, b.id, { name: "Ines Park", agentType: "chief_of_staff", layer: "assistant", status: "healthy" });
  const builder = await repos.agents.create(hz.db, b.id, { name: "Rhea Stone", agentType: "backend_engineer", status: "healthy" });
  return { id: b.id, chief, builder };
}

const goalNote = (agentId: string): ComposerItem => ({
  type: "decision",
  from_agent_id: agentId,
  subject: "Your first goal: get 10 paying customers by Dec 19",
  body_md: "Pick one.",
  status_strip: [],
  exhibit: { kind: "none", spec_ref: null },
  decision: {
    options: [
      { id: "approve", label: "Approve this goal", recommended: true, consequence: "The team aims at it.", cost_minor: 0, reversible: true },
      { id: "change", label: "Change it", recommended: false, consequence: "Tell me what to change.", cost_minor: 0, reversible: true },
    ],
    free_text: true,
    expires_at: null,
  },
  blocks_continue: false,
  source_event_ids: [],
  entity_ids: [],
});

const reportsOf = async (businessId: string) => (await repos.inbox.list(hz.db, businessId, { type: "report", limit: 50 })).items.filter((i) => i.subject === chapterReportSubject(LABEL));
const linkedIds = (body: string) => [...body.matchAll(new RegExp(ENTITY_MARKUP_RE.source, "g"))].map((m) => m[1]!);
const items = (body: string) => body.split("\n").filter((l) => l.startsWith("- "));

describe("the chapter report", () => {
  it("closing a chapter writes one page from the Chief of Staff; every item links an agent or a customer of the project", async () => {
    const p = await project("Chapter Rich");
    const service = hz.service({ now: () => AFTER });

    // The records of the chapter: a goal, finished work, a customer, a saved report, and work waiting.
    const proposed = await repos.goals.propose(hz.db, p.id, { sentence: "Get the first 10 paying customers by Dec 19", kind: "paying_customers", target: 10, currency: null, dueOn: "2099-12-19", startValue: 0, reason: "first", agentId: p.chief.id, replacesGoalId: null, item: goalNote(p.chief.id) });
    await repos.goals.approve(hz.db, p.id, proposed.goal.id, { approvedBy: null });
    const task = await repos.tasks.create(hz.db, p.id, { kind: "code", title: "booking-form", founderTitle: "Booking form", status: "ready", assigneeAgentId: p.builder.id });
    const done = (payload: Record<string, unknown>) => repos.events.write(hz.db, p.id, { type: "task.completed", actor: { kind: "agent", id: p.builder.id }, payload: { taskId: task.id, kind: "code", title: "Booking form", assigneeAgentId: p.builder.id, outcome: "success", durationMs: 12 * 60_000, ...payload } });
    const real = [await done({ simulated: false }), await done({ simulated: false })];
    const fake = await done({ simulated: true, title: "A simulated result" });
    const customer = await repos.entities.create(hz.db, p.id, { kind: "organisation", displayName: "Harbor Dental" });
    const paid = await repos.events.write(hz.db, p.id, { type: "payment.received", actor: { kind: "webhook", id: "stripe" }, payload: { amount: { amountMinor: 4_900, currency: "USD" } }, entityIds: [customer.id] });
    await repos.journeys.recordConversion(hz.db, p.id, { entityId: customer.id, kind: "payment", amountMinor: 4_900, currency: "USD", sourceEventId: paid.id, firstPayment: true });
    // A payment the Simulate panel made is not a customer won.
    const ghost = await repos.entities.create(hz.db, p.id, { kind: "organisation", displayName: "Simulated Co" });
    const pretend = await repos.events.write(hz.db, p.id, { type: "payment.received", actor: { kind: "system", id: "simulate" }, payload: { amount: { amountMinor: 77_700, currency: "USD" } }, entityIds: [ghost.id] });
    await repos.journeys.recordConversion(hz.db, p.id, { entityId: ghost.id, kind: "payment", amountMinor: 77_700, currency: "USD", sourceEventId: pretend.id, firstPayment: true });
    await repos.taskReports.save(hz.db, p.id, { taskId: task.id, agentId: p.builder.id, title: "Three suppliers compared", bodyMd: "Supplier A is cheapest." });
    await repos.taskReports.save(hz.db, p.id, { taskId: task.id, agentId: p.builder.id, title: "A made-up market size", bodyMd: "From mock reads.", simulated: true });

    // Asking for the ended chapter's title is how the product learns it closed.
    await service.chapterTitle(p.id, QUARTER);
    const notes = await reportsOf(p.id);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;
    expect(note.fromAgentId).toBe(p.chief.id);
    expect(note.type).toBe("report");
    for (const heading of ["## What we set out to do", "## What we did", "## The best moment", "## What we learned", "## What's next"]) expect(note.bodyMd).toContain(heading);

    // Every item is an entity link to an agent or a customer of this project, and the linker accepts every one.
    const body = note.bodyMd;
    expect(items(body).length).toBeGreaterThanOrEqual(5);
    for (const line of items(body)) expect(line, line).toMatch(new RegExp(ENTITY_MARKUP_RE.source));
    const allowed = new Set([p.chief.id, p.builder.id, customer.id]);
    for (const id of linkedIds(body)) expect(allowed.has(id), id).toBe(true);
    expect(checkComposerText(body, await hz.manifest(p.id)).ok).toBe(true);

    // The claims, each from its record.
    expect(body).toContain(`“Get the first 10 paying customers by Dec 19”, the goal [[ent:${p.chief.id}|Ines Park]] proposed and you approved.`);
    expect(body).toContain(`[[ent:${p.builder.id}|Rhea Stone]] finished 2 pieces of work.`);
    expect(body).toMatch(new RegExp(`\\[\\[ent:${customer.id}\\|Harbor Dental\\]\\] became a customer on [A-Z][a-z]{2} \\d{1,2}\\.`));
    expect(body).toContain(`[[ent:${p.builder.id}|Rhea Stone]] reported “Three suppliers compared”.`);
    expect(body).toContain(`[[ent:${p.builder.id}|Rhea Stone]] has next “Booking form”.`);
    // The note carries the records behind it: the real finished work and the real payment, and the customer.
    expect([...note.sourceEventIds].sort()).toEqual([...real.map((e) => e.id), paid.id].sort());
    expect(note.entityIds).toEqual([customer.id]);

    // Nothing simulated reached the page, and no amount of money is on it.
    expect(note.sourceEventIds).not.toContain(fake.id);
    expect(body).not.toMatch(/Simulated Co|made-up|simulated result|777|\$/i);

    // Once: asking again writes no second page.
    await service.chapterTitle(p.id, QUARTER);
    expect(await service.chapterReport(p.id, QUARTER)).toMatchObject({ written: true, note: { replayed: true } });
    expect(await reportsOf(p.id)).toHaveLength(1);
    expect(await repos.events.byIdempotencyKey(hz.db, p.id, chapterReportKey(QUARTER))).toBeTruthy();
  });

  it("a chapter with little in it says so and invents nothing", async () => {
    const p = await project("Chapter Thin");
    const result = await hz.service({ now: () => AFTER }).chapterReport(p.id, QUARTER);
    expect(result.written).toBe(true);
    const [note] = await reportsOf(p.id);
    const body = note!.bodyMd;
    expect(body).toContain(`${LABEL} was a quiet chapter. There is little on record, so this report is short, and nothing in it is filled in.`);
    expect(body.match(/Nothing on record for this chapter\./g)).toHaveLength(3);
    expect(body).toContain("No single moment stands out on the record for this chapter.");
    expect(body).toContain("Nothing is queued yet.");
    // No item, no link, no number beyond the chapter's own label.
    expect(items(body)).toEqual([]);
    expect(linkedIds(body)).toEqual([]);
    expect(body.replace(LABEL, "")).not.toMatch(/\d/);
  });

  it("is written only for the chapter that just ended, for a project that existed then, and never for a sample business", async () => {
    const p = await project("Chapter Rules");
    const service = hz.service({ now: () => AFTER });
    expect(await hz.service().chapterReport(p.id, QUARTER)).toEqual({ written: false, reason: "not_ended" });
    expect(await service.chapterReport(p.id, `${today.getUTCFullYear() - 1}-Q1`)).toEqual({ written: false, reason: "not_the_last_chapter" });
    const later = new Date(Date.UTC(AFTER.getUTCFullYear(), AFTER.getUTCMonth() + 3, 5));
    const nextQuarter = `${AFTER.getUTCFullYear()}-Q${Math.floor(AFTER.getUTCMonth() / 3) + 1}`;
    const young = await project("Chapter Young");
    await hz.h.pg.query("update businesses set created_at = $1 where id = $2", [later.toISOString(), young.id]);
    expect(await hz.service({ now: () => later }).chapterReport(young.id, nextQuarter)).toEqual({ written: false, reason: "before_the_project" });
    await hz.h.pg.query("update businesses set is_demo = true where id = $1", [p.id]);
    expect(await service.chapterReport(p.id, QUARTER)).toEqual({ written: false, reason: "sample_business" });
    expect(await reportsOf(p.id)).toEqual([]);
  });
});
