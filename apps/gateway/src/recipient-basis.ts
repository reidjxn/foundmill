/**
 * The basis on which an agent may email an address (WP-08 T10; audit a5 §3.8, GTM-14, GTM-33), found at send time for
 * the mail-sending tools (`MAIL_SEND_TOOLS`) and decided in policy (`15-mail-basis.cedar`): `none` is refused in every
 * mode, `recorded` asks the founder in every mode (D4). A plain read, callable from the pipeline and from a service route.
 *
 * In order, the first that holds:
 * - `consent`: a contact with this address has a confirmed page consent not withdrawn;
 * - `relationship`: they wrote to the project (a verified reply) or paid it within `PROJECT_MAIL_RELATIONSHIP_MS`;
 * - `recorded`: a contact with this address whose lawful basis is written down and that the founder made or brought in
 *   (`FOUNDER_SOURCES`; a basis of "consent" counts only through a live consent row, above);
 * - `none`.
 */
import { emailEntityId } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { PROJECT_MAIL_RELATIONSHIP_MS, RECIPIENT_BASES, type RecipientBasis } from "@foundmill/shared";

type Executor = Parameters<typeof repos.followers.basisFacts>[0];

/**
 * The sources of contacts the founder made or brought in: added by hand, imported, from the founder's own connected
 * tools, the First ten board. Any other source (a channel's lead list, an agent, the Composer, a page signup, one not
 * known here) is not the founder's, so an unknown source fails closed.
 */
export const FOUNDER_SOURCES: ReadonlySet<string> = new Set(["user", "manual", "import", "first_ten", "membership", "invite", "conversions", "stripe", "hubspot", "affinity", "salesforce", "pipedrive", "attio", "gmail", "outlook"]);

export const sourceIsFounderMade = (source: string | null): boolean => source !== null && FOUNDER_SOURCES.has(source);

export async function recipientBasis(db: Executor | Db, businessId: string, email: string, now: Date): Promise<RecipientBasis> {
  const address = email.trim().toLowerCase();
  if (!address) return "none";
  const since = new Date(now.getTime() - PROJECT_MAIL_RELATIONSHIP_MS);
  const facts = await repos.followers.basisFacts(db, businessId, address);
  if (facts.consented) return "consent";
  if (await repos.postalAddress.paid(db, businessId, { email: address, since })) return "relationship";
  // Ingest files a verified reply under the address's own id (`emailEntityId`), and under the contact once linked.
  for (const entityId of new Set([emailEntityId(address), ...facts.contacts.map((c) => c.id)])) if (await repos.postalAddress.wroteFirst(db, businessId, { entityId, since })) return "relationship";
  if (facts.contacts.some((c) => c.lawfulBasis && c.lawfulBasis !== "consent" && sourceIsFounderMade(c.source))) return "recorded";
  return "none";
}

/** The fields of a mail-sending tool's arguments that name who the mail goes to. */
const RECIPIENT_FIELDS = ["to", "cc", "bcc", "recipients", "personalizations"] as const;

/**
 * The addresses a mail goes to (trimmed, lowercased, once each): every string under the recipient fields, whole, never
 * the sender and never a scan of free text, so the address checked is the one the tool sends to ("Name <a@b>" gives
 * "a@b"). A value that is not an address is kept as it is and has no basis.
 */
export function mailRecipientEmails(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const a = args as Record<string, unknown>;
  const out = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === "string") {
      const inner = /<([^<>]+)>\s*$/.exec(v)?.[1] ?? v;
      if (inner.includes("@")) out.add(inner.trim().toLowerCase());
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== "name") walk(x, depth + 1);
  };
  for (const k of RECIPIENT_FIELDS) walk(a[k], 0);
  return [...out];
}

/** The weakest of several addresses' bases: a send to many is only as allowed as its least-allowed address. */
export function weakestBasis(bases: readonly RecipientBasis[]): RecipientBasis | undefined {
  if (!bases.length) return undefined;
  return bases.reduce((a, b) => (RECIPIENT_BASES.indexOf(a) >= RECIPIENT_BASES.indexOf(b) ? a : b));
}
