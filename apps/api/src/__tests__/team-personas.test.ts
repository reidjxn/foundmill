/**
 * `team.personas.ensure` (Anthropomorphic agents): a member of the business gets `{ style, ready, pending, failed }` for the
 * persona keys of that business's own agents in their own character style, and generation starts for the missing ones in
 * the background; anonymous callers and people
 * outside the business are refused; one business can never cause, or learn about, another business's faces.
 */
import { repos } from "@foundmill/db";
import { AppError, PERSONAS, characterFor, type AgentStyle } from "@foundmill/shared";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiGatewayClient } from "../services/gateway";
import { portraitsIdle, resetPortraitState } from "../services/personas";
import { createApiHarness, type ApiHarness } from "./harness";

const KEY_A1 = PERSONAS[100]!.key;
const KEY_A2 = PERSONAS[101]!.key;
const KEY_B = PERSONAS[102]!.key;
const IMAGE = { mime: "image/webp" as const, base64: Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1").toString("base64"), model: "test-image-model" };

const asked: { key: string; businessId?: string; style?: string }[] = [];
/** Keys the gateway double refuses for good (as the gateway answers a moderation refusal: 422 portrait_refused). */
const refuse = new Set<string>();
let hz: ApiHarness;

beforeAll(async () => {
  const gateway = {
    connect: async () => {
      throw new Error("unused");
    },
    health: async () => {
      throw new Error("unused");
    },
    createCheckout: async () => {
      throw new Error("unused");
    },
    checkDomains: async () => {
      throw new Error("unused");
    },
    generatePortrait: async (key: string, businessId?: string, style?: AgentStyle) => {
      asked.push({ key, ...(businessId ? { businessId } : {}), ...(style ? { style } : {}) });
      if (refuse.has(key)) throw new AppError("portrait_refused", "The image service refused to make this portrait.", 422);
      return IMAGE;
    },
    repository: async () => {
      throw new Error("unused");
    },
    sendPush: async () => {
      throw new Error("unused");
    },
    validateKey: async () => {
      throw new Error("unused");
    },
    registryLookup: async () => {
      throw new Error("unused");
    },
    confirmFollow: async () => {
      throw new Error("unused");
    },
    notifyEmail: async () => {
      throw new Error("unused");
    },
    synthesizeSpeech: async () => {
      throw new Error("unused");
    },
    transcribeSpeech: async () => {
      throw new Error("unused");
    },
  } satisfies ApiGatewayClient;
  // Live, so the gateway double is the one asked.
  hz = await createApiHarness({ prefix: "team-personas", gateway, env: { LIVE_CONNECTORS: "openai_images" } });
}, 120_000);
afterAll(() => hz.close());

beforeEach(async () => {
  resetPortraitState();
  asked.length = 0;
  refuse.clear();
  await hz.db.execute(sql`delete from persona_portraits`);
  await hz.db.execute(sql`update agents set persona_key = null where business_id in (${hz.A.businessId}::uuid, ${hz.B.businessId}::uuid)`);
  await hz.db.execute(sql`update agents set persona_key = ${KEY_A1} where id = ${hz.A.agentId}::uuid`);
  await hz.db.execute(sql`update agents set persona_key = ${KEY_A2} where id = ${hz.A.agent2Id}::uuid`);
  await hz.db.execute(sql`update agents set persona_key = ${KEY_B} where id = ${hz.B.agentId}::uuid`);
});

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    return { code: err.code, message: err.message };
  }
};

