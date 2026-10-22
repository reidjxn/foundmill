import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityLink, EntityLinkProvider } from "./EntityLink";
import { EntityText } from "./EntityText";
import { Markdown, preloadMarkdown } from "./Markdown";
import type { EntityRenderNode } from "./entityMarkup";
import { ENTITY_IDS, NOTE_MARKDOWN, NOTE_WITH_MARKUP, resolveFixtureEntity } from "./fixtures";

describe("EntityLink", () => {
  it("renders plain underlined text in the surrounding colour (no kind icon) and calls onOpen instead of navigating", async () => {
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
    // Founder rule (2026-10-09): no icon inside an entity link; the text keeps the sentence's colour and is underlined.
    expect(link.querySelector("svg")).toBeNull();
    expect(link.textContent).toBe("Sara Lindqvist");
    expect(link.className).toContain("entity-link");
    expect(link.className).not.toContain("text-link");
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
    const card = await screen.findByText("Open deals", {}, { timeout: 1500 });
    expect(card).toBeTruthy();
    expect(screen.getByText("€48,000")).toBeTruthy();
    expect(screen.getByText("Organization")).toBeTruthy();
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

  it("never links an id the provider knows is not an entity here: it reads as its name (audit FR-23)", () => {
    const id = ENTITY_IDS.sara;
    const text = `Ask [[ent:${id}|Sara Lindqvist]] or [[ent:00000000-0000-4000-8000-000000000000|Fake Co]] today.`;
    const known = (e: string) => (e === id ? true : false);
    const { unmount } = render(
      <EntityLinkProvider value={{ resolve: resolveFixtureEntity, exists: known }}>
        <EntityText>{text}</EntityText>
      </EntityLinkProvider>,
    );
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Sara Lindqvist"]);
    expect(document.querySelector("[data-entity-text]")?.textContent).toBe("Ask Sara Lindqvist or Fake Co today.");
    unmount();
    // Not known yet (nothing looked up): the mention still links, so it never flickers out while a lookup is under way.
    render(
      <EntityLinkProvider value={{ resolve: resolveFixtureEntity, exists: () => undefined }}>
        <EntityText>{text}</EntityText>
      </EntityLinkProvider>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
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
  // The parser is its own chunk; these tests are about what it renders once in.
  beforeAll(() => preloadMarkdown());

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

  it("links entity mentions unless asked not to; with entities off nothing is ever linked, however the mention is written", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const tricky = [
      `Plain [[ent:${id}|Acme Ltd]] mention`,
      `- list [[ent:${id}|Acme Ltd]]`,
      `**bold [[ent:${id}|Acme Ltd]]** and _em [[ent:${id}|Acme Ltd]]_`,
      `| a |\n| - |\n| [[ent:${id}|Acme Ltd]] |`,
      `escaped \\[[ent:${id}|Acme Ltd]]`,
      `&#91;&#91;ent:${id}|Acme Ltd]]`,
      `[[ent:[[ent:${id}|Acme Ltd]]|Nested]]`,
    ];
    const provider = (ui: React.ReactElement) => <EntityLinkProvider value={{ resolve: resolveFixtureEntity }}>{ui}</EntityLinkProvider>;
    const on = render(provider(<Markdown variant="body">{tricky[0]!}</Markdown>));
    expect(document.querySelectorAll("[data-entity-id]").length).toBe(1);
    on.unmount();
    for (const text of tricky) {
      const { unmount } = render(
        provider(
          <Markdown variant="body" entities={false}>
            {text}
          </Markdown>,
        ),
      );
      expect(document.querySelector("[data-entity-id]"), text).toBeNull();
      expect(screen.queryAllByRole("link"), text).toHaveLength(0);
      unmount();
    }
    render(
      provider(
        <Markdown variant="body" entities={false}>
          {tricky[0]!}
        </Markdown>,
      ),
    );
    expect(document.querySelector("[data-markdown]")?.textContent).toBe(`Plain [[ent:${id}|Acme Ltd]] mention`);
  });

  it("loads images unless asked not to; without images the alt text stands in and nothing is fetched", () => {
    const text = "Look: ![the chart](https://stranger.example/pixel.png) done";
    const { unmount } = render(<Markdown variant="body">{text}</Markdown>);
    expect(document.querySelector("img")?.getAttribute("src")).toBe("https://stranger.example/pixel.png");
    unmount();
    render(
      <Markdown variant="body" images={false}>
        {text}
      </Markdown>,
    );
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("the chart")).toBeTruthy();
  });
});
