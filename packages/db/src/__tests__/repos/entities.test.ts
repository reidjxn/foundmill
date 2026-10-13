/** CRM entities: hybrid search ranking, filters, scoping, roles/relationships/interactions/mentions/provenance, reversible merge. */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { mergeLog } from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
const ids: Record<string, string> = {};
const unit = (i: number) => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));

beforeAll(async () => {
  r = await setupRepoHarness("crm");
  const A = r.A.businessId;
  const mk = async (key: string, input: Parameters<typeof repos.entities.create>[2]) => {
    ids[key] = (await repos.entities.create(r.db, A, input)).id;
  };
  await mk("northwind", { kind: "organisation", displayName: "Northwind Skincare AB", aliases: ["Northwind"], identifiers: { domain: "northwind.example" }, embedding: unit(1) });
  await mk("northstar", { kind: "organisation", displayName: "Northstar Logistics", identifiers: { domain: "northstar.example" } });
  await mk("sara", { kind: "person", displayName: "Sara Lindqvist", aliases: ["S. Lindqvist"], identifiers: { email: "sara@northwind.example" }, embedding: unit(2) });
  await mk("sarah", { kind: "person", displayName: "Sarah Lindgren", identifiers: { email: "sarah@lindgren.example" } });
  await mk("meridian", { kind: "organisation", displayName: "Meridian Labs", aliases: ["Meridian Labz"], embedding: unit(3) });
  await mk("venue", { kind: "venue", displayName: "Stockholm Waterfront" });
  await repos.entities.addRole(r.db, A, ids.sara!, { role: "lead", stage: "qualified", ownerRef: { kind: "agent", id: r.A.agentId } });
  await repos.entities.addRole(r.db, A, ids.sarah!, { role: "customer" });
  // Business B has a near-identical organisation that must never leak into A's search.
  await repos.entities.create(r.db, r.B.businessId, { kind: "organisation", displayName: "Northwind Skincare AB", identifiers: { domain: "northwind.example" } });
});
afterAll(() => r?.close());

describe("search ranking", () => {
  it("ranks a prefix match first, then trigram similarity, and groups by kind", async () => {
    const res = await repos.entities.search(r.db, r.A.businessId, { q: "north" });
    expect(res.hits.length).toBeGreaterThanOrEqual(2);
    expect(res.hits[0]!.entity.displayName).toMatch(/^North/);
    expect(res.hits[0]!.matchedOn).toBe("prefix");
    expect(res.hits.every((h) => h.entity.businessId === r.A.businessId)).toBe(true);
    expect(res.groups.map((g) => g.kind)).toEqual(["organisation"]);
    expect(res.hits.map((h) => h.score)).toEqual([...res.hits.map((h) => h.score)].sort((a, b) => b - a));
  });

  it("finds a misspelt name through trigram similarity and an alias", async () => {
    const typo = await repos.entities.search(r.db, r.A.businessId, { q: "Lindqvist Sara" });
    expect(typo.hits[0]!.entity.id).toBe(ids.sara);
    const alias = await repos.entities.search(r.db, r.A.businessId, { q: "Meridian Labz" });
    expect(alias.hits[0]!.entity.id).toBe(ids.meridian);
    const fuzzy = await repos.entities.search(r.db, r.A.businessId, { q: "Merdian Lab" });
    expect(fuzzy.hits[0]!.entity.id).toBe(ids.meridian);
    expect(fuzzy.hits[0]!.matchedOn).toMatch(/name|alias/);
  });

  it("matches identifiers exactly (score 1) and through the tsvector", async () => {
    const exact = await repos.entities.search(r.db, r.A.businessId, { q: "sara@northwind.example" });
    expect(exact.hits[0]!.entity.id).toBe(ids.sara);
    expect(exact.hits[0]!.score).toBe(1);
    expect(exact.hits[0]!.matchedOn).toBe("identifier");
    const byDomain = await repos.entities.findByIdentifier(r.db, r.A.businessId, "domain", "NORTHWIND.example");
    expect(byDomain?.id).toBe(ids.northwind);
    const other = await repos.entities.findByIdentifier(r.db, r.B.businessId, "domain", "northwind.example");
    expect(other?.businessId).toBe(r.B.businessId);
  });

  it("applies kind, role and stage filters", async () => {
    const people = await repos.entities.search(r.db, r.A.businessId, { q: "sar", kinds: ["person"] });
    expect(people.hits.map((h) => h.entity.id).sort()).toEqual([ids.sara, ids.sarah].sort());
    const leads = await repos.entities.search(r.db, r.A.businessId, { q: "sar", role: "lead", stage: "qualified" });
    expect(leads.hits.map((h) => h.entity.id)).toEqual([ids.sara]);
    const owned = await repos.entities.search(r.db, r.A.businessId, { q: "sar", ownerId: r.A.agentId });
    expect(owned.hits.map((h) => h.entity.id)).toEqual([ids.sara]);
    const customers = await repos.entities.listByRole(r.db, r.A.businessId, "customer");
    expect(customers.items.map((e) => e.id)).toEqual([ids.sarah]);
  });

  it("uses the query embedding when supplied (pgvector)", async () => {
    if (!r.h.hasVector) return;
    const res = await repos.entities.search(r.db, r.A.businessId, { q: "zzzz-nothing-lexical", embedding: unit(3) });
    expect(res.hits[0]!.entity.id).toBe(ids.meridian);
    expect(res.hits[0]!.matchedOn).toBe("meaning");
    expect(res.hits[0]!.score).toBeCloseTo(0.9, 3);
  });

  it("never returns archived or merged entities and is scoped under RLS too", async () => {
    const tmp = await repos.entities.create(r.db, r.A.businessId, { kind: "person", displayName: "Temporary Tester" });
    await repos.entities.archive(r.db, r.A.businessId, tmp.id);
    expect((await repos.entities.search(r.db, r.A.businessId, { q: "Temporary" })).hits).toHaveLength(0);
    const asMember = await r.as(r.A.memberId, (tx) => repos.entities.search(tx, r.B.businessId, { q: "Northwind" }));
    expect(asMember.hits).toHaveLength(0);
    const svc = await r.svc((tx) => repos.entities.search(tx, r.A.businessId, { q: "Northwind" }));
    expect(svc.hits.every((h) => h.entity.businessId === r.A.businessId)).toBe(true);
  });
});

