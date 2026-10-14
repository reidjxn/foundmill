/**
 * 0058 (audit FU-S-1): the client roles read `message_threads` and `posts` without the columns the app keeps from the
 * people who can read the row: who muted a thread, and a post's screening verdict, moderator and moderation note. A
 * participant, an author, a moderator and another member all go through Supabase's Data API with a user's own token, so
 * each is exercised here as `authenticated` through the RLS harness (what PostgREST does); the api's own access
 * (service connection) is checked beside them.
 */
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../client";
import { repos } from "../../repos";
import * as s from "../../schema";
import type { PostScreening } from "../../schema";
import { CLIENT_HIDDEN_COLUMNS } from "../../schema";
import { createTestDb, type Runner, type TestHarness } from "../../testing/pglite";
import { postColumns, threadColumns } from "./client-columns";

const DENIED = /permission denied for table/;
const HOLD: PostScreening = { decision: "hold", flags: ["harassment"], rationale: "Harassment.", mode: "mock" };

let h: TestHarness;
let db: Db;
let alice: string;
let bob: string;
let carol: string;
let outsider: string;
let threadId: string;
let communityId: string;
let postId: string;

const rows = async <T>(run: Runner, query: ReturnType<typeof sql>) => run.execute<T & Record<string, unknown>>(query);

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  const user = (name: string) => h.createUser(`${name}@column-grants.test`);
  alice = await user("alice");
  bob = await user("bob");
  carol = await user("carol");
  outsider = await user("outsider");
  // Alice and Bob are connected, so they can talk; Bob muted the thread. The writes go through the repos on the service
  // connection, as the api does them.
  const link = await repos.social.requestConnection(db, alice, bob);
  await repos.social.respondConnection(db, bob, link.id, "accepted");
  const thread = await repos.social.startThread(db, alice, [bob], "Hello");
  threadId = thread.id;
  await repos.social.sendMessage(db, alice, threadId, "Morning");
  await repos.social.setThreadMuted(db, bob, threadId, true);
  // Alice owns a community; Bob and Carol are members; Bob's post is held by the screen, then restored by Alice with a note.
  const community = await repos.social.createCommunity(db, { name: "Column grants", slug: "column-grants", createdBy: alice });
  communityId = community.id;
  await repos.social.joinCommunity(db, bob, communityId);
  await repos.social.joinCommunity(db, carol, communityId);
  const post = await repos.social.createPost(db, { communityId, authorUserId: bob, bodyMd: "A first post", screening: HOLD });
  postId = post.id;
  await repos.social.moderatePost(db, alice, postId, "restore", "Reviewed: fine");
}, 120_000);
afterAll(() => h?.close());

describe("the catalogue", () => {
  it("client roles read the visible columns of message_threads and posts only", async () => {
    // Every column of each table is either granted to authenticated or named in CLIENT_HIDDEN_COLUMNS: a new column forces a choice.
    for (const [table, columns] of [
      [s.messageThreads, CLIENT_HIDDEN_COLUMNS.message_threads],
      [s.posts, CLIENT_HIDDEN_COLUMNS.posts],
    ] as const) {
      const name = getTableName(table);
      const all = Object.values(getTableColumns(table)).map((c) => c.name);
      for (const hidden of columns) expect(all, `${name}.${hidden} is a column`).toContain(hidden);
      const priv = (role: string) =>
        rows<{ column_name: string }>(h.service(), sql`
          select a.attname as column_name from pg_attribute a
           where a.attrelid = ${`public.${name}`}::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege(${role}, a.attrelid, a.attnum, 'SELECT')
           order by a.attname`);
      expect((await priv("authenticated")).map((r) => r.column_name), `${name}: authenticated`).toEqual(all.filter((c) => !(columns as readonly string[]).includes(c)).sort());
      expect(await priv("anon"), `${name}: anon`).toEqual([]);
      expect((await priv("service_role")).map((r) => r.column_name), `${name}: service_role`).toEqual([...all].sort());
      // No table-level SELECT is left for the client roles, or the column grants would mean nothing.
      for (const role of ["authenticated", "anon"]) {
        const [row] = await rows<{ ok: boolean }>(h.service(), sql`select has_table_privilege(${role}, ${`public.${name}`}, 'SELECT') as ok`);
        expect(row!.ok, `${name}: ${role} table-level SELECT`).toBe(false);
      }
    }
  });

  it("the Drizzle column sets the tests select with are the SQL grants", () => {
    expect(Object.values(threadColumns).map((c) => c.name).sort()).toEqual(Object.values(getTableColumns(s.messageThreads)).map((c) => c.name).filter((n) => !CLIENT_HIDDEN_COLUMNS.message_threads.includes(n as never)).sort());
    expect(Object.values(postColumns).map((c) => c.name).sort()).toEqual(Object.values(getTableColumns(s.posts)).map((c) => c.name).filter((n) => !CLIENT_HIDDEN_COLUMNS.posts.includes(n as never)).sort());
  });
});

