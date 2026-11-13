import { describe, expect, it } from "vitest";
import { hasSectionAccess } from "./permissions";
import { emailDate, invitationAcceptedEmail, invitationEmail } from "./people-email";
import { COLLABORATOR_SECTIONS, INVITATION_ROLE_SENTENCE, invitationMembership, invitationRolePhrase, isPeopleTokenShape, maskedAddress, rolesThatMayInvite } from "./people";

describe("what an invitation offers (THESIS_REVIEW 3.1, 3.3)", () => {
  it("a cofounder joins with the founders' standing; a collaborator on Product and Customers, reading the plan, never Money or Settings", () => {
    expect(invitationMembership("cofounder")).toEqual({ role: "owner", sectionPermissions: {} });
    const collaborator = invitationMembership("collaborator");
    expect(collaborator.role).toBe("member");
    const m = { role: collaborator.role, sectionPermissions: collaborator.sectionPermissions };
    for (const s of ["product", "development", "distribution", "crm"] as const) expect(hasSectionAccess(m, s, "write"), s).toBe(true);
    for (const s of ["inbox", "team"] as const) expect([hasSectionAccess(m, s, "read"), hasSectionAccess(m, s, "write")], s).toEqual([true, false]);
    for (const s of ["finance", "legal", "billing", "settings", "live"] as const) expect(hasSectionAccess(m, s, "read"), s).toBe(false);
    // A copy, never the frozen constant itself.
    expect(collaborator.sectionPermissions).not.toBe(COLLABORATOR_SECTIONS);
  });

  it("a cofounder invitation is an owner's to make; a collaborator's an owner's or an admin's", () => {
    expect(rolesThatMayInvite("cofounder")).toEqual(["owner"]);
    expect(rolesThatMayInvite("collaborator")).toEqual(["owner", "admin"]);
    expect(invitationRolePhrase("cofounder")).toBe("a cofounder");
    expect(INVITATION_ROLE_SENTENCE.collaborator).not.toMatch(/staff|seat|squad|club/i);
  });

  it("tokens have one shape; an address is shown masked", () => {
    expect(isPeopleTokenShape("a".repeat(43))).toBe(true);
    for (const bad of ["a".repeat(42), `${"a".repeat(42)}=`, "../../etc", null, 43]) expect(isPeopleTokenShape(bad)).toBe(false);
    expect(maskedAddress(" Maya.Lee@Example.com ")).toBe("ma***@example.com");
    expect(maskedAddress("al@example.com")).toBe("a***@example.com");
    expect(maskedAddress("nonsense")).toBe("***");
  });
});

describe("the emails about people", () => {
  const at = new Date(Date.UTC(2026, 10, 27, 23, 30));
  it("use US dates and say nothing about work or a job", () => {
    expect(emailDate(at)).toBe("Nov 27, 2026");
    const all = [
      invitationEmail({ appName: "Foundmill", inviterName: "Maya", projectName: "Bread by Bike", role: "cofounder", link: "https://foundmill.com/i/x", expiresAt: at }),
      invitationAcceptedEmail({ appName: "Foundmill", recipientName: "Maya", personName: "Ida", projectName: "Bread by Bike", role: "collaborator", link: "https://foundmill.com/b/x", offLink: "https://x/off", pauseLink: "https://x/pause" }),
    ];
    for (const e of all) {
      expect(`${e.subject} ${e.text}`).not.toMatch(/\bjobs?\b|employ|career|unemploy/i);
      expect(e.html).not.toMatch(/<script/i);
    }
    expect(all[0]!.text).toContain("until Nov 27, 2026");
  });

  it("cut links and addresses out of the names people typed", () => {
    const e = invitationEmail({ appName: "Foundmill", inviterName: "Visit evil.example now", projectName: "x@y.com <b>", role: "collaborator", link: "https://foundmill.com/i/x", expiresAt: at });
    expect(e.text).not.toContain("evil.example");
    expect(e.text).not.toContain("x@y.com");
    expect(e.html).not.toContain("<b>");
  });
});
