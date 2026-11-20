/**
 * Add, check and remove a project's own domain (WP-08 domain plan, Path B), one flow for both callers: the gateway runs
 * it on the live connector (`POST /v1/domains/own`), and the api runs it on the mock when SendGrid is mock, so the
 * golden path needs no gateway (as the Commit screen's domain check does). The store is `repos.projectDomains` on the
 * service connection; nothing here reads or writes anything else.
 *
 *   add     the domain is normalized (`normalizeOwnDomain`), SendGrid's domain authentication is started on the `em`
 *           subdomain (automatic security: three CNAMEs, the founder's MX untouched) and the row is written pending with
 *           those records and the site's `www` record. The same domain again keeps its row (no second authentication at
 *           SendGrid) and changes only the sender name; another domain replaces the first, whose authentication is removed.
 *           Besides SendGrid's records, a TXT at `_<brand>.<domain>` whose value is derived from this project and the domain
 *           (`ownershipRecord`): SendGrid's records are the same for every project on Foundmill's one account, so only
 *           this record shows that whoever controls the domain's DNS chose this project. A domain another project already
 *           sends from for real is refused before SendGrid is called.
 *   check   SendGrid validates its records, DNS is asked for the others (the ownership TXT among them); verified once every
 *           sending record is found, refused (409 `domain_taken`) when another project verified the domain first. A
 *           verified domain stays verified when a later check fails (the store keeps it).
 *   remove  the authentication is removed at SendGrid (best effort: one left behind sends nothing) and the row deleted.
 */
import { createHash } from "node:crypto";
import { APP_NAME } from "@foundmill/config";
import { AppError, normalizeOwnDomain, OWN_DOMAIN_SENDER_RE, OWN_DOMAIN_SENDING_SUBDOMAIN, ownDomainSendingReady, ownDomainSiteRecord, type OwnDomainRecord } from "@foundmill/shared";

export type OwnDomainAction =
  | { action: "add"; businessId: string; userId: string; domain: string; senderLocalPart: string; siteHost: string | null }
  | { action: "check"; businessId: string; siteHost: string | null }
  | { action: "remove"; businessId: string };

/** The row as the store keeps it (`project_domains`). */
export interface OwnDomainRow {
  domain: string;
  senderLocalPart: string;
  /** Null only while a registered domain's setup has not reached SendGrid yet. */
  sendgridDomainId: string | null;
  records: OwnDomainRecord[];
  status: string;
  /** `registered` when Foundmill registered it for the founder (Path A): never replaced or removed here. */
  source?: string;
  /** Written from the mocks: never set up or checked on the live vendors. */
  simulated?: boolean;
}

export interface OwnDomainStore<R extends OwnDomainRow> {
  get(businessId: string): Promise<R | null>;
  takenElsewhere(businessId: string, domain: string): Promise<boolean>;
  put(businessId: string, input: { domain: string; senderLocalPart: string; sendgridDomainId: string; records: OwnDomainRecord[]; addedBy: string | null; simulated: boolean }): Promise<R>;
  setSender(businessId: string, senderLocalPart: string): Promise<R | null>;
  saveCheck(businessId: string, input: { records: OwnDomainRecord[]; verified: boolean; now: Date }): Promise<R | null>;
  remove(businessId: string): Promise<unknown>;
}

export interface OwnDomainFlowDeps<R extends OwnDomainRow> {
  /** One `sending_domain` tool call; throws (an AppError) when the vendor refused. */
  call<T>(tool: string, args: Record<string, unknown>): Promise<T>;
  store: OwnDomainStore<R>;
  /** The store's "another project verified this domain" error. */
  isTaken(e: unknown): boolean;
  now(): Date;
  warn(obj: Record<string, unknown>, msg: string): void;
  /** The connector runs its mock: the row is marked simulated and never becomes the From of a live send. */
  simulated: boolean;
}

const BRAND = APP_NAME.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The project's ownership record for a domain: TXT `_<brand>.<domain>` = `<brand>-verify=<hash>`. Not a secret: anyone
 * can work out the value for a project, but only whoever controls the domain's DNS can publish it.
 */
export function ownershipRecord(businessId: string, domain: string): OwnDomainRecord {
  const hash = createHash("sha256").update(`${BRAND}-domain\u0000${businessId.toLowerCase()}\u0000${domain}`).digest("hex").slice(0, 32);
  return { purpose: "sending", type: "TXT", host: `_${BRAND}.${domain}`, value: `${BRAND}-verify=${hash}`, found: null };
}

const isOwnership = (r: OwnDomainRecord): boolean => r.type === "TXT" && r.host.startsWith(`_${BRAND}.`);

