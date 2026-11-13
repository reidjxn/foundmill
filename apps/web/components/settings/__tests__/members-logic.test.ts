/**
 * Settings › People (THESIS_REVIEW 3.1, MLSL-40): someone joins through an invitation they accept; the silent add by
 * account ID or sign-in email is gone. A cofounder invitation is an owner's or a cofounder's to make (3.3).
 */
import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { invitationReadFailure } from "@/lib/people";
import { inviteEmailField, inviteEmailProblem, mayChangeRole, mayInvite, memberLabel, memberMeta, ROLE_ORDER, shortId } from "../MembersTab";

const ID = "5a1e0000-0000-4000-8000-00000000fe01";

describe("inviting someone", () => {
  it("a cofounder by an owner or a cofounder; a collaborator also by an admin; nobody else", () => {
    expect(mayInvite("owner", "cofounder")).toBe(true);
    expect(mayInvite("cofounder", "cofounder")).toBe(true);
    expect(mayInvite("admin", "cofounder")).toBe(false);
    expect(mayInvite("admin", "collaborator")).toBe(true);
    for (const r of ["member", "collaborator", "viewer", "advisor"] as const) expect([mayInvite(r, "cofounder"), mayInvite(r, "collaborator")]).toEqual([false, false]);
  });
  it("the address is optional for a collaborator and checked only when typed; a cofounder invitation needs one", () => {
    expect(inviteEmailProblem("")).toBeNull();
    expect(inviteEmailProblem("  ")).toBeNull();
    expect(inviteEmailProblem("ada@northwind.example")).toBeNull();
    expect(inviteEmailProblem("ada@")).toMatch(/doesn't look like an email/);
    expect(inviteEmailProblem("", true)).toMatch(/Type the email address/);
    expect(inviteEmailProblem("", true, false)).toBeNull();
    expect(inviteEmailProblem("ada@northwind.example", true)).toBeNull();
    expect(inviteEmailField("cofounder").label).toBe("Their email");
    expect(inviteEmailField("collaborator").label).toBe("Email it to (optional)");
    expect(inviteEmailField("cofounder").hint).toMatch(/Only the person signed in with this address can accept/);
  });

  it("an invitation read the api's limit refused says busy; anything else is the dead-link answer", () => {
    const err = (code: string, appCode?: string) => new TRPCClientError("x", { result: { error: { message: "x", code: -32000, data: { code, appCode } } } } as never);
    expect(invitationReadFailure(err("TOO_MANY_REQUESTS", "rate_limited"))).toBe("busy");
    expect(invitationReadFailure(err("TOO_MANY_REQUESTS"))).toBe("busy");
    expect(invitationReadFailure(err("INTERNAL_SERVER_ERROR"))).toBe("unavailable");
    expect(invitationReadFailure(new Error("network"))).toBe("unavailable");
  });
  it("shortens a long id for one line", () => {
    expect(shortId(ID)).toBe("5a1e0000…fe01");
  });
});

describe("the people list (THESIS_REVIEW 3.3)", () => {
  it("lists every role once, the founders first", () => {
    expect(ROLE_ORDER).toEqual(["owner", "cofounder", "admin", "member", "collaborator", "viewer", "advisor"]);
  });
  it("only someone with an owner's standing changes a cofounder's or an admin's role; nobody their own; an owner's never from the list", () => {
    expect(mayChangeRole("cofounder", "cofounder", false)).toBe(true);
    expect(mayChangeRole("owner", "admin", false)).toBe(true);
    expect(mayChangeRole("admin", "cofounder", false)).toBe(false);
    expect(mayChangeRole("admin", "collaborator", false)).toBe(true);
    expect(mayChangeRole("owner", "owner", false)).toBe(false);
    expect(mayChangeRole("owner", "member", true)).toBe(false);
  });
  it("says when a collaborator's access ends, in US dates", () => {
    const fmt = (d: Date | string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(d));
    const now = new Date("2026-11-13T12:00:00Z");
    expect(memberMeta({ role: "collaborator", createdAt: "2026-11-01T12:00:00Z", expiresAt: "2026-11-27T12:00:00Z" }, fmt, now)).toBe("Collaborator · since Nov 1 · until Nov 27");
    expect(memberMeta({ role: "collaborator", createdAt: "2026-11-01T12:00:00Z", expiresAt: "2026-11-03T12:00:00Z" }, fmt, now)).toBe("Collaborator · since Nov 1 · access ended Nov 3");
    expect(memberMeta({ role: "cofounder", createdAt: "2026-11-01T12:00:00Z", expiresAt: null }, fmt, now)).toBe("Cofounder · since Nov 1");
  });
});

describe("memberLabel (MLSL-40)", () => {
  it("names the person the remove dialog asks about: their name or email, else their role and short account", () => {
    expect(memberLabel({ userId: ID, role: "admin", displayName: "Ada Lovelace", email: "ada@northwind.example" })).toBe("Ada Lovelace");
    expect(memberLabel({ userId: ID, role: "admin", email: "ada@northwind.example" })).toBe("ada@northwind.example");
    expect(memberLabel({ userId: ID, role: "admin" })).toBe("the admin with account 5a1e0000…fe01");
  });
});
