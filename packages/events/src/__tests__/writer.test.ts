import { describe, expect, it } from "vitest";
import { ValidationError } from "@founder-manager/shared";
import { buildEvent, writeEvent, writeEvents, type WriteEventInput } from "../outbox/writer";
import { CapturingQueryable, FakeDb } from "../testing/fake-db";
import {
  EVENT_FIXTURES,
  FIXTURE_BUSINESS_ID,
  FIXTURE_ENTITY_ID,
  fixtureId,
  fixtureInput,
} from "../testing/fixtures";

describe("writeEvent", () => {
  it("inserts one events row and one outbox row in the caller's transaction and returns the id", async () => {
    const tx = new CapturingQueryable();
    const id = await writeEvent(tx, fixtureInput("payment.received", { id: undefined }));

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tx.statements).toHaveLength(2);

    const [events, outbox] = tx.statements;
    expect(events!.sql).toMatch(
      /^insert into "events" \(id, business_id, type, occurred_at, actor, entity_ids, payload, narrated\)/,
    );
    expect(events!.sql).toContain(
      "::uuid, $2::uuid, $3, $4::timestamptz, $5::jsonb, array[$6::uuid]::uuid[], $7::jsonb, $8)",
    );
    expect(events!.params).toEqual([
      id,
      FIXTURE_BUSINESS_ID,
      "payment.received",
      "2026-10-05T09:00:00.000Z",
      JSON.stringify({ kind: "system", id: "fixtures" }),
      FIXTURE_ENTITY_ID,
      JSON.stringify(buildEvent(fixtureInput("payment.received")).payload),
      false,
    ]);

    expect(outbox!.sql).toBe('insert into "outbox" (event_id) values ($1::uuid)');
    expect(outbox!.params).toEqual([id]);
  });

  it("writes an empty uuid[] literal when there are no entity ids and defaults occurredAt to now", async () => {
    const tx = new CapturingQueryable();
    const before = Date.now();
    await writeEvent(tx, fixtureInput("cycle.started", { entityIds: [], occurredAt: undefined }));
    const [events] = tx.statements;
    expect(events!.sql).toContain("'{}'::uuid[]");
    const occurredAt = new Date(events!.params[3] as string).getTime();
    expect(occurredAt).toBeGreaterThanOrEqual(before - 5);
    expect(occurredAt).toBeLessThanOrEqual(Date.now() + 5);
  });

  it("stores the payload with schema defaults applied (what the relay will publish)", async () => {
    const db = new FakeDb();
    const id = await writeEvent(db, {
      businessId: FIXTURE_BUSINESS_ID,
      type: "task.started",
      actor: { kind: "agent", id: fixtureId("agent") },
      payload: {
        taskId: fixtureId("t"),
        kind: "code",
        title: "x",
        assigneeAgentId: fixtureId("agent"),
      },
    });
    const row = db.events.get(id)!;
    expect(row.payload).toMatchObject({ sessionId: null, roadmapItemId: null, branch: null });
    expect(row.narrated).toBe(false);
    expect(db.outbox).toEqual([{ event_id: id, published_at: null, created_at: expect.any(Date) }]);
  });

  it("rejects an unknown type before touching the database", async () => {
    const tx = new CapturingQueryable();
    await expect(
      writeEvent(tx, {
        ...fixtureInput("payment.received"),
        type: "payment.refunded",
      } as unknown as WriteEventInput),
    ).rejects.toThrow(ValidationError);
    expect(tx.statements).toHaveLength(0);
  });

  it("rejects an invalid payload before touching the database", async () => {
    const tx = new CapturingQueryable();
    await expect(
      writeEvent(
        tx,
        fixtureInput("payment.received", {
          payload: {
            ...EVENT_FIXTURES["payment.received"],
            amount: { amountMinor: "49", currency: "EUR" },
          } as never,
        }),
      ),
    ).rejects.toThrow(/Invalid payload for payment.received/);
    expect(tx.statements).toHaveLength(0);
  });

  it("rejects malformed ids and actors", async () => {
    const tx = new CapturingQueryable();
    await expect(
      writeEvent(tx, fixtureInput("cycle.started", { businessId: "northwind" })),
    ).rejects.toThrow(/businessId must be a UUID/);
    await expect(
      writeEvent(tx, fixtureInput("cycle.started", { entityIds: ["e1"] })),
    ).rejects.toThrow(/entityIds/);
    await expect(writeEvent(tx, fixtureInput("cycle.started", { id: "evt-1" }))).rejects.toThrow(
      /id must be a UUID/,
    );
    await expect(
      writeEvent(tx, fixtureInput("cycle.started", { actor: { kind: "user", id: "" } })),
    ).rejects.toThrow(/actor/);
    await expect(
      writeEvent(tx, fixtureInput("cycle.started", { occurredAt: "not a date" })),
    ).rejects.toThrow(/occurredAt/);
    expect(tx.statements).toHaveLength(0);
  });

  it("propagates database errors (the caller's transaction rolls back)", async () => {
    const db = new FakeDb({
      failOn: (_s, i) => (i === 2 ? new Error("deadlock detected") : undefined),
    });
    await expect(
      db.transaction((tx) => writeEvent(tx, fixtureInput("cycle.started"))),
    ).rejects.toThrow(/deadlock/);
    expect(db.events.size).toBe(0);
    expect(db.outbox).toHaveLength(0);
  });

  it("writeEvents validates all inputs before the first insert and preserves order", async () => {
    const db = new FakeDb();
    await expect(
      writeEvents(db, [
        fixtureInput("cycle.started"),
        { ...fixtureInput("cycle.completed"), payload: {} as never },
      ]),
    ).rejects.toThrow(ValidationError);
    expect(db.statements).toHaveLength(0);

    const ids = await writeEvents(db, [
      fixtureInput("cycle.started"),
      fixtureInput("task.started"),
      fixtureInput("cycle.completed"),
    ]);
    expect(ids).toHaveLength(3);
    expect(db.outbox.map((o) => o.event_id)).toEqual(ids);
    expect(db.statements.map((s) => s.sql.split(" ")[2])).toEqual([
      '"events"',
      '"outbox"',
      '"events"',
      '"outbox"',
      '"events"',
      '"outbox"',
    ]);
  });

  it("is idempotent on a caller-supplied id (second insert fails on the primary key, as in Postgres)", async () => {
    const db = new FakeDb();
    await writeEvent(db, fixtureInput("signup.created"));
    await expect(writeEvent(db, fixtureInput("signup.created"))).rejects.toThrow(/duplicate key/);
  });
});
