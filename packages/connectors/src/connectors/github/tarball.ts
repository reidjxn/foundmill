/**
 * gzip-compressed tar archives, as GitHub's tarball endpoint serves a repository (`GET /repos/{o}/{r}/tarball/{ref}`):
 * one top-level directory (`owner-repo-<sha>/`), a pax global header carrying the commit, pax extended headers for
 * long names. `writeTarGz` builds one (the mock's `download_archive`, tests); `readTarGz` reads one as a stream, one
 * entry at a time, with its limits applied while reading, so a decompression bomb or a huge entry is refused before it
 * is held in memory. Reading never touches the file system: what to write, and where, is the caller's decision.
 */
import { Readable } from "node:stream";
import { createGunzip, gzipSync } from "node:zlib";

const BLOCK = 512;

export type TarEntryType = "file" | "directory" | "symlink" | "hardlink" | "other";

export interface TarEntry {
  /** The entry's name as the archive gives it (a pax `path` or GNU long name wins over the header's). Never trusted. */
  path: string;
  type: TarEntryType;
  /** Bytes of content the archive declares. */
  size: number;
  mode: number;
  /** A link's target as the archive gives it. */
  linkTarget: string | null;
  /** The content of a regular file no larger than `maxEntryBytes`; null for anything else (the bytes are skipped). */
  content: Buffer | null;
}

export interface TarReadLimits {
  /** Entries of any kind (directories, links and headers' own entries included). */
  maxEntries: number;
  /** A regular file larger than this is listed with `content: null` and its bytes skipped, never buffered. */
  maxEntryBytes: number;
  /** Every byte the archive declares, together (decompressed): past it the read fails. */
  maxTotalBytes: number;
}

export class TarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarError";
  }
}

/** Pulls exactly `n` bytes at a time out of a chunked stream. */
class ByteReader {
  private chunks: Buffer[] = [];
  private length = 0;
  private done = false;
  constructor(private readonly source: AsyncIterator<Uint8Array>) {}

  private async fill(n: number): Promise<boolean> {
    while (this.length < n && !this.done) {
      const next = await this.source.next();
      if (next.done) this.done = true;
      else {
        const b = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        if (b.length > 0) {
          this.chunks.push(b);
          this.length += b.length;
        }
      }
    }
    return this.length >= n;
  }

  /** Exactly `n` bytes, or null at the end of the stream (a partial read at the end is an error). */
  async read(n: number): Promise<Buffer | null> {
    if (!(await this.fill(n))) {
      if (this.length === 0) return null;
      throw new TarError("the archive ends in the middle of an entry");
    }
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const c = this.chunks[0]!;
      const take = Math.min(c.length, n - at);
      c.copy(out, at, 0, take);
      at += take;
      if (take === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(take);
    }
    this.length -= n;
    return out;
  }

  async skip(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (!(await this.fill(1))) throw new TarError("the archive ends in the middle of an entry");
      const c = this.chunks[0]!;
      if (c.length <= left) {
        this.chunks.shift();
        this.length -= c.length;
        left -= c.length;
      } else {
        this.chunks[0] = c.subarray(left);
        this.length -= left;
        left = 0;
      }
    }
  }
}

const padded = (size: number) => Math.ceil(size / BLOCK) * BLOCK;

/** A NUL-terminated header string. */
function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

/** A numeric header field: octal text, or GNU base-256 when the high bit of its first byte is set. */
function numeric(header: Buffer, start: number, length: number): number {
  const raw = header.subarray(start, start + length);
  if (raw[0]! & 0x80) {
    let n = raw[0]! & 0x7f;
    for (let i = 1; i < raw.length; i++) n = n * 256 + raw[i]!;
    if (!Number.isSafeInteger(n)) throw new TarError("an entry declares an impossible size");
    return n;
  }
  const text = raw.toString("latin1").replace(/[\0 ]+$/g, "").trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarError("an entry header is not a tar header");
  return Number.parseInt(text, 8);
}

