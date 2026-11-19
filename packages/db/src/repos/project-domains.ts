/**
 * project_domains (0147): a project's own domain (WP-08 domain plan, Path B). Written on the service connection only, by
 * the gateway (SendGrid live) or the api (SendGrid mock) through the own-domain flow; members read the display columns
 * through RLS (`view`; a column grant keeps SendGrid's id and `added_by` from them). The gateway reads `sendingFrom`
 * when a project sends, so mail goes from the founder's domain once it is verified.
 */
import type { OwnDomainRecord } from "@foundmill/shared";
import { and, eq, ne } from "drizzle-orm";
import { projectDomains, type ProjectDomain } from "../schema";
import { maybeOne, uniqueViolation, type Executor } from "./_shared";

/** The domain is verified by another project already (the partial unique index). */
export class OwnDomainTakenError extends Error {
  constructor() {
    super("This domain is already verified by another project.");
    this.name = "OwnDomainTakenError";
  }
}

/** What a member may read (the column grant): everything Settings shows. */
const VIEW = {
  id: projectDomains.id,
  businessId: projectDomains.businessId,
  domain: projectDomains.domain,
  senderLocalPart: projectDomains.senderLocalPart,
  records: projectDomains.records,
  status: projectDomains.status,
  simulated: projectDomains.simulated,
  checkedAt: projectDomains.checkedAt,
  verifiedAt: projectDomains.verifiedAt,
  createdAt: projectDomains.createdAt,
};
export type ProjectDomainView = Pick<ProjectDomain, keyof typeof VIEW>;

export const projectDomainsRepo = {
  /** The whole row, SendGrid's id included: the service connection only. */
  async get(db: Executor, businessId: string): Promise<ProjectDomain | null> {
    return maybeOne(await db.select().from(projectDomains).where(eq(projectDomains.businessId, businessId)).limit(1));
  },

  /** What Settings shows, readable by members under RLS. */
  async view(db: Executor, businessId: string): Promise<ProjectDomainView | null> {
    return maybeOne(await db.select(VIEW).from(projectDomains).where(eq(projectDomains.businessId, businessId)).limit(1));
  },

  /** Whether another project already sends from this domain for real (a simulated row never counts). */
  async takenElsewhere(db: Executor, businessId: string, domain: string): Promise<boolean> {
    const rows = await db
      .select({ id: projectDomains.id })
      .from(projectDomains)
      .where(and(eq(projectDomains.domain, domain), eq(projectDomains.status, "verified"), eq(projectDomains.simulated, false), ne(projectDomains.businessId, businessId)))
      .limit(1);
    return rows.length > 0;
  },

  /** The project's domain, added (or replacing the one it had): pending until a check finds every sending record. */
  async put(db: Executor, businessId: string, input: { domain: string; senderLocalPart: string; sendgridDomainId: string; records: OwnDomainRecord[]; addedBy: string | null; simulated: boolean }): Promise<ProjectDomain> {
    const values = { domain: input.domain, senderLocalPart: input.senderLocalPart, sendgridDomainId: input.sendgridDomainId, records: input.records, addedBy: input.addedBy, simulated: input.simulated, status: "pending" as const, checkedAt: null, verifiedAt: null };
    const [row] = await db
      .insert(projectDomains)
      .values({ businessId, ...values })
      .onConflictDoUpdate({ target: projectDomains.businessId, set: values })
      .returning();
    return row!;
  },

  /** The name mail is sent as at the domain; the domain stays as verified (or pending) as it was. */
  async setSender(db: Executor, businessId: string, senderLocalPart: string): Promise<ProjectDomain | null> {
    return maybeOne(await db.update(projectDomains).set({ senderLocalPart }).where(eq(projectDomains.businessId, businessId)).returning());
  },

  /**
   * What a check found. Verified once every sending record was found; a verified domain stays verified when a later
   * check fails (a DNS or SendGrid hiccup must not hand the domain to whoever checks next), with what was found kept.
   * Refused when another project verified the domain first.
   */
  async saveCheck(db: Executor, businessId: string, input: { records: OwnDomainRecord[]; verified: boolean; now: Date }): Promise<ProjectDomain | null> {
    const before = await projectDomainsRepo.get(db, businessId);
    if (!before) return null;
    const verified = input.verified || before.status === "verified";
    try {
      const [row] = await db
        .update(projectDomains)
        .set({ records: input.records, status: verified ? "verified" : "pending", checkedAt: input.now, verifiedAt: verified ? (before.verifiedAt ?? input.now) : null })
        .where(eq(projectDomains.businessId, businessId))
        .returning();
      return row ?? null;
    } catch (e) {
      if (uniqueViolation(e)?.constraint === "project_domains_verified_domain_key") throw new OwnDomainTakenError();
      throw e;
    }
  },

  async remove(db: Executor, businessId: string): Promise<ProjectDomain | null> {
    return maybeOne(await db.delete(projectDomains).where(eq(projectDomains.businessId, businessId)).returning());
  },

  /**
   * The address the project's mail goes from at its own domain, or null while none is verified. A live send never goes
   * from a domain only the mock verified.
   */
  async sendingFrom(db: Executor, businessId: string, opts: { live: boolean }): Promise<{ email: string; domain: string } | null> {
    const row = maybeOne(await db.select({ domain: projectDomains.domain, local: projectDomains.senderLocalPart, simulated: projectDomains.simulated }).from(projectDomains).where(and(eq(projectDomains.businessId, businessId), eq(projectDomains.status, "verified"))).limit(1));
    if (!row || (opts.live && row.simulated)) return null;
    return { email: `${row.local}@${row.domain}`, domain: row.domain };
  },
};

/** The repo bound to one connection, in the shape the own-domain flow takes (`runOwnDomain` in @foundmill/connectors). */
export function projectDomainsStore(db: Executor) {
  return {
    get: (businessId: string) => projectDomainsRepo.get(db, businessId),
    takenElsewhere: (businessId: string, domain: string) => projectDomainsRepo.takenElsewhere(db, businessId, domain),
    put: (businessId: string, input: Parameters<typeof projectDomainsRepo.put>[2]) => projectDomainsRepo.put(db, businessId, input),
    setSender: (businessId: string, senderLocalPart: string) => projectDomainsRepo.setSender(db, businessId, senderLocalPart),
    saveCheck: (businessId: string, input: Parameters<typeof projectDomainsRepo.saveCheck>[2]) => projectDomainsRepo.saveCheck(db, businessId, input),
    remove: (businessId: string) => projectDomainsRepo.remove(db, businessId),
  };
}
