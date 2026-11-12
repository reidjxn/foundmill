import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { FOLLOW_ERRORS, followWords } from "@foundmill/shared/project-page";
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