function checksumOk(header: Buffer): boolean {
  const stored = numeric(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum === stored;
}

/** `length key=value\n` records of a pax header. */
function paxRecords(data: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) break;
    const len = Number.parseInt(data.subarray(at, space).toString("latin1"), 10);
    if (!Number.isSafeInteger(len) || len <= 0 || at + len > data.length) throw new TarError("a pax header is malformed");
    const record = data.subarray(space + 1, at + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    at += len;
  }
  return out;
}

const TYPES: Record<string, TarEntryType> = { "0": "file", "\0": "file", "7": "file", "5": "directory", "2": "symlink", "1": "hardlink" };

/** Entries of an uncompressed tar stream, in archive order, with `limits` applied while reading. */
export async function* readTar(source: AsyncIterable<Uint8Array>, limits: TarReadLimits): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(source[Symbol.asyncIterator]());
  let entries = 0;
  let total = 0;
  let pax: Map<string, string> | null = null;
  let longName: string | null = null;
  let longLink: string | null = null;
  const account = (size: number) => {
    total += size;
    if (total > limits.maxTotalBytes) throw new TarError(`the archive unpacks to more than ${Math.round(limits.maxTotalBytes / (1024 * 1024))} MB`);
  };
  for (;;) {
    const header = await reader.read(BLOCK);
    if (header === null) return;
    // A zero block ends the archive (a second one usually follows; nothing after it is read).
    if (header.every((b) => b === 0)) return;
    if (!checksumOk(header)) throw new TarError("an entry header has a bad checksum");
    entries++;
    if (entries > limits.maxEntries) throw new TarError(`the archive has more than ${limits.maxEntries} entries`);
    const size = numeric(header, 124, 12);
    const flag = String.fromCharCode(header[156]!);
    account(size);
    // Headers that describe the next entry (or the archive): read, never yielded.
    if (flag === "x" || flag === "g" || flag === "L" || flag === "K") {
      if (size > 1024 * 1024) throw new TarError("an extended header is too large");
      const data = (await reader.read(padded(size)))?.subarray(0, size);
      if (!data) throw new TarError("the archive ends in the middle of an entry");
      if (flag === "x") pax = paxRecords(data);
      else if (flag === "L") longName = field(data, 0, data.length);
      else if (flag === "K") longLink = field(data, 0, data.length);
      continue;
    }
    const ustar = field(header, 257, 6).startsWith("ustar");
    const prefix = ustar ? field(header, 345, 155) : "";
    const name = field(header, 0, 100);
    const path = pax?.get("path") ?? longName ?? (prefix ? `${prefix}/${name}` : name);
    const linkTarget = pax?.get("linkpath") ?? longLink ?? (field(header, 157, 100) || null);
    const paxSize = pax?.get("size");
    const realSize = paxSize !== undefined && /^\d+$/.test(paxSize) ? Number(paxSize) : size;
    if (realSize !== size) account(realSize - size);
    pax = null;
    longName = null;
    longLink = null;
    const type = TYPES[flag] ?? "other";
    const mode = numeric(header, 100, 8);
    // Links and directories carry no content in a well-formed archive; whatever they declare is skipped.
    if (type === "file" && realSize <= limits.maxEntryBytes) {
      const block = await reader.read(padded(realSize));
      if (realSize > 0 && !block) throw new TarError("the archive ends in the middle of an entry");
      yield { path, type, size: realSize, mode, linkTarget: null, content: block ? block.subarray(0, realSize) : Buffer.alloc(0) };
    } else {
      await reader.skip(padded(realSize));
      yield { path, type, size: realSize, mode, linkTarget: type === "symlink" || type === "hardlink" ? linkTarget : null, content: null };
    }
  }
}

/** Entries of a gzip-compressed tar archive held in memory (decompressed as it is read; stopped when the reader stops). */
export async function* readTarGz(archive: Uint8Array, limits: TarReadLimits): AsyncGenerator<TarEntry> {
  const gunzip = createGunzip();
  const stream = Readable.from([Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength)]).pipe(gunzip);
  try {
    yield* readTar(stream, limits);
  } finally {
    stream.destroy();
  }
}