describe("message_threads: a participant reads the thread, not who muted it", () => {
  it("both participants read the rest of the row", async () => {
    for (const person of [alice, bob]) {
      const [t] = await h.asUser(person).run((tx) => tx.select(threadColumns).from(s.messageThreads));
      expect(t).toMatchObject({ id: threadId, kind: "direct", subject: "Hello", participantIds: expect.arrayContaining([alice, bob]) as string[], leftIds: [] });
      expect(t!.lastMessageAt).toBeInstanceOf(Date);
    }
  });

  it("muted_ids is refused to the participant who muted, the other participant and every other client role; select * too", async () => {
    for (const person of [alice, bob]) {
      const run = h.asUser(person);
      await expect(run.execute(sql`select muted_ids from message_threads`)).rejects.toThrow(DENIED);
      await expect(run.execute(sql`select * from message_threads`)).rejects.toThrow(DENIED);
      await expect(run.execute(sql`select id from message_threads where muted_ids @> array[${bob}::uuid]`)).rejects.toThrow(DENIED);
      await expect(run.run((tx) => tx.select().from(s.messageThreads))).rejects.toThrow(DENIED);
      await expect(run.run((tx) => tx.select({ id: s.messageThreads.id, mutedIds: s.messageThreads.mutedIds }).from(s.messageThreads))).rejects.toThrow(DENIED);
    }
    await expect(h.asUser(outsider).execute(sql`select muted_ids from message_threads`)).rejects.toThrow(DENIED);
    await expect(h.anon().execute(sql`select id from message_threads`)).rejects.toThrow(DENIED);
  });

  it("a person outside the thread still reads nothing of it", async () => {
    expect(await h.asUser(outsider).run((tx) => tx.select(threadColumns).from(s.messageThreads))).toEqual([]);
    expect(await h.asUser(carol).run((tx) => tx.select(threadColumns).from(s.messageThreads))).toEqual([]);
  });

  it("the thread's messages are unaffected (they have no hidden column)", async () => {
    expect((await h.asUser(bob).run((tx) => tx.select().from(s.messages))).map((m) => m.body)).toEqual(["Morning"]);
    expect(await h.asUser(outsider).run((tx) => tx.select().from(s.messages))).toEqual([]);
  });

  it("the api's own access (the service connection and the service role) still reads every column", async () => {
    const viaRepo = await repos.social.getThread(db, alice, threadId);
    expect(viaRepo.mutedIds).toEqual([bob]);
    const viaServiceRole = await h.service().run((tx) => tx.select().from(s.messageThreads));
    expect(viaServiceRole.map((t) => t.mutedIds)).toEqual([[bob]]);
    expect((await repos.social.listThreads(db, bob)).items.map((t) => t.id)).toEqual([threadId]);
    // The unread badge reads muted_ids in SQL: Alice's own message is read; the thread is muted for Bob, so it does not count for him.
    expect(await repos.social.unreadCount(db, alice)).toBe(0);
    expect(await repos.social.unreadCount(db, bob)).toBe(0);
  });
});