describe("team.personas.ensure", () => {
  it("answers with the business's own keys at once and generates the missing ones in the background", async () => {
    const first = await hz.caller({ userId: hz.A.memberId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
    expect([...first.pending].sort()).toEqual([KEY_A1, KEY_A2].sort());
    expect(first.ready).toEqual([]);
    // Each key's first name in the caller's style, for a client without the character catalog (the mobile app).
    expect(Object.keys(first.names).sort()).toEqual([KEY_A1, KEY_A2].sort());
    for (const key of [KEY_A1, KEY_A2]) expect(first.names[key]).toBe(characterFor(key, first.style)!.name);
    await portraitsIdle();
    expect(asked.map((a) => a.key).sort()).toEqual([KEY_A1, KEY_A2].sort());
    expect(asked.every((a) => a.businessId === hz.A.businessId)).toBe(true);

    const second = await hz.caller({ userId: hz.A.memberId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
    expect([...second.ready].sort()).toEqual([KEY_A1, KEY_A2].sort());
    expect(second.pending).toEqual([]);
    expect(asked).toHaveLength(2);
  });

  it("is open to every role of the business, a viewer included (the faces show in the whole shell)", async () => {
    for (const userId of [hz.A.ownerId, hz.A.adminId, hz.A.memberId, hz.A.viewerId]) {
      const res = await hz.caller({ userId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
      expect(res.ready.length + res.pending.length, userId).toBe(2);
    }
    await portraitsIdle();
  });

  it("refuses an anonymous caller and a user outside the business, and starts nothing", async () => {
    expect(await refusal(hz.caller(null).team.personas.ensure({ businessId: hz.A.businessId }))).toMatchObject({ code: "UNAUTHORIZED" });
    expect(await refusal(hz.caller({ userId: hz.B.ownerId, email: null }).team.personas.ensure({ businessId: hz.A.businessId }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refusal(hz.caller({ userId: hz.A.viewerId, email: null }).team.personas.ensure({ businessId: hz.B.businessId }))).toMatchObject({ code: "FORBIDDEN" });
    await portraitsIdle();
    expect(asked).toEqual([]);
  });

  it("never mixes businesses: each sees and generates only its own agents' keys", async () => {
    const a = await hz.caller({ userId: hz.A.ownerId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
    const b = await hz.caller({ userId: hz.B.ownerId, email: null }).team.personas.ensure({ businessId: hz.B.businessId });
    await portraitsIdle();
    expect([...a.ready, ...a.pending]).not.toContain(KEY_B);
    expect([...b.ready, ...b.pending]).toEqual([KEY_B]);
    expect(asked.filter((x) => x.key === KEY_B).map((x) => x.businessId)).toEqual([hz.B.businessId]);
    expect(asked.filter((x) => x.businessId === hz.A.businessId).map((x) => x.key).sort()).toEqual([KEY_A1, KEY_A2].sort());
  });

  it("a face another business already made is ready here too (it is a platform asset), without a second image", async () => {
    await repos.personaPortraits.put(hz.db, { key: KEY_A1, mime: "image/webp", content: new Uint8Array([1, 2, 3]), model: "earlier" });
    const res = await hz.caller({ userId: hz.A.ownerId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
    expect(res.ready).toEqual([KEY_A1]);
    expect(res.pending).toEqual([KEY_A2]);
    await portraitsIdle();
    expect(asked.map((a) => a.key)).toEqual([KEY_A2]);
  });

  it("a face refused for good moves from pending to failed, so the web stops asking", async () => {
    refuse.add(KEY_A1);
    const first = await hz.caller({ userId: hz.A.memberId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
    expect([...first.pending].sort()).toEqual([KEY_A1, KEY_A2].sort());
    expect(first.failed).toEqual([]);
    await portraitsIdle();
    const second = await hz.caller({ userId: hz.A.memberId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
    expect(second).toEqual({ style: "humans", ready: [KEY_A2], pending: [], failed: [KEY_A1], names: { [KEY_A1]: characterFor(KEY_A1, "humans")!.name, [KEY_A2]: characterFor(KEY_A2, "humans")!.name } });
    await portraitsIdle();
    expect(asked.filter((a) => a.key === KEY_A1)).toHaveLength(1);
  });

  it("agents without a persona key add nothing", async () => {
    await hz.db.execute(sql`update agents set persona_key = null where business_id = ${hz.A.businessId}::uuid`);
    expect(await hz.caller({ userId: hz.A.ownerId, email: null }).team.personas.ensure({ businessId: hz.A.businessId })).toEqual({ style: "humans", ready: [], pending: [], failed: [], names: {} });
    expect(asked).toEqual([]);
  });

  it("0069: answers in the caller's own style, names it, and generates that style; the input cannot name a style", async () => {
    const member = hz.caller({ userId: hz.A.memberId, email: null });
    expect((await member.team.personas.ensure({ businessId: hz.A.businessId })).style).toBe("humans");
    await portraitsIdle();
    expect(asked.map((a) => a.style)).toEqual(["humans", "humans"]);
    asked.length = 0;
    try {
      await repos.preferences.update(hz.db, hz.A.memberId, { anthropomorphicAgents: true, agentStyle: "fantasy" });
      const first = await member.team.personas.ensure({ businessId: hz.A.businessId });
      expect(first.style).toBe("fantasy");
      expect([...first.pending].sort()).toEqual([KEY_A1, KEY_A2].sort());
      expect(first.ready).toEqual([]);
      await portraitsIdle();
      expect(asked.map((a) => a.style)).toEqual(["fantasy", "fantasy"]);
      expect(asked.every((a) => a.businessId === hz.A.businessId)).toBe(true);
      const second = await member.team.personas.ensure({ businessId: hz.A.businessId });
      expect(second.style).toBe("fantasy");
      expect([...second.ready].sort()).toEqual([KEY_A1, KEY_A2].sort());
      // Another member of the same business with another style gets their own answer about the same keys.
      await repos.preferences.update(hz.db, hz.A.viewerId, { agentStyle: "cartoon_2d" });
      const viewer = await hz.caller({ userId: hz.A.viewerId, email: null }).team.personas.ensure({ businessId: hz.A.businessId });
      expect(viewer.style).toBe("cartoon_2d");
      expect([...viewer.pending].sort()).toEqual([KEY_A1, KEY_A2].sort());
      await portraitsIdle();
      expect(asked.filter((a) => a.style === "cartoon_2d")).toHaveLength(2);
      // The humans faces are still there for whoever has not chosen.
      expect((await hz.caller({ userId: hz.A.ownerId, email: null }).team.personas.ensure({ businessId: hz.A.businessId })).ready.length).toBe(2);
      // A style in the input is ignored (the business input drops unknown keys): the style is the caller's preference, never a parameter.
      asked.length = 0;
      const forced = await member.team.personas.ensure({ businessId: hz.A.businessId, style: "cartoon_3d" } as never);
      expect(forced.style).toBe("fantasy");
      expect([...forced.ready].sort()).toEqual([KEY_A1, KEY_A2].sort());
      await portraitsIdle();
      expect(asked).toEqual([]);
    } finally {
      await repos.preferences.update(hz.db, hz.A.memberId, { anthropomorphicAgents: false, agentStyle: "humans" });
      await repos.preferences.update(hz.db, hz.A.viewerId, { agentStyle: "humans" });
    }
  });
});
