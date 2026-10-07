import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityLink, EntityLinkProvider } from "./EntityLink";
import { EntityText } from "./EntityText";
import { Markdown } from "./Markdown";
import type { EntityRenderNode } from "./entityMarkup";
import { ENTITY_IDS, NOTE_MARKDOWN, NOTE_WITH_MARKUP, resolveFixtureEntity } from "./fixtures";

describe("EntityLink", () => {
  it("renders a kind icon, the accent link and calls onOpen instead of navigating", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <EntityLink
        entity={{ id: ENTITY_IDS.sara, kind: "person", name: "Sara Lindqvist", href: "/crm/sara" }}
        onOpen={onOpen}
      />,
    );
    const link = screen.getByRole("link", { name: "Sara Lindqvist" });
    expect(link.getAttribute("data-entity-kind")).toBe("person");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.className).toContain("text-link");
    await user.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: ENTITY_IDS.sara, kind: "person" });
  });

  it("shows the hover card with facts and actions after the delay", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    render(
      <EntityLinkProvider
        value={{
          resolve: (id) => ({
            ...resolveFixtureEntity(id)!,
            actions: [{ id: "assign", label: "Assign agent", onSelect: assign }],
          }),
        }}
      >
        <EntityLink
          entity={{ id: ENTITY_IDS.nordic, kind: "organisation", name: "Nordic Beauty AB" }}
        />
      </EntityLinkProvider>,
    );
    await user.hover(screen.getByRole("link", { name: "Nordic Beauty AB" }));
    const card = await screen.findByText("Pipeline", {}, { timeout: 1500 });
    expect(card).toBeTruthy();
    expect(screen.getByText("€48,000")).toBeTruthy();
    expect(screen.getByText("Organisation")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Assign agent" }));
    expect(assign).toHaveBeenCalled();
  });

  it("offers Message / Assign agent / Add to list / Open profile on right-click", async () => {
    const user = userEvent.setup();
    const onVerb = vi.fn();
    render(
      <EntityLink
        entity={{ id: ENTITY_IDS.scout, kind: "agent", name: "Scout" }}
        onVerb={onVerb}
        hoverCard={false}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("link", { name: "Scout" }));
    expect(await screen.findByRole("menuitem", { name: "Message" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Add to list" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open profile" })).toBeTruthy();
    await user.click(screen.getByRole("menuitem", { name: "Assign agent" }));
    expect(onVerb).toHaveBeenCalledWith(
      "assign_agent",
      expect.objectContaining({ id: ENTITY_IDS.scout }),
    );
  });
});

describe("EntityText", () => {
  it("renders markup as links with kinds from the provider", () => {
    render(
      <EntityLinkProvider value={{ resolve: resolveFixtureEntity }}>
        <EntityText>{NOTE_WITH_MARKUP}</EntityText>
      </EntityLinkProvider>,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links[0]?.textContent).toContain("Scout");
    expect(links[0]?.getAttribute("data-entity-kind")).toBe("agent");
    expect(links[2]?.getAttribute("data-entity-kind")).toBe("organisation");
    expect(document.querySelector("[data-entity-text]")?.textContent).toContain(
      "closed the loop with Sara Lindqvist at Nordic Beauty AB",
    );
  });

  it("renders an ambiguous span with a Which one? chooser and a draft with an Unverified chip", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const onCreate = vi.fn();
    const nodes: EntityRenderNode[] = [
      { type: "text", text: "Spoke with " },
      {
        type: "ambiguous",
        text: "Sara",
        prompt: "Which one?",
        decoration: "dotted-underline",
        candidates: [
          { id: ENTITY_IDS.sara, name: "Sara Lindqvist", kind: "person", score: 1, tier: "exact" },
          { id: ENTITY_IDS.amara, name: "Sara Holm", kind: "person", score: 0.9, tier: "partial" },
        ],
      },
      { type: "text", text: " about " },
      { type: "draft", name: "Kalla Apotek", kindGuess: "organisation", flag: "unverified" },
      { type: "text", text: "." },
    ];
    render(
      <EntityText onResolveAmbiguous={onResolve} onCreateDraft={onCreate}>
        {nodes}
      </EntityText>,
    );
    const chooser = screen.getByRole("button", { name: "Sara: Which one?" });
    expect(chooser.className).toContain("border-dotted");
    await user.click(chooser);
    await user.click(await screen.findByRole("button", { name: /Sara Holm/ }));
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ambiguous" }),
      expect.objectContaining({ name: "Sara Holm" }),
    );
    expect(screen.getByText("Unverified")).toBeTruthy();
    expect(document.querySelector("[data-draft]")?.textContent).toContain("Kalla Apotek");
    await user.click(screen.getByRole("button", { name: "Add Kalla Apotek to the CRM" }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Kalla Apotek", kindGuess: "organisation" }),
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("Markdown", () => {
  it("renders GFM with entity links inside paragraphs, lists and strong text, and skips raw HTML", () => {
    render(
      <EntityLinkProvider value={{ resolve: resolveFixtureEntity }}>
        <Markdown>{`${NOTE_MARKDOWN}\n\n<script>alert(1)</script>`}</Markdown>
      </EntityLinkProvider>,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Nordic Beauty wants the full range",
    );
    const links = screen.getAllByRole("link");
    const entityLinks = links.filter((l) => l.hasAttribute("data-entity-id"));
    expect(entityLinks).toHaveLength(5);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("23 stores").tagName).toBe("STRONG");
    const external = screen.getByRole("link", { name: /supplier quote/ });
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toContain("noopener");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("[data-markdown]")?.className).toContain("t-reading");
    const listLink = screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes("Ledger"));
    expect(listLink?.querySelector("[data-entity-id]")).not.toBeNull();
  });
});
