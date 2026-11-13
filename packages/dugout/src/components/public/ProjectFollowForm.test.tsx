import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { FOLLOW_ERRORS, followWords, TURNSTILE_PRIVACY_URL } from "@foundmill/shared/project-page";
import { FOLLOW_FIELDS, ProjectFollowForm } from "./ProjectFollowForm";

const words = followWords("Northwind Skincare");

describe("ProjectFollowForm", () => {
  it("asks for an email and a ticked box, in the project's name, with a 44 px button", () => {
    render(<ProjectFollowForm name="Northwind Skincare" slug="northwind-skincare" action="/follow" />);
    expect(screen.getByRole("heading", { level: 2, name: "Follow Northwind Skincare" })).toBeTruthy();
    expect(screen.getByText("Leave your email and Northwind Skincare will let you know when there is news.")).toBeTruthy();
    const email = screen.getByLabelText(words.emailLabel) as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.name).toBe(FOLLOW_FIELDS.email);
    expect(email.required).toBe(true);
    const box = screen.getByRole("checkbox", { name: "I agree to get email from Northwind Skincare about this project. I can unsubscribe at any time." }) as HTMLInputElement;
    expect(box.name).toBe(FOLLOW_FIELDS.consent);
    expect(box.checked).toBe(false);
    expect(box.closest("label")!.className).toContain("min-h-tap");
    const button = screen.getByRole("button", { name: "Follow" });
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.className).toContain("min-h-tap");
    expect((document.querySelector(`input[name="${FOLLOW_FIELDS.slug}"]`) as HTMLInputElement).value).toBe("northwind-skincare");
  });

  it("keeps the hidden field out of sight, out of the tab order and away from assistive technology", () => {
    render(<ProjectFollowForm name="Northwind Skincare" action="/follow" />);
    const trap = document.querySelector(`input[name="${FOLLOW_FIELDS.trap}"]`) as HTMLInputElement;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.autocomplete).toBe("off");
    expect(trap.closest("[aria-hidden='true']")!.className).toContain("sr-only");
    expect(screen.queryByRole("textbox", { name: words.trap })).toBeNull();
  });

  it("gives the caller's bot check a submit handler and a box inside the form that takes no room while empty", () => {
    const seen: string[] = [];
    const box = { current: null as HTMLDivElement | null };
    render(<ProjectFollowForm name="Northwind Skincare" action="/follow" onSubmit={(e) => (e.preventDefault(), seen.push("submit"))} onFocus={() => seen.push("focus")} widgetRef={box} />);
    const widget = document.querySelector("[data-follow-widget]") as HTMLDivElement;
    expect(box.current).toBe(widget);
    expect(widget.closest("form")).toBeTruthy();
    expect(widget.className).toContain("empty:hidden");
    expect(widget.className).toContain("max-w-full");
    (screen.getByLabelText(words.emailLabel) as HTMLInputElement).focus();
    screen.getByRole("button", { name: "Follow" }).click();
    expect(seen).toEqual(["focus", "submit"]);
    expect(FOLLOW_FIELDS.turnstile).toBe("turnstile");
  });

  it("says under the button, in small muted text, that Cloudflare Turnstile checks the form, with its privacy link in a new tab", () => {
    render(<ProjectFollowForm name="Northwind Skincare" action="/follow" />);
    const line = document.querySelector("[data-follow-bot-check]") as HTMLParagraphElement;
    expect(line.textContent).toBe("Protected by Cloudflare Turnstile (privacy)");
    expect(line.className).toContain("t-small");
    expect(line.className).toContain("text-secondary");
    expect(line.closest("form")).toBeTruthy();
    // Right after the button.
    expect(screen.getByRole("button", { name: "Follow" }).nextElementSibling).toBe(line);
    const link = screen.getByRole("link", { name: words.botCheckLinkLabel });
    expect(link.textContent).toBe("privacy");
    expect(link.getAttribute("href")).toBe(TURNSTILE_PRIVACY_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.className).toContain("min-h-tap");
    expect(line.querySelector("svg, img")).toBeNull();
  });

  it("shows the bot check's line whatever the plan (with or without the Built on line), and not once the visitor has followed", () => {
    const builtOn = { line: "Northwind Skincare is built on Foundmill.", linkLabel: "Start your own", href: "/" };
    for (const props of [{}, { builtOn }, { builtOn: null }]) {
      const { unmount } = render(<ProjectFollowForm name="Northwind Skincare" action="/follow" {...props} />);
      expect(document.querySelectorAll("[data-follow-bot-check]")).toHaveLength(1);
      unmount();
    }
    render(<ProjectFollowForm name="Northwind Skincare" state={{ status: "done" }} builtOn={builtOn} />);
    expect(document.querySelector("[data-follow-bot-check]")).toBeNull();
  });

  it("draws no bot-check box when the caller has none", () => {
    render(<ProjectFollowForm name="Northwind Skincare" action="/follow" />);
    expect(document.querySelector("[data-follow-widget]")).toBeNull();
  });

  it("works as a plain form before JavaScript: a native checkbox and a form that posts to the action", () => {
    const html = renderToStaticMarkup(<ProjectFollowForm name="Northwind Skincare" slug="northwind-skincare" action="/follow" />);
    expect(html).toContain('<form');
    expect(html).toContain('action="/follow"');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('role="checkbox"');
  });

  it("after a signup shows one line and nothing else", () => {
    render(<ProjectFollowForm name="Northwind Skincare" state={{ status: "done" }} />);
    expect(screen.getByRole("status").textContent).toBe("Check your email to confirm. Northwind Skincare will only write to you after you do.");
    expect(document.querySelector("form, input, button")).toBeNull();
  });

  it("after a signup, a visitor to a free project gets one small line more, with its link; without it, nothing", () => {
    const builtOn = { line: "Northwind Skincare is built on Foundmill.", linkLabel: "Start your own", href: "/?via=p.northwind-skincare" };
    const { unmount } = render(<ProjectFollowForm name="Northwind Skincare" state={{ status: "done" }} builtOn={builtOn} />);
    const line = document.querySelector("[data-follow-built-on]")!;
    expect(line.textContent).toBe("Northwind Skincare is built on Foundmill.Start your own");
    expect(line.className).toContain("t-small");
    const link = screen.getByRole("link", { name: "Start your own" });
    expect(link.getAttribute("href")).toBe("/?via=p.northwind-skincare");
    expect(link.className).toContain("min-h-tap");
    // After the answer, never before it.
    expect(document.querySelector("[data-follow-done]")!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    // Never while the form is still being filled in, and never in the console's preview.
    render(<ProjectFollowForm name="Northwind Skincare" action="/follow" builtOn={builtOn} />);
    expect(document.querySelector("[data-follow-built-on]")).toBeNull();
    render(<ProjectFollowForm name="Northwind Skincare" preview builtOn={builtOn} />);
    expect(document.querySelector("[data-follow-built-on]")).toBeNull();
  });

  it("says what went wrong in plain words and puts the visitor's address back", () => {
    render(<ProjectFollowForm name="Northwind Skincare" action="/follow" state={{ status: "error", field: "email", message: FOLLOW_ERRORS.email, email: "maya@" }} />);
    expect(screen.getByRole("alert").textContent).toBe(FOLLOW_ERRORS.email);
    const email = screen.getByLabelText(words.emailLabel) as HTMLInputElement;
    expect(email.value).toBe("maya@");
    expect(email.getAttribute("aria-invalid")).toBe("true");
  });

  it("in the console's preview nothing can be typed or sent", () => {
    render(<ProjectFollowForm name="Northwind Skincare" preview />);
    expect(document.querySelector("form")).toBeNull();
    expect((screen.getByLabelText(words.emailLabel) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Follow" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