describe("list, manifest, enrichment", () => {
  it("lists by kind with pagination and builds the linker manifest", async () => {
    const page1 = await repos.entities.list(r.db, r.A.businessId, { kind: ["organisation", "person"], limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await repos.entities.list(r.db, r.A.businessId, { kind: ["organisation", "person"], limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((e) => e.id)).not.toContain(page1.items[0]!.id);
    const manifest = await repos.entities.manifest(r.db, r.A.businessId);
    expect(manifest.find((m) => m.id === ids.northwind)?.aliases).toEqual(["Northwind"]);
    expect(manifest.every((m) => "kind" in m && "displayName" in m)).toBe(true);
    const counts = await repos.entities.countByKind(r.db, r.A.businessId);
    expect(counts.venue).toBe(1);
  });

  it("lists with each entity's active roles (newest first, ended ones left out) and filters on them", async () => {
    const A = r.A.businessId;
    await repos.entities.addRole(r.db, A, ids.sarah!, { role: "champion", startedAt: "2020-01-01" });
    const ended = await repos.entities.addRole(r.db, A, ids.sarah!, { role: "lead" });
    await repos.entities.endRole(r.db, A, ended.id);
    const page = await repos.entities.listWithRoles(r.db, A, { kind: ["person", "organisation"], limit: 100 });
    const byId = new Map(page.items.map((e) => [e.id, e]));
    expect(byId.get(ids.sara!)!.roles).toEqual([expect.objectContaining({ role: "lead", stage: "qualified", ownerRef: { kind: "agent", id: r.A.agentId }, endedAt: null })]);
    expect(byId.get(ids.sarah!)!.roles.map((role) => role.role)).toEqual(["customer", "champion"]);
    expect(byId.get(ids.northwind!)!.roles).toEqual([]);

    const only = async (filter: Parameters<typeof repos.entities.listWithRoles>[2]) => (await repos.entities.listWithRoles(r.db, A, filter)).items.map((e) => e.id).sort();
    expect(await only({ role: "Customer" })).toEqual([ids.sarah]);
    expect(await only({ role: "lead", stage: "QUALIFIED" })).toEqual([ids.sara]);
    expect(await only({ role: "lead", stage: "signed_up" })).toEqual([]);
    expect(await only({ ownerId: r.A.agentId })).toEqual([ids.sara]);
    expect(await only({ departmentId: r.A.agentId })).toEqual([]);
    expect(await only({ kind: "organisation", role: "customer" })).toEqual([]);

    const search = await repos.entities.search(r.db, A, { q: "sar" });
    expect(Object.fromEntries(search.hits.map((h) => [h.entity.id, h.roles.map((role) => role.role)]))).toMatchObject({ [ids.sara!]: ["lead"], [ids.sarah!]: ["customer", "champion"] });
    expect(await repos.entities.activeRoles(r.db, r.B.businessId, [ids.sara!])).toEqual(new Map());
  });

  it("enrich fills empty fields only", async () => {
    const before = await repos.entities.get(r.db, r.A.businessId, ids.northstar!);
    const after = await repos.entities.enrich(r.db, r.A.businessId, ids.northstar!, { identifiers: { domain: "evil.example", linkedin: "https://linkedin.com/company/northstar" }, aliases: ["NSL"], avatarUrl: "https://img.example/ns.png" });
    expect(after.identifiers.domain).toBe(before.identifiers.domain);
    expect(after.identifiers.linkedin).toBe("https://linkedin.com/company/northstar");
    expect(after.aliases).toContain("NSL");
    expect(after.avatarUrl).toBe("https://img.example/ns.png");
  });
});

describe("roles, relationships, interactions, mentions, provenance", () => {
  it("round-trips each child table and refuses cross-business ids", async () => {
    const rel = await repos.entities.upsertRelationship(r.db, r.A.businessId, { fromEntity: ids.sara!, toEntity: ids.northwind!, type: "works_at", strength: 0.9 });
    expect(Number(rel.strength)).toBeCloseTo(0.9);
    const again = await repos.entities.upsertRelationship(r.db, r.A.businessId, { fromEntity: ids.sara!, toEntity: ids.northwind!, type: "works_at", strength: 0.4 });
    expect(again.id).toBe(rel.id);
    const rels = await repos.entities.listRelationships(r.db, r.A.businessId, ids.northwind!);
    expect(rels.map((x) => x.other.id)).toEqual([ids.sara]);
    await expect(repos.entities.upsertRelationship(r.db, r.A.businessId, { fromEntity: ids.sara!, toEntity: r.B.entityId, type: "knows" })).rejects.toThrow(/belong to the business/);

    const note = await repos.entities.addNote(r.db, r.A.businessId, ids.sara!, "Met at the fair", { agentId: r.A.agentId });
    expect(note.kind).toBe("note");
    await repos.entities.createInteraction(r.db, r.A.businessId, { kind: "email", entityIds: [ids.sara!, ids.northwind!], summary: "Intro", direction: "outbound", contentRef: "enc://1" });
    const forSara = await repos.entities.listInteractions(r.db, r.A.businessId, { entityId: ids.sara! });
    expect(forSara.items).toHaveLength(2);
    const emails = await repos.entities.listInteractions(r.db, r.A.businessId, { entityId: ids.northwind!, kind: "email" });
    expect(emails.items).toHaveLength(1);
    await expect(repos.entities.createInteraction(r.db, r.A.businessId, { kind: "call", entityIds: [r.B.entityId], summary: "x" })).rejects.toThrow(/entities of this business/);

    expect(await repos.entities.recordMentions(r.db, r.A.businessId, "inbox_item", r.A.inboxItemId, [ids.sara!, ids.northwind!, r.B.entityId])).toBe(2);
    expect(await repos.entities.recordMentions(r.db, r.A.businessId, "inbox_item", r.A.inboxItemId, [ids.sara!])).toBe(0);
    expect((await repos.entities.entitiesMentionedIn(r.db, r.A.businessId, "inbox_item", r.A.inboxItemId)).map((e) => e.id).sort()).toEqual([ids.sara, ids.northwind].sort());

    await repos.entities.recordProvenance(r.db, r.A.businessId, ids.sara!, { field: "email", source: "stripe", confidence: 0.99 });
    expect((await repos.entities.listProvenance(r.db, r.A.businessId, ids.sara!, "email"))[0]!.source).toBe("stripe");

    const profile = await repos.entities.profile(r.db, r.A.businessId, ids.sara!);
    expect(profile.roles).toHaveLength(1);
    expect(profile.relationships[0]!.other.id).toBe(ids.northwind);
    expect(profile.recentInteractions).toHaveLength(2);
    expect(profile.mentionCount).toBe(1);
  });
});

describe("merge / unmerge (AC-11.12.3)", () => {
  it("merges, re-points children, resolves the merged id, and unmerge restores both records exactly", async () => {
    const A = r.A.businessId;
    const kept = await repos.entities.create(r.db, A, { kind: "person", displayName: "Jon Doe", identifiers: { email: "jon@doe.example" }, source: "import" });
    const dup = await repos.entities.create(r.db, A, { kind: "person", displayName: "Jonathan Doe", aliases: ["Jonny"], identifiers: { linkedin: "https://linkedin.com/in/jondoe" }, avatarUrl: "https://img.example/jon.png" });
    await repos.entities.addRole(r.db, A, dup.id, { role: "lead", stage: "new" });
    await repos.entities.upsertRelationship(r.db, A, { fromEntity: dup.id, toEntity: ids.northwind!, type: "works_at" });
    await repos.entities.recordMentions(r.db, A, "spec_block", r.A.specBlockId, [dup.id]);
    const interaction = await repos.entities.createInteraction(r.db, A, { kind: "meeting", entityIds: [dup.id], summary: "Coffee" });
    const keptBefore = await repos.entities.get(r.db, A, kept.id);
    const dupBefore = await repos.entities.get(r.db, A, dup.id);

    const merged = await repos.entities.merge(r.db, A, kept.id, dup.id, { byKind: "user", byId: r.A.ownerId });
    expect(merged.kept.aliases).toEqual(expect.arrayContaining(["Jonathan Doe", "Jonny"]));
    expect(merged.kept.identifiers).toMatchObject({ email: "jon@doe.example", linkedin: "https://linkedin.com/in/jondoe" });
    expect(merged.kept.avatarUrl).toBe("https://img.example/jon.png");
    expect(merged.merged.mergedIntoId).toBe(kept.id);
    expect(merged.merged.archivedAt).toBeInstanceOf(Date);
    expect((await repos.entities.resolve(r.db, A, dup.id)).id).toBe(kept.id);
    expect((await repos.entities.listRoles(r.db, A, kept.id)).map((x) => x.role)).toEqual(["lead"]);
    expect((await repos.entities.listRelationships(r.db, A, kept.id)).map((x) => x.other.id)).toEqual([ids.northwind]);
    expect((await repos.entities.listInteractions(r.db, A, { entityId: kept.id })).items.map((i) => i.id)).toEqual([interaction.id]);
    expect((await repos.entities.search(r.db, A, { q: "Jonathan" })).hits.map((h) => h.entity.id)).toEqual([kept.id]);
    await expect(repos.entities.merge(r.db, A, kept.id, dup.id)).rejects.toThrow(/already merged/);

    const undone = await repos.entities.unmerge(r.db, A, merged.log.id);
    const keptAfter = await repos.entities.get(r.db, A, kept.id);
    const dupAfter = await repos.entities.get(r.db, A, dup.id);
    const strip = (e: typeof keptBefore) => {
      const { updatedAt: _u, ...rest } = e;
      return rest;
    };
    expect(strip(keptAfter)).toEqual(strip(keptBefore));
    expect(strip(dupAfter)).toEqual(strip(dupBefore));
    expect(undone.log.revertedAt).toBeInstanceOf(Date);
    expect((await repos.entities.listRoles(r.db, A, dup.id)).map((x) => x.role)).toEqual(["lead"]);
    expect(await repos.entities.listRoles(r.db, A, kept.id)).toHaveLength(0);
    expect((await repos.entities.listRelationships(r.db, A, dup.id)).map((x) => x.other.id)).toEqual([ids.northwind]);
    expect((await repos.entities.listInteractions(r.db, A, { entityId: dup.id })).items.map((i) => i.id)).toEqual([interaction.id]);
    expect((await repos.entities.listMentions(r.db, A, dup.id)).length).toBe(1);
    await expect(repos.entities.unmerge(r.db, A, merged.log.id)).rejects.toThrow(/already reverted/);
    expect((await repos.entities.mergeHistory(r.db, A, dup.id)).length).toBe(1);
  });

  it("undoing an earlier merge keeps later edits and an independent later merge", async () => {
    const A = r.A.businessId;
    const x = await repos.entities.create(r.db, A, { kind: "person", displayName: "Ada Audit", identifiers: { email: "ada@audit.example" } });
    const y = await repos.entities.create(r.db, A, { kind: "person", displayName: "A. Audit", aliases: ["Ada A."], identifiers: { linkedin: "https://linkedin.com/in/ada" } });
    const z = await repos.entities.create(r.db, A, { kind: "person", displayName: "Ada Z Audit", identifiers: { phone: "+15550100" }, avatarUrl: "https://img.example/ada.png" });
    await repos.entities.addRole(r.db, A, y.id, { role: "lead" });
    await repos.entities.addRole(r.db, A, z.id, { role: "customer" });
    const first = await repos.entities.merge(r.db, A, x.id, y.id);
    // The founder renames the record and changes its email after the first merge.
    await repos.entities.update(r.db, A, x.id, { displayName: "Ada Lovelace", identifiers: { email: "ada@new.example", linkedin: "https://linkedin.com/in/ada" } });
    const second = await repos.entities.merge(r.db, A, x.id, z.id);
    expect((await repos.entities.mergeHistory(r.db, A, x.id)).map((m) => m.undoBlocked)).toEqual([null, null]);

    await repos.entities.unmerge(r.db, A, first.log.id);
    const after = await repos.entities.get(r.db, A, x.id);
    expect(after.displayName).toBe("Ada Lovelace");
    expect(after.identifiers).toEqual({ email: "ada@new.example", phone: "+15550100" });
    expect(after.aliases).toEqual(["Ada Z Audit"]);
    expect(after.avatarUrl).toBe("https://img.example/ada.png");
    // Y is its own record again with its role; Z stays merged into X with its role.
    expect((await repos.entities.resolve(r.db, A, y.id)).id).toBe(y.id);
    expect((await repos.entities.listRoles(r.db, A, y.id)).map((role) => role.role)).toEqual(["lead"]);
    expect((await repos.entities.resolve(r.db, A, z.id)).id).toBe(x.id);
    expect((await repos.entities.listRoles(r.db, A, x.id)).map((role) => role.role)).toEqual(["customer"]);

    await repos.entities.unmerge(r.db, A, second.log.id);
    const last = await repos.entities.get(r.db, A, x.id);
    expect(last).toMatchObject({ displayName: "Ada Lovelace", aliases: [], avatarUrl: null });
    expect(last.identifiers).toEqual({ email: "ada@new.example" });
    expect((await repos.entities.get(r.db, A, z.id)).mergedIntoId).toBeNull();
    expect((await repos.entities.listRoles(r.db, A, z.id)).map((role) => role.role)).toEqual(["customer"]);
  });

  it("keeps a value edited since the merge and gives the merged record back to an interaction it shared", async () => {
    const A = r.A.businessId;
    const x = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Kept Co" });
    const y = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Kept Company", identifiers: { domain: "kept.example" }, avatarUrl: "https://img.example/y.png", lawfulBasis: "contract" });
    const both = await repos.entities.createInteraction(r.db, A, { kind: "meeting", entityIds: [x.id, y.id], summary: "Both" });
    const onlyY = await repos.entities.createInteraction(r.db, A, { kind: "call", entityIds: [y.id], summary: "Only Y" });
    const merged = await repos.entities.merge(r.db, A, x.id, y.id);
    expect((await repos.entities.listInteractions(r.db, A, { entityId: x.id })).items.map((i) => i.id).sort()).toEqual([both.id, onlyY.id].sort());
    await repos.entities.update(r.db, A, x.id, { avatarUrl: "https://img.example/founder.png" });
    await repos.entities.unmerge(r.db, A, merged.log.id);
    const after = await repos.entities.get(r.db, A, x.id);
    expect(after).toMatchObject({ avatarUrl: "https://img.example/founder.png", lawfulBasis: null, aliases: [] });
    expect(after.identifiers).toEqual({});
    expect((await repos.entities.listInteractions(r.db, A, { entityId: x.id })).items.map((i) => i.id)).toEqual([both.id]);
    expect((await repos.entities.listInteractions(r.db, A, { entityId: y.id })).items.map((i) => i.id).sort()).toEqual([both.id, onlyY.id].sort());
  });

  it("keeps the kept record on an interaction another open merge moved there, also for merges logged before sharedInteractions", async () => {
    const A = r.A.businessId;
    const x = await repos.entities.create(r.db, A, { kind: "person", displayName: "Legacy Kept" });
    const a = await repos.entities.create(r.db, A, { kind: "person", displayName: "Legacy A" });
    const b = await repos.entities.create(r.db, A, { kind: "person", displayName: "Legacy B" });
    const call = await repos.entities.createInteraction(r.db, A, { kind: "call", entityIds: [a.id, b.id], summary: "Three-way call" });
    const first = await repos.entities.merge(r.db, A, x.id, a.id);
    const second = await repos.entities.merge(r.db, A, x.id, b.id);
    // As a merge_log row written before `sharedInteractions` existed.
    await r.db.update(mergeLog).set({ reversibleSnapshot: sql`${mergeLog.reversibleSnapshot} #- '{moved,sharedInteractions}'` }).where(eq(mergeLog.id, second.log.id));
    const ids = async (entityId: string) => (await repos.entities.listInteractions(r.db, A, { entityId })).items.map((i) => i.id);

    await repos.entities.unmerge(r.db, A, second.log.id);
    expect(await ids(x.id)).toEqual([call.id]);
    expect(await ids(b.id)).toEqual([call.id]);
    await repos.entities.unmerge(r.db, A, first.log.id);
    expect(await ids(x.id)).toEqual([]);
    expect((await ids(a.id)).concat(await ids(b.id))).toEqual([call.id, call.id]);
  });

  it("moves the merged record's wins, touches and Inbox items to the kept record, and unmerge gives them back (audit #160)", async () => {
    const A = r.A.businessId;
    const x = await repos.entities.create(r.db, A, { kind: "person", displayName: "Yara Kept" });
    const y = await repos.entities.create(r.db, A, { kind: "person", displayName: "Yara Duplicate" });
    const paid = await repos.journeys.recordConversion(r.db, A, { entityId: x.id, kind: "payment", amountMinor: 4900, currency: "GBP" });
    const signup = await repos.journeys.recordConversion(r.db, A, { entityId: y.id, kind: "signup" });
    const touch = await repos.journeys.recordTouch(r.db, A, { entityId: y.id, kind: "email_open" });
    const own = await repos.journeys.recordTouch(r.db, A, { entityId: x.id, kind: "visit" });
    const onlyY = await repos.inbox.createHumanMessage(r.db, A, { fromUserId: r.A.ownerId, subject: "About the duplicate", bodyMd: "Hello", entityIds: [y.id] });
    const both = await repos.inbox.createHumanMessage(r.db, A, { fromUserId: r.A.ownerId, subject: "About both", bodyMd: "Hello", entityIds: [x.id, y.id] });
    const winsOf = async (entityId: string) => (await repos.journeys.listConversions(r.db, A, { entityId })).items.map((c) => c.id).sort();
    const touchesOf = async (entityId: string) => (await repos.journeys.listTouches(r.db, A, { entityId })).items.map((t) => t.id).sort();
    const itemEntities = async (id: string) => [...((await repos.inbox.get(r.db, A, id)).entityIds as string[])].sort();

    const merged = await repos.entities.merge(r.db, A, x.id, y.id);
    expect(await winsOf(x.id)).toEqual([paid.id, signup.id].sort());
    expect(await winsOf(y.id)).toEqual([]);
    expect(await touchesOf(x.id)).toEqual([own.id, touch.id].sort());
    expect(await itemEntities(onlyY.id)).toEqual([x.id]);
    expect(await itemEntities(both.id)).toEqual([x.id]);

    await repos.entities.unmerge(r.db, A, merged.log.id);
    expect(await winsOf(x.id)).toEqual([paid.id]);
    expect(await winsOf(y.id)).toEqual([signup.id]);
    expect(await touchesOf(x.id)).toEqual([own.id]);
    expect(await touchesOf(y.id)).toEqual([touch.id]);
    expect(await itemEntities(onlyY.id)).toEqual([y.id]);
    expect(await itemEntities(both.id)).toEqual([x.id, y.id].sort());
  });

  it("serializes opposite and repeated merges of one pair: only the first wins, no merge cycle, one merge log (audit #328)", async () => {
    const A = r.A.businessId;
    const a = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Race Org A" });
    const b = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Race Org B" });
    const results = await Promise.allSettled([repos.entities.merge(r.db, A, a.id, b.id), repos.entities.merge(r.db, A, b.id, a.id), repos.entities.merge(r.db, A, a.id, b.id)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    for (const x of results) if (x.status === "rejected") expect(String(x.reason)).toMatch(/already merged/);
    const [ea, eb] = [await repos.entities.get(r.db, A, a.id), await repos.entities.get(r.db, A, b.id)];
    expect([ea.mergedIntoId, eb.mergedIntoId].filter(Boolean)).toHaveLength(1);
    expect((await repos.entities.mergeHistory(r.db, A, a.id)).length).toBe(1);
  });

  it("refuses, with the reason, while a later merge relies on the one being undone; in reverse order both undo exactly", async () => {
    const A = r.A.businessId;
    const x = await repos.entities.create(r.db, A, { kind: "person", displayName: "Rel Kept" });
    const y = await repos.entities.create(r.db, A, { kind: "person", displayName: "Rel Y", aliases: ["Rel"], identifiers: { email: "y@rel.example" } });
    const z = await repos.entities.create(r.db, A, { kind: "person", displayName: "Rel Z", aliases: ["Rel"], identifiers: { email: "z@rel.example" } });
    await repos.entities.upsertRelationship(r.db, A, { fromEntity: y.id, toEntity: ids.meridian!, type: "advises" });
    await repos.entities.upsertRelationship(r.db, A, { fromEntity: z.id, toEntity: ids.meridian!, type: "advises" });
    const xBefore = await repos.entities.get(r.db, A, x.id);
    const first = await repos.entities.merge(r.db, A, x.id, y.id);
    const second = await repos.entities.merge(r.db, A, x.id, z.id);
    // Z's email and its "advises" tie were set aside because Y's were already there, and both carry the name "Rel".
    expect(second.kept.identifiers).toEqual({ email: "y@rel.example" });

    const refused = await repos.entities.unmerge(r.db, A, first.log.id).catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: "merge_relied_on", status: 409 });
    expect((refused as Error).message).toBe("Undo the later merge of “Rel Z” first: it relies on what this merge brought in (the email, the name “Rel” and a relationship both records had).");
    expect((refused as { details: { blockers: { mergeLogId: string }[] } }).details.blockers.map((b) => b.mergeLogId)).toEqual([second.log.id]);
    const history = await repos.entities.mergeHistory(r.db, A, x.id);
    expect(history.map((m) => [m.id, m.undoBlocked])).toEqual([
      [second.log.id, null],
      [first.log.id, (refused as Error).message],
    ]);
    // Nothing changed.
    expect((await repos.entities.get(r.db, A, y.id)).mergedIntoId).toBe(x.id);
    expect((await repos.entities.listRelationships(r.db, A, x.id)).map((rel) => rel.other.id)).toEqual([ids.meridian]);

    await repos.entities.unmerge(r.db, A, second.log.id);
    await repos.entities.unmerge(r.db, A, first.log.id);
    const strip = (e: typeof xBefore) => {
      const { updatedAt: _u, ...rest } = e;
      return rest;
    };
    expect(strip(await repos.entities.get(r.db, A, x.id))).toEqual(strip(xBefore));
    expect((await repos.entities.listRelationships(r.db, A, y.id)).map((rel) => rel.other.id)).toEqual([ids.meridian]);
    expect((await repos.entities.listRelationships(r.db, A, z.id)).map((rel) => rel.other.id)).toEqual([ids.meridian]);
    expect(await repos.entities.listRelationships(r.db, A, x.id)).toHaveLength(0);
  });

  it("refuses to undo a merge into a record that was itself merged away since", async () => {
    const A = r.A.businessId;
    const w = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Umbrella Holdings" });
    const x = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Umbrella" });
    const y = await repos.entities.create(r.db, A, { kind: "organisation", displayName: "Umbrella Ltd" });
    const first = await repos.entities.merge(r.db, A, x.id, y.id);
    const outer = await repos.entities.merge(r.db, A, w.id, x.id);
    await expect(repos.entities.unmerge(r.db, A, first.log.id)).rejects.toThrow("This record was merged into “Umbrella Holdings” afterwards. Undo that merge first.");
    await repos.entities.unmerge(r.db, A, outer.log.id);
    await repos.entities.unmerge(r.db, A, first.log.id);
    expect((await repos.entities.get(r.db, A, y.id)).mergedIntoId).toBeNull();
  });

  it("refuses to merge across businesses or into itself", async () => {
    await expect(repos.entities.merge(r.db, r.A.businessId, ids.sara!, r.B.entityId)).rejects.toThrow(/not found/);
    await expect(repos.entities.merge(r.db, r.A.businessId, ids.sara!, ids.sara!)).rejects.toThrow(/into itself/);
  });
});
