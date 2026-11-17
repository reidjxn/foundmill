import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME } from "@foundmill/config";
import { CustomerUpdateCard, updateCardChannelLabel, updateCardDay, type CustomerUpdateCardProps } from "./CustomerUpdateCard";

const props: CustomerUpdateCardProps = {
  name: "Northwind Skincare",
  headline: "new_customer",
  occurredOn: "2026-11-12",
  leadChannelKey: "seo",
  standoutAgent: "Search Writer",
  brandPrimary: "#2f7d6b",
  brandSecondary: "#f4efe6",
  pageHref: "/p/northwind",
  startHref: "/?via=p.northwind",
};

describe("CustomerUpdateCard", () => {
  it("shows the project, the headline, the US date as that calendar day and \"Verified by Foundmill\" with what it means", () => {
    render(<CustomerUpdateCard {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "New customer" })).toBeTruthy();
    expect(document.querySelector("[data-project-name]")!.textContent).toBe("Northwind Skincare");
    const time = document.querySelector("time")!;
    expect(time.textContent).toBe("Nov 12, 2026");
    // A date, never a time of day.
    expect(time.getAttribute("dateTime")).toBe("2026-11-12");
    expect(document.querySelector("[data-verified]")!.textContent).toBe(`Verified by ${APP_NAME}`);
    expect(screen.getByText(`${APP_NAME} recorded this when the project's payment provider reported the payment. It was not typed in.`)).toBeTruthy();
  });

  it("names the lead channel by its display name and the standout agent as an AI agent", () => {
    render(<CustomerUpdateCard {...props} />);
    expect(screen.getByText("Lead channel")).toBeTruthy();
    expect(document.querySelector("[data-update-channel]")!.textContent).toBe(updateCardChannelLabel("seo"));
    expect(screen.getByText("Standout agent")).toBeTruthy();
    expect(document.querySelector("[data-update-agent]")!.textContent).toBe("Search Writer (AI agent)");
  });

  it("leaves out a line it has nothing true to say on: no channel, no agent, an unknown key", () => {
    const { rerender } = render(<CustomerUpdateCard {...props} leadChannelKey={null} standoutAgent={null} />);
    expect(document.querySelector("[data-update-facts]")).toBeNull();
    rerender(<CustomerUpdateCard {...props} leadChannelKey="constructor" standoutAgent="  " />);
    expect(document.querySelector("[data-update-facts]")).toBeNull();
    expect(updateCardChannelLabel("not_a_channel")).toBeNull();
    expect(updateCardChannelLabel("__proto__")).toBeNull();
  });

  it("sets the founders' own line apart and names it as theirs; without one there is no such block", () => {
    const { rerender } = render(<CustomerUpdateCard {...props} />);
    expect(document.querySelector("[data-update-note]")).toBeNull();
    rerender(<CustomerUpdateCard {...props} note="Our first order from outside our own town." />);
    const note = document.querySelector("[data-update-note]")!;
    expect(note.querySelector("figcaption")!.textContent).toBe("A note from Northwind Skincare");
    expect(note.querySelector("blockquote")!.textContent).toBe("Our first order from outside our own town.");
    // The note is outside the block that says "Verified".
    expect(document.querySelector("[data-card-fact]")!.contains(note)).toBe(false);
  });

  it("prints a note as text, never as markup", () => {
    const html = renderToStaticMarkup(<CustomerUpdateCard {...props} note={'<img src=x onerror="alert(1)"> [[ent:1|Sam]] https://evil.example'} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html.match(/<a /g)!.length).toBe(2);
  });

  it("carries no number but the date: nothing is counted", () => {
    render(<CustomerUpdateCard {...props} headline="returning_customer" />);
    expect(screen.getByRole("heading", { level: 1, name: "A customer came back" })).toBeTruthy();
    const text = document.body.textContent!.replace("Nov 12, 2026", "");
    expect(text).not.toMatch(/\d/);
  });

  it("draws the foot by the mark: a visitor gets the link, a member the sentence alone, none nothing; verified stays", () => {
    const { rerender } = render(<CustomerUpdateCard {...props} />);
    expect(document.querySelector('[data-project-mark="visitor"] a')!.getAttribute("href")).toBe("/?via=p.northwind");
    rerender(<CustomerUpdateCard {...props} mark="member" />);
    expect(document.querySelector('[data-project-mark="member"] a')).toBeNull();
    rerender(<CustomerUpdateCard {...props} mark="none" />);
    expect(document.querySelector("[data-project-mark]")).toBeNull();
    expect(document.querySelector("[data-verified]")).not.toBeNull();
  });

  it("is one main landmark as a page and an article as a preview, and links back to the project's page", () => {
    const { rerender } = render(<CustomerUpdateCard {...props} />);
    expect(document.querySelectorAll("main").length).toBe(1);
    expect(document.querySelector("[data-card-project]")!.getAttribute("href")).toBe("/p/northwind");
    rerender(<CustomerUpdateCard {...props} variant="preview" />);
    expect(document.querySelector("main")).toBeNull();
    expect(document.querySelector("article")).not.toBeNull();
  });

  it("reads a day as that day, and refuses anything that is not one", () => {
    expect(updateCardDay("2026-01-01")!.getDate()).toBe(1);
    expect(updateCardDay("2026-01-01")!.getMonth()).toBe(0);
    expect(updateCardDay("2026-11-12T15:30:00Z")).toBeNull();
    expect(updateCardDay("yesterday")).toBeNull();
  });
});
