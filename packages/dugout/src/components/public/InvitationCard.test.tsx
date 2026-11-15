import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { ON_WAITLIST_EMAIL_PROMISE, ON_WAITLIST_WORDS } from "@foundmill/shared/allowlist";
import { INVITATION_OTHER_ADDRESS_WORDS, INVITATION_ROLE_SENTENCE } from "@foundmill/shared/people";
import { InvitationCard, invitationCardWords } from "./InvitationCard";
import { OnWaitlistCard } from "./OnWaitlistCard";

describe("InvitationCard", () => {
  it("says who invited you, to what and as what, with the role's one sentence and the caller's actions", () => {
    render(<InvitationCard state="pending" projectName="Bread by Bike" inviterName="Maya Lee" roleWord="Cofounder" roleSentence={INVITATION_ROLE_SENTENCE.cofounder} actions={<button type="button">Accept</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Maya Lee invited you to Bread by Bike" })).toBeTruthy();
    expect(screen.getByText("As a cofounder")).toBeTruthy();
    expect(screen.getByText(INVITATION_ROLE_SENTENCE.cofounder)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("names a founder of the project when the inviter has no name, and every dead invitation reads the same and names nobody", () => {
    expect(invitationCardWords({ state: "pending", projectName: "Bread by Bike", inviterName: null, roleWord: "Collaborator" })).toEqual({ title: "A founder of Bread by Bike invited you to Bread by Bike", lead: "As a collaborator" });
    const html = renderToStaticMarkup(<InvitationCard state="unavailable" projectName="Secret Project" inviterName="Maya" roleSentence="x" />);
    expect(html).toContain("This invitation no longer works");
    expect(html).not.toContain("Secret Project");
    expect(html).not.toContain("Maya");
  });

  it("while asking it says it is opening; when too many people opened links at once it says to try again, never that the invitation is dead", () => {
    const busy = renderToStaticMarkup(<InvitationCard state="busy" projectName="Secret Project" inviterName="Maya" />);
    expect(busy).toContain("Too many people opened links just now.");
    expect(busy).toContain("Try again in a minute.");
    expect(busy).not.toContain("no longer works");
    expect(busy).not.toContain("Secret Project");
    expect(invitationCardWords({ state: "busy" })).toEqual({ title: "Too many people opened links just now.", lead: "Try again in a minute." });
    const checking = renderToStaticMarkup(<InvitationCard state="checking" />);
    expect(checking).toContain("Opening the invitation…");
    expect(checking).toContain('aria-busy="true"');
  });

  it("an invitation to an address, met by another account, keeps its card and says which address to sign in with, never the dead-link words", () => {
    render(<InvitationCard state="pending" projectName="Bread by Bike" inviterName="Maya Lee" roleWord="Cofounder" actions={<button type="button">Accept</button>} note={INVITATION_OTHER_ADDRESS_WORDS} />);
    expect(screen.getByRole("status").textContent).toBe("Sign in with the address this invitation was sent to.");
    expect(screen.getByRole("heading", { level: 1, name: "Maya Lee invited you to Bread by Bike" })).toBeTruthy();
    expect(screen.queryByText(/no longer works/)).toBeNull();
  });

  it("prints every string as text", () => {
    const html = renderToStaticMarkup(<InvitationCard state="pending" projectName={"<img src=x onerror=alert(1)>"} inviterName="<script>x</script>" roleWord="Cofounder" />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });
});

describe("OnWaitlistCard", () => {
  it("says the person is on the list and what is true now (no email is promised while nothing records who waits), names the address and shows the caller's way on, with nothing to join", () => {
    render(<OnWaitlistCard email="maya@example.com" actions={<a href="/examples/x">Look around an example</a>} />);
    expect(screen.getByRole("heading", { level: 1, name: "You're on the list." })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(ON_WAITLIST_WORDS.body);
    expect(ON_WAITLIST_WORDS.body).toBe("We'll let you in as soon as there is room. Come back tomorrow to check.");
    expect(document.body.textContent).not.toContain(ON_WAITLIST_EMAIL_PROMISE);
    expect(document.body.textContent).not.toMatch(/email you/i);
    expect(screen.getByText("maya@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Look around an example" })).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bjob|employ|career/i);
  });
});
