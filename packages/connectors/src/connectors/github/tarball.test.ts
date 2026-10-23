import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readTarGz, TarError, writeTarGz, type TarEntry, type TarReadLimits } from "./tarball";

const LIMITS: TarReadLimits = { maxEntries: 1_000, maxEntryBytes: 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024 };

async function all(archive: Uint8Array, limits: TarReadLimits = LIMITS): Promise<TarEntry[]> {
  const out: TarEntry[] = [];
  for await (const e of readTarGz(archive, limits)) out.push(e);
  return out;
}

describe("tarball", () => {
  it("round-trips files, directories, links and long names, GitHub-style (prefix + pax global comment)", async () => {
    const long = `deep/${"d".repeat(80)}/${"f".repeat(60)}.ts`;
    const archive = writeTarGz(
      [
        { path: "README.md", content: "# Shop\n" },
        { path: "src", type: "directory" },
        { path: "src/index.ts", content: "export {};\n" },
        { path: long, content: "long\n" },
        { path: "empty.txt", content: "" },
        { path: "link", type: "symlink", linkTarget: "/etc/passwd" },
        { path: "hard", type: "hardlink", linkTarget: "README.md" },
      ],
      { prefix: "acme-shop-abc1234/", comment: "abc1234def", mtime: 1_700_000_000 },
    );
    const entries = await all(archive);
    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ["acme-shop-abc1234/", "directory"],
      ["acme-shop-abc1234/README.md", "file"],
      ["acme-shop-abc1234/src/", "directory"],
      ["acme-shop-abc1234/src/index.ts", "file"],
      [`acme-shop-abc1234/${long}`, "file"],
      ["acme-shop-abc1234/empty.txt", "file"],
      ["acme-shop-abc1234/link", "symlink"],
      ["acme-shop-abc1234/hard", "hardlink"],
    ]);
    expect(entries[1]!.content?.toString()).toBe("# Shop\n");
    expect(entries[4]!.content?.toString()).toBe("long\n");
    expect(entries[5]!.content?.length).toBe(0);
    expect(entries[6]).toMatchObject({ linkTarget: "/etc/passwd", content: null });
    // Deterministic: the same input gives the same bytes.
    expect(writeTarGz([{ path: "a", content: "b" }], { mtime: 5 }).equals(writeTarGz([{ path: "a", content: "b" }], { mtime: 5 }))).toBe(true);
  });

  it("never buffers an entry over maxEntryBytes and refuses archives past their limits while reading", async () => {
    const big = writeTarGz([{ path: "big.bin", content: Buffer.alloc(4096, 1) }, { path: "small.txt", content: "s" }]);
    const listed = await all(big, { ...LIMITS, maxEntryBytes: 1024 });
    expect(listed.map((e) => [e.path, e.size, e.content === null])).toEqual([
      ["big.bin", 4096, true],
      ["small.txt", 1, false],
    ]);
    await expect(all(big, { ...LIMITS, maxTotalBytes: 2048 })).rejects.toThrow(/unpacks to more than/);
    const many = writeTarGz(Array.from({ length: 20 }, (_, i) => ({ path: `f${i}`, content: "x" })));
    await expect(all(many, { ...LIMITS, maxEntries: 10 })).rejects.toThrow(/more than 10 entries/);
    // A decompression bomb: 8 MB of zeros compress to a few KB; the read stops at the header that declares them.
    const bomb = writeTarGz([{ path: "zero", content: Buffer.alloc(8 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(all(bomb, { ...LIMITS, maxTotalBytes: 1024 * 1024 })).rejects.toThrow(/unpacks to more than 1 MB/);
  });

  it("refuses corrupt and truncated archives", async () => {
    const good = writeTarGz([{ path: "a.txt", content: "hello" }]);
    const raw = (await import("node:zlib")).gunzipSync(good);
    const corrupt = Buffer.from(raw);
    corrupt[10] = corrupt[10]! ^ 0xff; // inside the name: the checksum no longer matches
    await expect(all(gzipSync(corrupt))).rejects.toBeInstanceOf(TarError);
    await expect(all(gzipSync(raw.subarray(0, 600)))).rejects.toThrow(/ends in the middle/);
    await expect(all(Buffer.from("not gzip"))).rejects.toThrow();
  });
});
