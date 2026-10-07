import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fromBase64, toBase64 } from "./encoding";
import {
  buildAad,
  createVault,
  DATA_KEY_BYTES,
  decryptJson,
  decryptText,
  ENVELOPE_ALG,
  encryptedRecordFromBytes,
  encryptedRecordToBytes,
  encryptJson,
  generateMasterKey,
  KMS_ENCRYPTION_CONTEXT_KEY,
  KmsVault,
  LocalVault,
  MASTER_KEY_BYTES,
  PAYLOAD_NONCE_BYTES,
  PAYLOAD_TAG_BYTES,
  parseEncryptedRecord,
  redactSecret,
  VaultError,
  type EncryptedRecord,
  type KmsClientLike,
  type Vault,
} from "./index";

const AAD = buildAad("0a2a9b6e-7c1f-4a7a-9c1e-0d8e9f1a2b3c", "credentials", "8f4b1a2c-1111-4222-8333-444455556666");
const OTHER_AAD = buildAad("0a2a9b6e-7c1f-4a7a-9c1e-0d8e9f1a2b3c", "credentials", "ffffffff-1111-4222-8333-444455556666");
const SECRET = "sk-ant-api03-this-is-a-fake-key-for-tests-0123456789";

/** Flips one byte of a base64 field and re-encodes it (so the record still parses). */
function tamper(field: string, index = 3): string {
  const bytes = fromBase64(field);
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return toBase64(bytes);
}

async function expectVaultError(p: Promise<unknown>, code: VaultError["code"]): Promise<VaultError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(VaultError);
  expect((err as VaultError).code).toBe(code);
  return err as VaultError;
}