export async function runOwnDomain<R extends OwnDomainRow>(deps: OwnDomainFlowDeps<R>, input: OwnDomainAction): Promise<R | null> {
  const { store } = deps;
  const existing = await store.get(input.businessId);
  const forget = (id: string, msg: string) => deps.call("delete_domain", { sendgridDomainId: id }).catch((e: unknown) => deps.warn({ businessId: input.businessId, reason: e instanceof Error ? e.name : "unknown" }, msg));

  const registered = existing?.source === "registered";
  if (registered && input.action !== "check") throw new AppError("domain_registered", "This domain was registered for the project and stays with it. It is yours; moving it away is done from its own page.", 409);

  if (input.action === "remove") {
    if (!existing) return null;
    if (existing.sendgridDomainId) await forget(existing.sendgridDomainId, "own domain left at SendGrid");
    await store.remove(input.businessId);
    return null;
  }

  if (input.action === "add") {
    const domain = normalizeOwnDomain(input.domain, APP_NAME);
    if (!domain) throw new AppError("validation", "Enter a domain you own, like acme.com.", 400);
    const sender = input.senderLocalPart.trim().toLowerCase();
    if (!OWN_DOMAIN_SENDER_RE.test(sender)) throw new AppError("validation", "The name before the @ takes letters, digits, dots, hyphens and underscores.", 400);
    if (existing?.domain === domain) return existing.senderLocalPart === sender ? existing : store.setSender(input.businessId, sender);
    if (await store.takenElsewhere(input.businessId, domain)) throw new AppError("domain_taken", "Another project already sends from this domain. If it is yours, remove it there first.", 409);
    const added = await deps.call<{ sendgridDomainId: string; records: { type: OwnDomainRecord["type"]; host: string; value: string }[] }>("authenticate_domain", { domain, subdomain: OWN_DOMAIN_SENDING_SUBDOMAIN });
    if (existing?.sendgridDomainId) await forget(existing.sendgridDomainId, "previous own domain left at SendGrid");
    const records: OwnDomainRecord[] = [ownershipRecord(input.businessId, domain), ...added.records.map((r): OwnDomainRecord => ({ purpose: "sending", type: r.type, host: r.host, value: r.value, found: null })), ...(input.siteHost ? [ownDomainSiteRecord(domain, input.siteHost)] : [])];
    return store.put(input.businessId, { domain, senderLocalPart: sender, sendgridDomainId: added.sendgridDomainId, records, addedBy: input.userId, simulated: deps.simulated });
  }

  if (!existing) throw new AppError("not_found", "Add a domain first.", 404);
  const validation = existing.sendgridDomainId ? await deps.call<{ valid: boolean; results: { host: string; found: boolean; reason?: string }[] }>("validate_domain", { sendgridDomainId: existing.sendgridDomainId, domain: existing.domain }) : { valid: false, results: [] };
  // SendGrid's own records come from its validation; the ownership TXT, the site record and the rest from DNS.
  const fromSendgrid = existing.records
    .filter((r) => r.purpose === "sending" && !isOwnership(r))
    .map((r): OwnDomainRecord => {
      const v = validation.results.find((x) => x.host.toLowerCase() === r.host.toLowerCase());
      const { reason: _old, ...rest } = r;
      return { ...rest, found: v?.found === true, ...(v?.found === true ? {} : { reason: v?.reason ?? "Not found yet." }) };
    });
  // The site record follows the site as it is now (one made after the domain was added shows up here).
  const others = [ownershipRecord(input.businessId, existing.domain), ...existing.records.filter((r) => r.purpose !== "sending" && r.purpose !== "site"), ...(input.siteHost ? [ownDomainSiteRecord(existing.domain, input.siteHost)] : [])];
  const looked = (await deps.call<{ results: { found: boolean; reason?: string }[] }>("check_records", { records: others.map(({ type, host, value }) => ({ type, host, value })) })).results;
  const checked = others.map((r, i): OwnDomainRecord => {
    const { reason: _old, ...rest } = r;
    return { ...rest, found: looked[i]?.found === true, ...(looked[i]?.found ? {} : { reason: looked[i]?.reason ?? "Not found yet." }) };
  });
  const records = [checked[0]!, ...fromSendgrid, ...checked.slice(1)];
  try {
    return await store.saveCheck(input.businessId, { records, verified: validation.valid && ownDomainSendingReady(records), now: deps.now() });
  } catch (e) {
    if (deps.isTaken(e)) throw new AppError("domain_taken", "Another project already sends from this domain. If it is yours, remove it there first.", 409);
    throw e;
  }
}