describe("posts: members and the author read the post, not the screen's verdict or which moderator acted", () => {
  it("the author, another member, the moderator and an outsider-in-the-community read the rest of the row", async () => {
    for (const person of [bob, carol, alice]) {
      const [p] = await h.asUser(person).run((tx) => tx.select(postColumns).from(s.posts));
      expect(p).toMatchObject({ id: postId, communityId, authorUserId: bob, bodyMd: "A first post", status: "visible" });
      expect(p!.moderatedAt).toBeInstanceOf(Date);
    }
    // A non-member still reads nothing of it.
    expect(await h.asUser(outsider).run((tx) => tx.select(postColumns).from(s.posts))).toEqual([]);
  });

  it("screening, moderated_by and moderation_note are refused to the author, a member and the moderator; select * too", async () => {
    for (const person of [bob, carol, alice]) {
      const run = h.asUser(person);
      for (const column of ["screening", "moderated_by", "moderation_note"]) {
        await expect(run.execute(sql.raw(`select ${column} from posts`)), `${column} as ${person}`).rejects.toThrow(DENIED);
        await expect(run.execute(sql.raw(`select id from posts where ${column} is not null`)), `where ${column}`).rejects.toThrow(DENIED);
      }
      await expect(run.execute(sql`select * from posts`)).rejects.toThrow(DENIED);
      await expect(run.run((tx) => tx.select().from(s.posts))).rejects.toThrow(DENIED);
      await expect(run.run((tx) => tx.select({ id: s.posts.id, by: s.posts.moderatedBy }).from(s.posts))).rejects.toThrow(DENIED);
    }
    await expect(h.asUser(outsider).execute(sql`select moderated_by from posts`)).rejects.toThrow(DENIED);
    await expect(h.anon().execute(sql`select id from posts`)).rejects.toThrow(DENIED);
  });

  it("the author still reads their own held post (the row policy), and still without the hidden columns", async () => {
    const held = await repos.social.createPost(db, { communityId, authorUserId: bob, bodyMd: "Held for review", screening: HOLD });
    expect(held.status).toBe("pending_review");
    const seen = await h.asUser(bob).run((tx) => tx.select(postColumns).from(s.posts));
    expect(seen.map((p) => p.bodyMd).sort()).toEqual(["A first post", "Held for review"]);
    // Carol does not see it, and Alice (a moderator) does.
    expect((await h.asUser(carol).run((tx) => tx.select(postColumns).from(s.posts))).map((p) => p.bodyMd)).toEqual(["A first post"]);
    expect(await h.asUser(alice).run((tx) => tx.select(postColumns).from(s.posts))).toHaveLength(2);
  });

  it("the api's own access still reads every column, and hands each viewer only what they may see", async () => {
    const post = await repos.social.getPost(db, postId);
    expect(post).toMatchObject({ moderatedBy: alice, moderationNote: "Reviewed: fine", screening: HOLD });
    const viaServiceRole = await h.service().run((tx) => tx.select().from(s.posts).where(sql`${s.posts.id} = ${postId}`));
    expect(viaServiceRole[0]).toMatchObject({ moderatedBy: alice, moderationNote: "Reviewed: fine", screening: HOLD });
    expect((await repos.social.listPosts(db, communityId, { viewerId: bob })).items.map((p) => p.id)).toContain(postId);
    // The moderators' queue (the held post from the previous test) carries the screen's verdict.
    expect((await repos.social.moderationQueue(db, communityId)).map((q) => [q.post.bodyMd, q.post.screening])).toEqual([["Held for review", HOLD]]);
  });

  it("writes stay with the api: the client roles still cannot insert, update or delete either table", async () => {
    await expect(h.asUser(bob).execute(sql`update posts set body_md = 'x'`)).rejects.toThrow(DENIED);
    await expect(h.asUser(bob).execute(sql`update message_threads set subject = 'x'`)).rejects.toThrow(DENIED);
    await expect(h.asUser(bob).execute(sql`delete from posts`)).rejects.toThrow(DENIED);
  });
});