/** The behaviour every vault must share; run for the local vault and the KMS vault with a fake client. */
function describeVaultContract(name: string, makeVault: () => Vault) {
  describe(`${name}: vault contract`, () => {
    it("round-trips strings and bytes", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      expect(record.alg).toBe(ENVELOPE_ALG);
      expect(new TextDecoder().decode(await vault.decrypt(record, AAD))).toBe(SECRET);

      const bytes = new Uint8Array([0, 1, 2, 255, 254, 253, 0]);
      const binary = await vault.encrypt(bytes, AAD);
      expect(Array.from(await vault.decrypt(binary, AAD))).toEqual(Array.from(bytes));
    });

    it("round-trips an empty plaintext and a large one", async () => {
      const vault = makeVault();
      const empty = await vault.encrypt("", AAD);
      expect((await vault.decrypt(empty, AAD)).byteLength).toBe(0);
      const big = "x".repeat(200_000);
      expect(new TextDecoder().decode(await vault.decrypt(await vault.encrypt(big, AAD), AAD))).toBe(big);
    });

    it("produces a self-describing record that parses and maps onto the credentials columns", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      expect(parseEncryptedRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
      const sealed = fromBase64(record.ciphertext);
      expect(sealed.byteLength).toBe(PAYLOAD_NONCE_BYTES + new TextEncoder().encode(SECRET).byteLength + PAYLOAD_TAG_BYTES);
      // Local records carry the configured id verbatim; KMS records carry the ARN KMS resolved the alias to.
      if (vault.kind === "local") expect(record.kmsKeyId).toBe(vault.kmsKeyId);
      else expect(record.kmsKeyId).toMatch(/^arn:aws:kms:/);
      const columns = encryptedRecordToBytes(record);
      expect(columns.nonce).toBeNull();
      expect(encryptedRecordFromBytes(columns)).toEqual(record);
    });

    it("never writes the plaintext into the record", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      const everything = JSON.stringify(record) + Buffer.from(record.ciphertext, "base64").toString("latin1") + Buffer.from(record.dataKeyCiphertext, "base64").toString("latin1");
      expect(everything).not.toContain(SECRET);
      expect(everything).not.toContain("sk-ant");
    });

    it("fails with the wrong AAD", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      await expectVaultError(vault.decrypt(record, OTHER_AAD), "decrypt_failed");
      await expectVaultError(vault.decrypt(record, `${AAD} `), "decrypt_failed");
    });

    it("fails when the ciphertext, tag or nonce is tampered with", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      const ct = fromBase64(record.ciphertext);
      const lastIndex = ct.byteLength - 1; // inside the tag
      const bodyIndex = PAYLOAD_NONCE_BYTES + 2; // inside the ciphertext body
      for (const index of [0, bodyIndex, lastIndex]) {
        await expectVaultError(vault.decrypt({ ...record, ciphertext: tamper(record.ciphertext, index) }, AAD), "decrypt_failed");
      }
      // Truncation and extension also fail.
      await expectVaultError(vault.decrypt({ ...record, ciphertext: toBase64(ct.subarray(0, ct.byteLength - 1)) }, AAD), "decrypt_failed");
      await expectVaultError(vault.decrypt({ ...record, ciphertext: toBase64(new Uint8Array([...ct, 0])) }, AAD), "decrypt_failed");
      await expectVaultError(vault.decrypt({ ...record, ciphertext: toBase64(new Uint8Array(5)) }, AAD), "decrypt_failed");
    });

    it("fails when the wrapped data key is tampered with", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      await expectVaultError(vault.decrypt({ ...record, dataKeyCiphertext: tamper(record.dataKeyCiphertext, 30) }, AAD), "decrypt_failed");
    });

    it("uses a different data key, nonce and ciphertext for every record, even for the same plaintext and AAD", async () => {
      const vault = makeVault();
      const a = await vault.encrypt(SECRET, AAD);
      const b = await vault.encrypt(SECRET, AAD);
      expect(a.dataKeyCiphertext).not.toBe(b.dataKeyCiphertext);
      expect(a.ciphertext).not.toBe(b.ciphertext);
      expect(toBase64(fromBase64(a.ciphertext).subarray(0, PAYLOAD_NONCE_BYTES))).not.toBe(toBase64(fromBase64(b.ciphertext).subarray(0, PAYLOAD_NONCE_BYTES)));
      // A data key from one record does not open another: swapping them must fail.
      await expectVaultError(vault.decrypt({ ...a, dataKeyCiphertext: b.dataKeyCiphertext }, AAD), "decrypt_failed");
    });

    it("rotateDataKey keeps the plaintext and AAD but changes every ciphertext field", async () => {
      const vault = makeVault();
      const original = await vault.encrypt(SECRET, AAD);
      const rotated = await vault.rotateDataKey(original, AAD);
      expect(rotated.dataKeyCiphertext).not.toBe(original.dataKeyCiphertext);
      expect(rotated.ciphertext).not.toBe(original.ciphertext);
      expect(rotated.alg).toBe(ENVELOPE_ALG);
      expect(new TextDecoder().decode(await vault.decrypt(rotated, AAD))).toBe(SECRET);
      expect(new TextDecoder().decode(await vault.decrypt(original, AAD))).toBe(SECRET); // old record still valid until overwritten
      await expectVaultError(vault.decrypt(rotated, OTHER_AAD), "decrypt_failed");
      await expectVaultError(vault.rotateDataKey(original, OTHER_AAD), "decrypt_failed");
    });

    it("rejects malformed records and bad AADs without touching key material", async () => {
      const vault = makeVault();
      const record = await vault.encrypt(SECRET, AAD);
      await expectVaultError(vault.decrypt({ ...record, alg: "aes-gcm" as never }, AAD), "invalid_record");
      await expectVaultError(vault.decrypt({ ...record, ciphertext: "not base64!" }, AAD), "invalid_record");
      await expectVaultError(vault.decrypt({ ...record, kmsKeyId: "" }, AAD), "invalid_record");
      await expectVaultError(vault.encrypt(SECRET, ""), "invalid_aad");
      await expectVaultError(vault.encrypt(SECRET, "bad\naad"), "invalid_aad");
    });

    it("encryptJson/decryptJson validate against a schema; decryptText returns a string", async () => {
      const vault = makeVault();
      const Schema = z.object({ apiKey: z.string(), scopes: z.array(z.string()) });
      const record = await encryptJson(vault, { apiKey: SECRET, scopes: ["a", "b"] }, AAD);
      expect(await decryptJson(vault, record, AAD, Schema)).toEqual({ apiKey: SECRET, scopes: ["a", "b"] });
      expect(await decryptJson(vault, record, AAD)).toEqual({ apiKey: SECRET, scopes: ["a", "b"] });
      await expectVaultError(decryptJson(vault, record, AAD, z.object({ nope: z.number() })), "invalid_record");
      await expectVaultError(decryptJson(vault, record, OTHER_AAD, Schema), "decrypt_failed");
      const text = await vault.encrypt("plain-token", AAD);
      expect(await decryptText(vault, text, AAD)).toBe("plain-token");
      await expectVaultError(decryptJson(vault, text, AAD), "invalid_record");
    });
  });
}

