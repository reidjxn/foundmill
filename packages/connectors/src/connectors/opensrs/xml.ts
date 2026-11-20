/**
 * OpenSRS's XCP envelope (domains.opensrs.guide "Construction of the POST Data"): an `OPS_envelope` whose body holds one
 * `dt_assoc` of items; objects nest as `dt_assoc`, lists as `dt_array` with numeric keys. Only what the connector sends
 * and reads: strings, numbers, booleans (as 1 or 0), objects and arrays. No attributes besides `key`, no namespaces.
 */
import { createHash } from "node:crypto";

export type OpsValue = string | number | boolean | null | undefined | OpsValue[] | { [k: string]: OpsValue };

// Characters XML 1.0 cannot carry are dropped, so a pasted control character never breaks the envelope.
// eslint-disable-next-line no-control-regex
const esc = (v: string): string => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unesc = (v: string): string => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function value(v: OpsValue): string {
  if (Array.isArray(v)) return `<dt_array>${v.map((x, i) => `<item key="${i}">${value(x)}</item>`).join("")}</dt_array>`;
  if (v !== null && typeof v === "object") return assoc(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return esc(v === null || v === undefined ? "" : String(v));
}

function assoc(o: { [k: string]: OpsValue }): string {
  return `<dt_assoc>${Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<item key="${esc(k)}">${value(v)}</item>`)
    .join("")}</dt_assoc>`;
}

/** The request document for one action on one object. */
export function opsRequest(action: string, object: string, attributes: { [k: string]: OpsValue }): string {
  return `<?xml version='1.0' encoding='UTF-8' standalone='no' ?><!DOCTYPE OPS_envelope SYSTEM 'ops.dtd'><OPS_envelope><header><version>0.9</version></header><body><data_block>${assoc({ protocol: "XCP", action, object, attributes })}</data_block></body></OPS_envelope>`;
}

/** `X-Signature`: md5(md5(xml + key) + key), lower-case hex. */
export const opsSignature = (xml: string, key: string): string => {
  const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
  return md5(md5(xml + key) + key);
};

/** OpenSRS's replies nest a few levels; anything deeper is not one. */
const MAX_DEPTH = 20;

/** The response's top-level `dt_assoc` as a plain object (strings for leaves). Throws on a document it cannot read. */
export function parseOps(xml: string): Record<string, unknown> {
  const tokens = xml.match(/<\/?(?:dt_assoc|dt_array|item)(?:\s+key="[^"]*")?\s*\/?>|[^<]+|<[^>]*>/g) ?? [];
  let i = 0;
  const skipText = () => {
    while (i < tokens.length && !/^<\/?(dt_assoc|dt_array|item)\b/.test(tokens[i]!)) i++;
  };
  const readContainer = (depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new Error("the response nests too deep");
    const open = tokens[i++]!;
    const isArray = open.startsWith("<dt_array");
    // No prototype: a key such as `__proto__` in a response is only a key.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const list: unknown[] = [];
    const put = (key: string, v: unknown) => {
      if (isArray) list.push(v);
      else out[key] = v;
    };
    for (;;) {
      skipText();
      const t = tokens[i];
      if (t === undefined) throw new Error("unterminated container");
      if (t.startsWith("</dt_")) {
        i++;
        return isArray ? list : out;
      }
      if (t.startsWith("<item")) {
        const key = unesc(/key="([^"]*)"/.exec(t)?.[1] ?? "");
        i++;
        if (t.endsWith("/>")) {
          put(key, "");
          continue;
        }
        let text = "";
        let v: unknown;
        while (i < tokens.length && !tokens[i]!.startsWith("</item")) {
          if (/^<dt_(assoc|array)/.test(tokens[i]!)) {
            v = readContainer(depth + 1);
            continue;
          }
          const tok = tokens[i++]!;
          if (!tok.startsWith("<")) text += tok;
        }
        i++;
        const leaf = v ?? unesc(text.trim());
        put(key, leaf);
        continue;
      }
      i++;
    }
  };
  while (i < tokens.length && !tokens[i]!.startsWith("<dt_assoc")) i++;
  if (i >= tokens.length) throw new Error("no dt_assoc in the response");
  return readContainer(0) as Record<string, unknown>;
}