export interface TarWriteEntry {
  path: string;
  type?: "file" | "directory" | "symlink" | "hardlink";
  content?: string | Uint8Array;
  linkTarget?: string;
  mode?: number;
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function headerBlock(entry: { name: string; size: number; mode: number; flag: string; linkTarget?: string; mtime: number }): Buffer {
  const h = Buffer.alloc(BLOCK);
  h.write(entry.name, 0, 100, "utf8");
  h.write(octal(entry.mode, 8), 100, 8, "latin1");
  h.write(octal(0, 8), 108, 8, "latin1");
  h.write(octal(0, 8), 116, 8, "latin1");
  h.write(octal(entry.size, 12), 124, 12, "latin1");
  h.write(octal(entry.mtime, 12), 136, 12, "latin1");
  h.write("        ", 148, 8, "latin1");
  h.write(entry.flag, 156, 1, "latin1");
  if (entry.linkTarget) h.write(entry.linkTarget, 157, 100, "utf8");
  h.write("ustar\0", 257, 6, "latin1");
  h.write("00", 263, 2, "latin1");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i]!;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "latin1");
  return h;
}

function paxBlock(records: Record<string, string>, mtime: number, flag: "x" | "g"): Buffer[] {
  const lines = Object.entries(records).map(([k, v]) => {
    const body = ` ${k}=${v}\n`;
    const bytes = Buffer.byteLength(body);
    // The length counts its own digits.
    let len = bytes + 1;
    while (String(len).length + bytes !== len) len = String(len).length + bytes;
    return `${len}${body}`;
  });
  const data = Buffer.from(lines.join(""), "utf8");
  return [headerBlock({ name: flag === "g" ? "pax_global_header" : "PaxHeader", size: data.length, mode: 0o644, flag, mtime }), data, Buffer.alloc(padded(data.length) - data.length)];
}

/**
 * A gzip-compressed tar archive of `entries`, deterministic for the same input (fixed mtime, owner 0). `prefix` is put
 * in front of every path (GitHub's `owner-repo-<sha>/`); `comment` becomes the pax global header's comment (GitHub
 * puts the commit there). Names longer than a ustar header holds get a pax `path` record.
 */
export function writeTarGz(entries: readonly TarWriteEntry[], options: { prefix?: string; comment?: string; mtime?: number } = {}): Buffer {
  const mtime = Math.floor(options.mtime ?? 0);
  const parts: Buffer[] = [];
  if (options.comment) parts.push(...paxBlock({ comment: options.comment }, mtime, "g"));
  if (options.prefix) parts.push(headerBlock({ name: options.prefix.endsWith("/") ? options.prefix : `${options.prefix}/`, size: 0, mode: 0o755, flag: "5", mtime }));
  for (const e of entries) {
    const type = e.type ?? "file";
    const name = `${options.prefix ? (options.prefix.endsWith("/") ? options.prefix : `${options.prefix}/`) : ""}${e.path}${type === "directory" && !e.path.endsWith("/") ? "/" : ""}`;
    const content = type === "file" ? (typeof e.content === "string" ? Buffer.from(e.content, "utf8") : Buffer.from(e.content ?? new Uint8Array())) : Buffer.alloc(0);
    if (Buffer.byteLength(name) > 100 || (e.linkTarget && Buffer.byteLength(e.linkTarget) > 100)) {
      parts.push(...paxBlock({ path: name, ...(e.linkTarget ? { linkpath: e.linkTarget } : {}) }, mtime, "x"));
    }
    const flag = type === "file" ? "0" : type === "directory" ? "5" : type === "symlink" ? "2" : "1";
    parts.push(headerBlock({ name: Buffer.byteLength(name) > 100 ? name.slice(0, 99) : name, size: content.length, mode: e.mode ?? (type === "directory" ? 0o755 : 0o644), flag, linkTarget: e.linkTarget && Buffer.byteLength(e.linkTarget) <= 100 ? e.linkTarget : e.linkTarget?.slice(0, 99), mtime }));
    if (content.length > 0) parts.push(content, Buffer.alloc(padded(content.length) - content.length));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 6 });
}