// ---------------------------------------------------------------------------------------------------------
// LocalVault (libsodium)
// ---------------------------------------------------------------------------------------------------------

const MASTER_KEY = generateMasterKey();
describeVaultContract("LocalVault", () => new LocalVault(MASTER_KEY));

describe("LocalVault", () => {
  it("generateMasterKey returns base64 of 32 random bytes", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const key = generateMasterKey();
      expect(key).toHaveLength(44);
      expect(key.endsWith("=")).toBe(true);
      expect(fromBase64(key).byteLength).toBe(MASTER_KEY_BYTES);
      keys.add(key);
    }
    expect(keys.size).toBe(20);
    expect(MASTER_KEY_BYTES).toBe(DATA_KEY_BYTES);
  });

  it("rejects a missing, non-base64 or wrong-length master key with a config error", () => {
    expect(() => new LocalVault("")).toThrowError(VaultError);
    expect(() => new LocalVault("***not base64***")).toThrowError(/base64/);
    expect(() => new LocalVault(toBase64(new Uint8Array(16)))).toThrowError(/32 bytes/);
    try {
      new LocalVault(toBase64(new Uint8Array(31)));
      expect.unreachable();
    } catch (e) {
      expect((e as VaultError).code).toBe("config");
    }
  });

  it("key id is local:<fingerprint>, stable per master key and different across keys", async () => {
    const a = new LocalVault(MASTER_KEY);
    const b = new LocalVault(MASTER_KEY);
    const c = new LocalVault(generateMasterKey());
    expect(await a.ready()).toMatch(/^local:[0-9a-f]{16}$/);
    expect(await a.ready()).toBe(await b.ready());
    expect(await c.ready()).not.toBe(await a.ready());
    expect(a.kmsKeyId).toBe(await a.ready());
    // The fingerprint is not the key: it must not be invertible to the key material.
    expect(MASTER_KEY).not.toContain(a.kmsKeyId.slice("local:".length));
  });

  it("a record encrypted under another master key is reported as invalid_record, and under a forged key id as decrypt_failed", async () => {
    const a = new LocalVault(MASTER_KEY);
    const b = new LocalVault(generateMasterKey());
    const record = await a.encrypt(SECRET, AAD);
    const err = await expectVaultError(b.decrypt(record, AAD), "invalid_record");
    expect(err.message).toContain(record.kmsKeyId);
    expect(err.message).not.toContain(SECRET);
    // Forging the key id gets past the id check but the unwrap authenticates with the master key.
    await expectVaultError(b.decrypt({ ...record, kmsKeyId: await b.ready() }, AAD), "decrypt_failed");
  });

  it("wraps the data key as nonce || secretbox and zeroises buffers it owns", async () => {
    const vault = new LocalVault(MASTER_KEY);
    const record = await vault.encrypt(SECRET, AAD);
    expect(fromBase64(record.dataKeyCiphertext).byteLength).toBe(24 + 32 + 16);

    // Plaintext handed over as bytes is left intact (the caller owns it)...
    const owned = new TextEncoder().encode(SECRET);
    await vault.encrypt(owned, AAD);
    expect(new TextDecoder().decode(owned)).toBe(SECRET);
    // ...but the decrypted buffer that rotateDataKey allocates is wiped after use.
    const decryptSpy = vi.spyOn(vault, "decrypt");
    await vault.rotateDataKey(record, AAD);
    const buffer = await decryptSpy.mock.results[0]!.value;
    expect(Array.from(buffer as Uint8Array).every((b) => b === 0)).toBe(true);
    decryptSpy.mockRestore();
  });

  it("destroy() wipes the master key and the vault refuses further use", async () => {
    const vault = new LocalVault(MASTER_KEY);
    const record = await vault.encrypt(SECRET, AAD);
    vault.destroy();
    await expectVaultError(vault.encrypt(SECRET, AAD), "config");
    await expectVaultError(vault.decrypt(record, AAD), "config");
  });

  it("records survive a JSON round trip and are independent of each other", async () => {
    const vault = new LocalVault(MASTER_KEY);
    const records = await Promise.all(Array.from({ length: 25 }, (_, i) => vault.encrypt(`secret-${i}`, buildAad("biz", String(i)))));
    expect(new Set(records.map((r) => r.dataKeyCiphertext)).size).toBe(25);
    for (const [i, r] of records.entries()) {
      const again = parseEncryptedRecord(JSON.parse(JSON.stringify(r)));
      expect(new TextDecoder().decode(await vault.decrypt(again, buildAad("biz", String(i))))).toBe(`secret-${i}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
// KmsVault with a fake KMS client
// ---------------------------------------------------------------------------------------------------------

const KMS_KEY_ARN = "arn:aws:kms:eu-north-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab";

/**
 * A fake KMS that behaves like the real one for our purposes: GenerateDataKey returns a random 32-byte key
 * plus a "wrapped" blob (key XOR a per-fake pad, with the encryption context hashed in), and Decrypt only
 * unwraps when the blob is intact and the context matches, else throws `InvalidCiphertextException`.
 */
function fakeKms(options: { keyId?: string; fail?: "generate" | "decrypt" } = {}) {
  const keyId = options.keyId ?? KMS_KEY_ARN;
  const pad = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const contextTag = (ctx: Record<string, string> | undefined) => {
    const text = JSON.stringify(ctx ?? {});
    const out = new Uint8Array(8);
    for (let i = 0; i < text.length; i++) out[i % 8] = (out[i % 8]! * 31 + text.charCodeAt(i)) & 0xff;
    return out;
  };
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  const client = {
    send: vi.fn(async (command: GenerateDataKeyCommand | DecryptCommand) => {
      calls.push({ command: command.constructor.name, input: command.input as Record<string, unknown> });
      if (command instanceof GenerateDataKeyCommand) {
        if (options.fail === "generate") throw Object.assign(new Error("not authorized"), { name: "AccessDeniedException" });
        const plain = globalThis.crypto.getRandomValues(new Uint8Array(32));
        const blob = new Uint8Array(40);
        for (let i = 0; i < 32; i++) blob[i] = plain[i]! ^ pad[i]!;
        blob.set(contextTag(command.input.EncryptionContext), 32);
        return { Plaintext: plain, CiphertextBlob: blob, KeyId: keyId };
      }
      if (command instanceof DecryptCommand) {
        if (options.fail === "decrypt") throw Object.assign(new Error("key disabled"), { name: "DisabledException" });
        const blob = command.input.CiphertextBlob!;
        const tag = contextTag(command.input.EncryptionContext);
        if (blob.byteLength !== 40 || !blob.subarray(32).every((b, i) => b === tag[i])) {
          throw Object.assign(new Error("ciphertext refers to a customer master key that does not exist"), { name: "InvalidCiphertextException" });
        }
        const plain = new Uint8Array(32);
        for (let i = 0; i < 32; i++) plain[i] = blob[i]! ^ pad[i]!;
        return { Plaintext: plain, KeyId: keyId };
      }
      throw new Error("unexpected command");
    }),
  };
  return { client: client as unknown as KmsClientLike, calls, keyId };
}

const sharedFake = fakeKms();
describeVaultContract("KmsVault", () => new KmsVault("alias/foundmill-staging", { client: sharedFake.client }));

describe("KmsVault", () => {
  it("accepts a real KMSClient structurally (compile-time) and rejects a missing client or key id", () => {
    const client: KmsClientLike = new KMSClient({ region: "eu-north-1" });
    expect(typeof client.send).toBe("function");
    expect(() => new KmsVault("", { client })).toThrowError(VaultError);
    expect(() => new KmsVault("alias/x", { client: undefined as never })).toThrowError(/KMS client/);
  });

  it("calls GenerateDataKey with KeySpec AES_256 and the AAD as encryption context, then stores the returned key ARN", async () => {
    const fake = fakeKms();
    const vault = new KmsVault("alias/foundmill-staging", { client: fake.client });
    const record = await vault.encrypt(SECRET, AAD);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      command: "GenerateDataKeyCommand",
      input: { KeyId: "alias/foundmill-staging", KeySpec: "AES_256", EncryptionContext: { [KMS_ENCRYPTION_CONTEXT_KEY]: AAD } },
    });
    expect(record.kmsKeyId).toBe(KMS_KEY_ARN); // the ARN KMS resolved the alias to, not the alias
    expect(record.alg).toBe(ENVELOPE_ALG);
    expect(fromBase64(record.dataKeyCiphertext).byteLength).toBe(40); // the wrapped blob is stored verbatim
  });

  it("calls Decrypt with the stored blob, key id and encryption context, and never sends the payload to KMS", async () => {
    const fake = fakeKms();
    const vault = new KmsVault("alias/foundmill-staging", { client: fake.client });
    const record = await vault.encrypt(SECRET, AAD);
    fake.calls.length = 0;
    expect(new TextDecoder().decode(await vault.decrypt(record, AAD))).toBe(SECRET);
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.command).toBe("DecryptCommand");
    expect(call.input.KeyId).toBe(KMS_KEY_ARN);
    expect(call.input.EncryptionContext).toEqual({ [KMS_ENCRYPTION_CONTEXT_KEY]: AAD });
    expect(toBase64(call.input.CiphertextBlob as Uint8Array)).toBe(record.dataKeyCiphertext);
    expect(JSON.stringify(call.input)).not.toContain(record.ciphertext);
  });

  it("maps InvalidCiphertextException to decrypt_failed and other KMS errors to kms_failed", async () => {
    const fake = fakeKms();
    const vault = new KmsVault("alias/foundmill-staging", { client: fake.client });
    const record = await vault.encrypt(SECRET, AAD);
    // KMS itself refuses the wrong encryption context (wrong AAD) before the payload is even looked at.
    await expectVaultError(vault.decrypt(record, OTHER_AAD), "decrypt_failed");

    const down = new KmsVault("alias/foundmill-staging", { client: fakeKms({ fail: "decrypt" }).client });
    const err = await expectVaultError(down.decrypt(record, AAD), "kms_failed");
    expect(err.message).toContain("DisabledException");
    expect(err.details).toEqual({ operation: "Decrypt", name: "DisabledException" });

    const denied = new KmsVault("alias/foundmill-staging", { client: fakeKms({ fail: "generate" }).client });
    const err2 = await expectVaultError(denied.encrypt(SECRET, AAD), "kms_failed");
    expect(err2.message).toContain("AccessDeniedException");
    expect(err2.message).not.toContain(SECRET);
  });

  it("rejects a data key of the wrong size or a response without key material", async () => {
    const short: KmsClientLike = { send: vi.fn(async () => ({ Plaintext: new Uint8Array(16), CiphertextBlob: new Uint8Array(40), KeyId: KMS_KEY_ARN })) } as unknown as KmsClientLike;
    await expectVaultError(new KmsVault("alias/x", { client: short }).encrypt(SECRET, AAD), "kms_failed");
    const empty: KmsClientLike = { send: vi.fn(async () => ({ KeyId: KMS_KEY_ARN })) } as unknown as KmsClientLike;
    await expectVaultError(new KmsVault("alias/x", { client: empty }).encrypt(SECRET, AAD), "kms_failed");
    const fake = fakeKms();
    const record = await new KmsVault("alias/x", { client: fake.client }).encrypt(SECRET, AAD);
    await expectVaultError(new KmsVault("alias/x", { client: empty }).decrypt(record, AAD), "kms_failed");
  });

  it("a record from a different vault kind cannot be opened by the other", async () => {
    const local = new LocalVault(MASTER_KEY);
    const kms = new KmsVault("alias/x", { client: fakeKms().client });
    const fromLocal = await local.encrypt(SECRET, AAD);
    const fromKms = await kms.encrypt(SECRET, AAD);
    await expectVaultError(local.decrypt(fromKms, AAD), "invalid_record");
    await expectVaultError(kms.decrypt(fromLocal, AAD), "decrypt_failed");
  });
});

// ---------------------------------------------------------------------------------------------------------
// createVault, buildAad, redactSecret
// ---------------------------------------------------------------------------------------------------------

describe("createVault", () => {
  it("prefers KMS when KMS_KEY_ID is set, even if DEV_MASTER_KEY is also set", async () => {
    const fake = fakeKms();
    const vault = createVault({ KMS_KEY_ID: " alias/foundmill ", DEV_MASTER_KEY: MASTER_KEY, APP_ENV: "production" }, { kmsClient: fake.client });
    expect(vault).toBeInstanceOf(KmsVault);
    expect(vault.kind).toBe("kms");
    expect(vault.kmsKeyId).toBe("alias/foundmill");
    const record = await vault.encrypt(SECRET, AAD);
    expect(new TextDecoder().decode(await vault.decrypt(record, AAD))).toBe(SECRET);
  });

  it("builds a LocalVault from DEV_MASTER_KEY in development, test and staging", async () => {
    for (const APP_ENV of ["development", "test", "staging", undefined] as const) {
      const vault = createVault({ DEV_MASTER_KEY: MASTER_KEY, APP_ENV });
      expect(vault).toBeInstanceOf(LocalVault);
      expect(vault.kind).toBe("local");
    }
    const vault = createVault({ DEV_MASTER_KEY: MASTER_KEY, KMS_KEY_ID: "   " });
    expect(vault.kind).toBe("local");
    expect(await (vault as LocalVault).ready()).toMatch(/^local:/);
  });

  it("refuses a dev master key in production and explains what to set when nothing is configured", () => {
    expect(() => createVault({ DEV_MASTER_KEY: MASTER_KEY, APP_ENV: "production" })).toThrowError(/KMS_KEY_ID/);
    const err = (() => {
      try {
        createVault({});
      } catch (e) {
        return e as VaultError;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(VaultError);
    expect(err!.code).toBe("config");
    expect(err!.message).toMatch(/KMS_KEY_ID/);
    expect(err!.message).toMatch(/DEV_MASTER_KEY/);
    expect(err!.message).toMatch(/generateMasterKey/);
    expect(() => createVault({ DEV_MASTER_KEY: "short" })).toThrowError(VaultError);
  });

  it("constructs a real KMSClient when none is injected (no network until a call is made)", () => {
    const vault = createVault({ KMS_KEY_ID: KMS_KEY_ARN, AWS_REGION: "eu-north-1" });
    expect(vault).toBeInstanceOf(KmsVault);
  });
});

describe("buildAad", () => {
  it("joins parts with ':' and rejects empty parts, parts containing ':' and control characters", () => {
    expect(buildAad("biz-1", "credentials", "row-9")).toBe("biz-1:credentials:row-9");
    expect(() => buildAad()).toThrowError(VaultError);
    expect(() => buildAad("biz", "")).toThrowError(/non-empty/);
    expect(() => buildAad("a:b", "c")).toThrowError(/':'/);
    expect(() => buildAad("a\u0000b")).toThrowError(/control/);
    // Different part lists never produce the same AAD.
    expect(buildAad("ab", "c")).not.toBe(buildAad("a", "bc"));
  });
});

describe("redactSecret", () => {
  it("keeps the first four characters and hides the rest", () => {
    expect(redactSecret("sk-ant-api03-abcdefghijklmnop")).toBe("sk-a***");
    expect(redactSecret("12345678")).toBe("1234***");
    expect(redactSecret("1234567")).toBe("***");
    expect(redactSecret("")).toBe("***");
    expect(redactSecret(undefined)).toBe("***");
    expect(redactSecret(null)).toBe("***");
    expect(redactSecret(12345678)).toBe("***");
    const redacted = redactSecret(SECRET);
    expect(SECRET.startsWith(redacted.slice(0, 4))).toBe(true);
    expect(redacted).not.toContain(SECRET.slice(4));
  });
});

describe("EncryptedRecord type", () => {
  it("is exactly the four fields the credentials table stores", async () => {
    const vault = new LocalVault(MASTER_KEY);
    const record: EncryptedRecord = await vault.encrypt("x", AAD);
    expect(Object.keys(record).sort()).toEqual(["alg", "ciphertext", "dataKeyCiphertext", "kmsKeyId"]);
  });
});
