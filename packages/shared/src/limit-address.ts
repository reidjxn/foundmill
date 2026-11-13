/**
 * The address a per-caller rate limit counts (the second security review of invitations, P2-2): an IPv6 address as its
 * /64, the block one subscriber is usually given, so a caller cannot use up a fresh window per address of their own
 * block; an IPv4-mapped IPv6 address as its IPv4; an IPv4 address as it is. Brackets and a zone id are dropped first.
 * Anything that is not an IP address comes back trimmed and lowercased, so a key is never empty and never fails.
 *
 * TODO(dedupe): reidjxn/foundmill#98 (the idea box, not on main as of Nov 13, 2026) has the same rule as
 * `limitAddress` in apps/api/src/services/idea-box.ts, with the same output ("2001:db8:1:2::/64"). Whichever merges
 * second should keep this one and delete the other.
 */
export function limitAddress(address: string): string {
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a) ?? /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return mapped[1]!;
  if (!a.includes(":") || !/^[0-9a-f:.]+$/.test(a) || (a.match(/::/g) ?? []).length > 1) return a;
  const [head = "", tail = ""] = a.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // An embedded IPv4 tail ("64:ff9b::1.2.3.4") stands for two groups.
  const width = (groups: string[]) => groups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const groups = a.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - width(left) - width(right))).fill("0"), ...right] : left;
  if (groups.length < 4 || groups.slice(0, 4).some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
