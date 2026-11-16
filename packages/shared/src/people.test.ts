import { describe, expect, it } from "vitest";
import { isAdminRole, isOwnerRole, MEMBERSHIP_ROLES } from "./constants";
import { hasSectionAccess, SECTIONS } from "./permissions";
import { accountEmailOffLinkLabel, continueLinkEmail, emailDate, INVITATIONS_OFF_LINK_LABEL, invitationAcceptedEmail, invitationEmail, waitlistAdmittedEmail } from "./people-email";
import { COLLABORATOR_SECTIONS, INVITATION_ROLE_SENTENCE, invitationMembership, invitationNeedsEmail, invitationRolePhrase, isPeopleTokenShape, maskedAddress, mayMakeInvitation, rolesThatMayInvite } from "./people";

describe("what an invitation offers (THESIS_REVIEW 3.1, 3.3)", () => {
  it("a cofounder joins as a cofounder, with an owner's standing; a collaborator on Product and Customers, reading the plan, never Money or Settings", () => {
    expect(invitationMembership("cofounder")).toEqual({ role: "cofounder", sectionPermissions: {} });
    expect(isOwnerRole("cofounder") && isAdminRole("cofounder")).toBe(true);
    for (const s of SECTIONS) expect(hasSectionAccess({ role: "cofounder", sectionPermissions: { [s]: "none" } }, s, "write"), s).toBe(true);
    const collaborator = invitationMembership("collaborator");
    expect(collaborator).toEqual({ role: "collaborator", sectionPermissions: {} });
    expect(isOwnerRole("collaborator") || isAdminRole("collaborator")).toBe(false);
    const m = { role: collaborator.role, sectionPermissions: collaborator.sectionPermissions };
    for (const s of ["product", "development", "distribution", "crm"] as const) expect(hasSectionAccess(m, s, "write"), s).toBe(true);
    for (const s of ["inbox", "team"] as const) expect([hasSectionAccess(m, s, "read"), hasSectionAccess(m, s, "write")], s).toEqual([true, false]);
    for (const s of ["finance", "legal", "billing", "settings", "live"] as const) expect(hasSectionAccess(m, s, "read"), s).toBe(false);
    // Section permissions narrow a collaborator and never widen them past the role.
    const widened = { role: "collaborator" as const, sectionPermissions: { finance: "write" as const, settings: "read" as const, crm: "none" as const } };
    expect([hasSectionAccess(widened, "finance", "read"), hasSectionAccess(widened, "settings", "read"), hasSectionAccess(widened, "crm", "read")]).toEqual([false, false, false]);
    expect(COLLABORATOR_SECTIONS.finance).toBe("none");
  });

  it("a cofounder invitation is an owner's or a cofounder's to make; a collaborator's also an admin's", () => {
    expect(rolesThatMayInvite("cofounder")).toEqual(["owner", "cofounder"]);
    expect(rolesThatMayInvite("collaborator")).toEqual(["owner", "cofounder", "admin"]);
    expect(invitationRolePhrase("cofounder")).toBe("a cofounder");
    expect(INVITATION_ROLE_SENTENCE.collaborator).not.toMatch(/staff|seat|squad|club/i);
  });

  it("making an invitation needs the role and write on the Team section; a cofounder invitation always names an address", () => {
    expect(mayMakeInvitation({ role: "admin", sectionPermissions: {} }, "collaborator")).toBe(true);
    expect(mayMakeInvitation({ role: "admin", sectionPermissions: { team: "read" } }, "collaborator")).toBe(false);
    expect(mayMakeInvitation({ role: "admin", sectionPermissions: {} }, "cofounder")).toBe(false);
    expect(mayMakeInvitation({ role: "cofounder", sectionPermissions: { team: "none" } }, "cofounder")).toBe(true);
    expect(mayMakeInvitation({ role: "collaborator", sectionPermissions: { team: "write" } }, "collaborator")).toBe(false);
    expect([invitationNeedsEmail("cofounder"), invitationNeedsEmail("collaborator")]).toEqual([true, false]);
  });

  it("every role that existed keeps its meaning", () => {
    expect(MEMBERSHIP_ROLES.slice(0, 5)).toEqual(["owner", "admin", "member", "viewer", "advisor"]);
    expect(hasSectionAccess({ role: "member", sectionPermissions: {} }, "finance", "write")).toBe(true);
    expect(hasSectionAccess({ role: "viewer", sectionPermissions: {} }, "product", "write")).toBe(false);
    expect(hasSectionAccess({ role: "admin", sectionPermissions: { finance: "none" } }, "finance", "read")).toBe(false);
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
      invitationEmail({ appName: "Foundmill", inviterName: "Maya", projectName: "Bread by Bike", role: "cofounder", link: "https://foundmill.com/i/x", expiresAt: at, offLink: "https://in.foundmill.com/mail/invitations/off?t=x" }),
      invitationAcceptedEmail({ appName: "Foundmill", recipientName: "Maya", personName: "Ida", projectName: "Bread by Bike", role: "collaborator", link: "https://foundmill.com/b/x", offLink: "https://x/off", pauseLink: "https://x/pause" }),
    ];
    for (const e of all) {
      expect(`${e.subject} ${e.text}`).not.toMatch(/\bjobs?\b|employ|career|unemploy/i);
      expect(e.html).not.toMatch(/<script/i);
    }
    expect(all[0]!.text).toContain("until Nov 27, 2026");
  });

  it("an invitation's footer is true: the address can be invited again, and its one link stops every invitation", () => {
    const e = invitationEmail({ appName: "Foundmill", inviterName: "Maya", projectName: "Bread by Bike", role: "collaborator", link: "https://foundmill.com/i/x", expiresAt: at, offLink: "https://in.foundmill.com/mail/invitations/off?t=abc" });
    expect(e.text).toContain("People on Foundmill can invite this address again; to stop every invitation to it, use the link below.");
    expect(e.text).toContain(`${INVITATIONS_OFF_LINK_LABEL}: https://in.foundmill.com/mail/invitations/off?t=abc`);
    expect(e.html).toContain('href="https://in.foundmill.com/mail/invitations/off?t=abc"');
    expect(e.text).not.toMatch(/sends nothing else/);
  });

  it("cut links and addresses out of the names people typed", () => {
    const e = invitationEmail({ appName: "Foundmill", inviterName: "Visit evil.example now", projectName: "x@y.com <b>", role: "collaborator", link: "https://foundmill.com/i/x", expiresAt: at, offLink: "https://in.foundmill.com/mail/invitations/off?t=x" });
    expect(e.text).not.toContain("evil.example");
    expect(e.text).not.toContain("x@y.com");
    expect(e.html).not.toContain("<b>");
  });

  it("the waitlist's email: one purpose, the card when one is kept, no link in its name, and the way to stop email", () => {
    const off = "https://in.foundmill.com/mail/invitations/off?t=abc";
    const e = waitlistAdmittedEmail({ appName: "Foundmill", cardName: "Tutorlane", link: "https://foundmill.com/start", offLink: off });
    expect(e.subject).toBe("Your place on Foundmill is open");
    expect(e.text).toContain("Your place is open. Sign in with this address to pick up where you left off.");
    expect(e.text).toContain("Your card for Tutorlane is saved in your account.");
    expect(e.text).toContain("Your place does not expire.");
    expect(e.text).toContain("Open Foundmill: https://foundmill.com/start");
    expect(e.text).toContain(`Don't email this address about joining Foundmill: ${off}`);
    expect(accountEmailOffLinkLabel("Acme")).toBe("Don't email this address about joining Acme");
    expect(e.html).toContain(`href="${off}"`);
    expect(`${e.subject} ${e.text}`).not.toMatch(/\bjobs?\b|employ|career|unemploy/i);
    const plain = waitlistAdmittedEmail({ appName: "Foundmill", cardName: null, link: "https://foundmill.com/start", offLink: off });
    expect(plain.text).not.toContain("Your card");
    const sneaky = waitlistAdmittedEmail({ appName: "Foundmill", cardName: "Go to evil.example\nnow <b>", link: "https://foundmill.com/start", offLink: off });
    expect(sneaky.text).not.toContain("evil.example");
    expect(sneaky.html).not.toContain("<b>");
    expect(sneaky.text).toContain("Your card for Go to (link) now <b> is saved");
  });

  it("the link to continue on a computer (WP-03 T3): one purpose, the link the gateway built, and the way to stop email", () => {
    const off = "https://in.foundmill.com/mail/invitations/off?t=abc";
    const link = "https://foundmill.com/b/11111111-1111-4111-8111-111111111111/product/page";
    const e = continueLinkEmail({ appName: "Foundmill", link, offLink: off });
    expect(e.subject).toBe("Your link to continue on a computer");
    expect(e.text).toContain("You asked for this link from your phone. Open it on a computer to continue. It opens after you sign in with this address.");
    expect(e.text).toContain(`Continue on Foundmill: ${link}`);
    expect(e.text).toContain(`Don't email this address about joining Foundmill: ${off}`);
    expect(e.html).toContain(`href="${link}"`);
    expect(`${e.subject} ${e.text}`).not.toMatch(/\bjobs?\b|employ|career|unemploy/i);
  });
});
