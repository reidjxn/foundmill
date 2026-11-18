import { afterEach, describe, expect, it } from "vitest";
import { kitOnPrimaryDetail } from "@foundmill/dugout";
import { CHANNEL_KEYS, MODULE_TABS } from "@foundmill/shared/constants";
import { checkLogo, isLogoDataUrl, parseLogoDataUrl, utf8Decode, base64ToBytes } from "@foundmill/shared/logo";
import {
  DEFAULT_EXAMPLE,
  DEFAULT_EXAMPLE_ID,
  EXAMPLE_IDENTITIES,
  EXAMPLE_IDS,
  exampleSearch,
  isExampleId,
  loadExample,
  parseExampleId,
  peekExample,
  prefetchExample,
  rememberExample,
  resetExampleCache,
  type ExampleBusiness,
} from "../examples";
import { PIN_LABEL_MAX } from "@foundmill/dugout/components/journey/ribbon/geometry";
import { LARGE_ORDER_MINOR, channelProfile, departmentScreens, exampleChannels, exampleJourney, exampleMoney, orbitDepartments } from "../examples/helpers";

afterEach(() => resetExampleCache());

/** The fixture's Ribbon department ids (packages/dugout journey fixtures): revenue comes from d-distribution. */
const FIXTURE_RIBBON_IDS = ["d-product", "d-development", "d-distribution", "d-finance", "d-team", "d-operations"];

describe("the example registry", () => {
  it("offers Tutorlane, Glitchwick and Northwind Skincare, in that order, Tutorlane by default", () => {
    expect(EXAMPLE_IDS).toEqual(["tutorlane", "glitchwick", "northwind"]);
    expect(DEFAULT_EXAMPLE_ID).toBe("tutorlane");
    expect(DEFAULT_EXAMPLE.identity.name).toBe("Tutorlane");
    expect(EXAMPLE_IDS.map((id) => EXAMPLE_IDENTITIES[id].name)).toEqual(["Tutorlane", "Glitchwick", "Northwind Skincare"]);
    expect(EXAMPLE_IDS.map((id) => EXAMPLE_IDENTITIES[id].vertical)).toEqual(["Education software", "Developer tools", "Consumer brand"]);
  });

  it("gives every business a picker identity: a checked logo, brand colours that pass, a short vertical and one line", () => {
    for (const id of EXAMPLE_IDS) {
      const identity = EXAMPLE_IDENTITIES[id];
      expect(identity.id).toBe(id);
      expect(identity.vertical.split(" ").length, id).toBeGreaterThanOrEqual(2);
      expect(identity.vertical.split(" ").length, id).toBeLessThanOrEqual(3);
      expect(identity.description.length, id).toBeGreaterThan(30);
      expect(identity.description, id).not.toContain("\n");
      expect(identity.monogram).toMatch(/^[A-Z]{1,2}$/);
      expect(isLogoDataUrl(identity.logo), id).toBe(true);
      // The mark is what checkLogo would store: nothing stripped, byte for byte.
      const parsed = parseLogoDataUrl(identity.logo)!;
      const svg = utf8Decode(base64ToBytes(parsed.base64)!)!;
      const checked = checkLogo({ mime: "image/svg+xml", svg });
      expect(checked.ok && checked.logo.dataUrl, id).toBe(identity.logo);
      expect(identity.kit.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(kitOnPrimaryDetail(identity.kit.primary).passes, `${id} on-primary contrast`).toBe(true);
    }
    // The three are told apart by their marks: no two share a logo.
    expect(new Set(EXAMPLE_IDS.map((id) => EXAMPLE_IDENTITIES[id].logo)).size).toBe(3);
    // Northwind wears the founder's own Northwind colours (packages/db/src/seed/northwind.ts).
    expect(EXAMPLE_IDENTITIES.northwind.kit).toEqual({ primary: "#2f6f5e", secondary: "#f2c94c" });
  });

  it("parses a deep link's value, falling back to the default for anything else", () => {
    expect(parseExampleId("glitchwick")).toBe("glitchwick");
    expect(parseExampleId(" Northwind ")).toBe("northwind");
    expect(parseExampleId(["northwind", "glitchwick"])).toBe("northwind");
    for (const bad of [undefined, null, "", "acme", "__proto__", "tutorlane2", []]) expect(parseExampleId(bad as never)).toBe("tutorlane");
    expect(isExampleId("glitchwick")).toBe(true);
    expect(isExampleId("Glitchwick")).toBe(false);
  });

  it("writes the choice into the query string, keeping other parameters; the default has none", () => {
    expect(exampleSearch("glitchwick")).toBe("?example=glitchwick");
    expect(exampleSearch("northwind", "?example=glitchwick&utm=x")).toBe("?example=northwind&utm=x");
    expect(exampleSearch("tutorlane", "?example=glitchwick&utm=x")).toBe("?utm=x");
    expect(exampleSearch("tutorlane", "?example=northwind")).toBe("");
  });

  it("keeps Tutorlane loaded, loads the others once on demand, and remembers a business it is handed", async () => {
    expect(peekExample("tutorlane")).toBe(DEFAULT_EXAMPLE);
    expect(peekExample("glitchwick")).toBeUndefined();
    const [a, b] = [loadExample("glitchwick"), loadExample("glitchwick")];
    expect(a).toBe(b);
    const glitchwick = await a;
    expect(peekExample("glitchwick")).toBe(glitchwick);
    expect(await loadExample("glitchwick")).toBe(glitchwick);

    prefetchExample("northwind");
    await expect.poll(() => peekExample("northwind")?.identity.name).toBe("Northwind Skincare");

    resetExampleCache();
    const handed = { ...glitchwick };
    rememberExample(handed);
    expect(peekExample("glitchwick")).toBe(handed);
  });
});

describe.each(EXAMPLE_IDS)("example business %s", (id) => {
  let business: ExampleBusiness;
  const load = async () => (business = await loadExample(id));

  it("is the identity the picker shows, a US business in dollars, and plain data the server can hand down", async () => {
    await load();
    expect(business.identity).toEqual(EXAMPLE_IDENTITIES[id]);
    expect(business.currency).toBe("USD");
    expect(business.locale).toBe("en-US");
    expect(JSON.parse(JSON.stringify(business))).toEqual(business);
    const text = JSON.stringify(business);
    for (const gone of ["£", "€", "US$", "GBP", "EUR", "Maths", "colour"]) expect(text, gone).not.toContain(gone);
    expect(exampleMoney(business, 4200)).toBe("$42.00");
  });

  it("has six departments (labels over modules) with one lead each, in the same order, and their real screens", async () => {
    await load();
    const ids = business.departments.map((d) => d.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(business.leads.map((l) => l.department)).toEqual(ids);
    for (const d of business.departments) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(Object.keys(MODULE_TABS)).toContain(d.module);
      const screens = departmentScreens(d);
      expect(screens.length, d.id).toBeGreaterThan(0);
      if (d.screens) expect(screens.map((s) => s.slug)).toEqual(d.screens);
      expect(d.workers.length).toBeGreaterThan(0);
    }
    for (const lead of business.leads) {
      expect(lead.skills.length).toBe(6);
      expect(lead.traits.length).toBeGreaterThanOrEqual(2);
      expect(lead.stars.current).toBeLessThanOrEqual(lead.stars.potential);
    }
    // The team orbit draws every department with its lead.
    expect(orbitDepartments(business).map((d) => d.name)).toEqual(business.departments.map((d) => d.label));
  });

  it("runs the hero deck: first the customer the Customer Update is about (a win, WP-14 T10), then a decision", async () => {
    await load();
    const [first, second] = business.deck.outcomes;
    expect(first?.kind).toBe("win");
    expect(second?.kind).toBe("decision");
    if (first?.kind === "win") expect(first.customer).toBe(business.customerUpdate.customer.name);
    for (const o of business.deck.outcomes) {
      if (o.kind !== "decision") continue;
      expect(o.options.length).toBeGreaterThanOrEqual(2);
      expect(o.options.filter((x) => x.recommended)).toHaveLength(1);
    }
    expect(business.deck.startCycle).toBeGreaterThan(0);
    expect(business.deck.costPerTaskMinor).toBeGreaterThan(0);
    expect(business.activity.length).toBeGreaterThanOrEqual(8);
  });

  it("has How it works' concepts, six brand options and a cycle plan over its own departments", async () => {
    await load();
    const [front, back] = business.howItWorks.concepts;
    expect(front?.name).toBe(business.identity.name);
    expect(front?.logoSrc).toBe(business.identity.logo);
    expect(back).toBeTruthy();
    expect(business.howItWorks.brandOptions).toHaveLength(6);
    expect(business.howItWorks.brandOptions[0]).toEqual({ logo: business.identity.logo, kit: business.identity.kit });
    const departments = business.departments.map((d) => d.id);
    for (const p of business.howItWorks.firstCyclePlan) expect(departments).toContain(p.department);
  });

  it("has live sessions, all fifteen channels with four on the board, and a two-year Journey in its own words", async () => {
    await load();
    expect(business.sessions.tasks.length).toBeGreaterThanOrEqual(4);
    expect(business.sessions.currency).toBe("USD");
    expect(Object.keys(business.channels.fits).sort()).toEqual([...CHANNEL_KEYS].sort());
    for (const fit of Object.values(business.channels.fits)) expect(fit >= 1 && fit <= 20).toBe(true);
    expect(business.channels.recommended).toHaveLength(4);
    expect(business.channels.why).toContain("{channel}");
    expect(channelProfile(business).why("SEO")).toMatch(/^SEO /);
    const board = exampleChannels(business);
    expect(board.filter((c) => c.enabled).map((c) => c.key).sort()).toEqual([...business.channels.recommended].sort());

    expect(business.journey.ribbonDepartments.map((d) => d.id)).toEqual(FIXTURE_RIBBON_IDS);
    const labels = business.departments.map((d) => d.label);
    for (const d of business.journey.ribbonDepartments) expect(labels).toContain(d.name);
    expect(business.journey.roadmap).toHaveLength(3);
    const journey = exampleJourney(business);
    const names = [...business.journey.customerNames, ...business.journey.customers.large.map((p) => p.name), business.journey.updatePayment.name, ...business.milestones.flatMap((m) => (m.customerName ? [m.customerName] : []))];
    expect(journey.conversions.every((c) => c.currency === "USD" && names.includes(c.entityName ?? ""))).toBe(true);
    const milestoneText = journey.milestones.map((m) => m.label).join(" | ");
    expect(milestoneText).not.toMatch(/€|Northwind Skincare AB|Retinol serum|Meridian Labs/);
    expect(journey.milestones.find((m) => m.kind === "incorporation")?.label).toMatch(/incorporated/i);
    // Every pin reads whole on the Ribbon: past PIN_LABEL_MAX characters its label is cut with an ellipsis.
    for (const m of journey.milestones) expect(m.label.length, m.label).toBeLessThanOrEqual(PIN_LABEL_MAX);
  });

  it("has a Customer Update, milestones and an Inbox note that hold together", async () => {
    await load();
    const u = business.customerUpdate;
    expect(u.commentary.some((c) => c.text.includes(`[[ent:${u.customer.entityId}|${u.customer.name}]]`))).toBe(true);
    expect(u.agents.filter((a) => a.standout)).toHaveLength(1);
    expect(u.customer.facts).toHaveLength(3);
    expect(business.milestones.length).toBeGreaterThanOrEqual(4);
    for (const m of business.milestones) {
      expect(m.achievedAt).toMatch(/T12:00:00$/);
      if (m.amountMinor != null) expect(m.currency).toBe("USD");
    }
    const note = business.inboxNote;
    expect(business.departments.map((d) => d.label)).toContain(note.department);
    expect(note.options.length).toBeGreaterThanOrEqual(2);
    expect(note.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(note.paragraphs.join(" ")).toContain(exampleMoney(business, note.costMinor).replace(".00", ""));
  });
});

describe("Northwind Skincare", () => {
  it("renames departments the way the founder's account does: Formulation Lab and Retail Partnerships", async () => {
    const northwind = await loadExample("northwind");
    const lab = northwind.departments.find((d) => d.label === "Formulation Lab");
    const retail = northwind.departments.find((d) => d.label === "Retail Partnerships");
    expect(lab).toMatchObject({ module: "development", icon: "lab" });
    expect(departmentScreens(lab!).map((s) => s.title)).toContain("Specialists");
    expect(retail).toMatchObject({ module: "distribution" });
    expect(northwind.departments.map((d) => d.label)).not.toContain("Distribution");
  });

  it("puts every milestone card on its Ribbon pin's day, with revenue that bears out the $10K and $50K months", async () => {
    const northwind = await loadExample("northwind");
    const journey = exampleJourney(northwind);
    const pins = new Map(journey.milestones.map((m) => [m.label, m]));
    for (const card of northwind.milestones) expect(pins.get(card.label)?.achievedAt.slice(0, 10), card.label).toBe(card.achievedAt?.slice(0, 10));
    // The first retail partner is the store whose opening order the Ribbon records that day, at the same value.
    const partner = journey.conversions.find((c) => c.id === pins.get("First retail partner")?.ref?.conversionId);
    const card = northwind.milestones.find((m) => m.key === "first_retail_partner");
    expect(partner?.entityName).toBe("Oak Hill Pharmacy");
    expect(card).toMatchObject({ customerName: partner?.entityName, amountMinor: partner?.amountMinor });
    // "$10K month" and "$50K month" are 30 days of sales, crossed in the month before the pin.
    const days = journey.rows.filter((r) => r.departmentId === null);
    const thirtyDays = (day: string) => {
      const i = days.findIndex((r) => r.day === day);
      return days.slice(i - 29, i + 1).reduce((sum, r) => sum + r.revenueMinor, 0);
    };
    expect(thirtyDays("2025-02-20")).toBeLessThan(1_000_000);
    expect(thirtyDays("2025-03-20")).toBeGreaterThanOrEqual(1_000_000);
    expect(thirtyDays("2026-08-18")).toBeLessThan(5_000_000);
    expect(thirtyDays("2026-09-18")).toBeGreaterThanOrEqual(5_000_000);
  });

  it("orders on the Ribbon are skincare-sized: shoppers spend $24 to $84, and the large orders come from stores", async () => {
    const northwind = await loadExample("northwind");
    const payments = exampleJourney(northwind).conversions.filter((c) => c.kind === "payment");
    const stores = [...northwind.journey.customers.large.map((p) => p.name), northwind.journey.updatePayment.name, ...northwind.milestones.flatMap((m) => (m.customerName ? [m.customerName] : []))];
    expect(stores.length).toBeGreaterThan(0);
    for (const p of payments) {
      if (stores.includes(p.entityName ?? "")) expect(p.amountMinor, p.entityName ?? "").toBeGreaterThanOrEqual(LARGE_ORDER_MINOR);
      else expect(p.amountMinor, p.entityName ?? "").toBeLessThan(15_000);
    }
    // The 36-store chain's opening order is on the Ribbon at the update's value, and no other store's order outgrows it.
    const chainOrder = 1_663_200;
    expect(northwind.customerUpdate.commentary.map((c) => c.text).join(" ")).toContain(exampleMoney(northwind, chainOrder).replace(".00", ""));
    expect(payments.filter((p) => p.amountMinor >= chainOrder).map((p) => [p.entityName, p.amountMinor])).toEqual([["Larkfield Market", chainOrder]]);
  });

  it("reads whole in the narrowest places: the Ribbon's day card, the cycle 1 plan's rows and the deck's Inbox lines", async () => {
    const northwind = await loadExample("northwind");
    // The day card puts the chapter title beside a date such as "Wed 15 Oct 2025": 17 characters fit.
    for (const title of northwind.journey.chapterTitles) expect(title.length, title).toBeLessThanOrEqual(17);
    // A plan row is about 175 px wide at 1280 px: 27 characters fit.
    for (const p of northwind.howItWorks.firstCyclePlan) expect(p.task.length, p.task).toBeLessThanOrEqual(27);
    // The day card lists a customer beside the order's value: 17 characters fit.
    for (const name of [...northwind.journey.customerNames, ...northwind.journey.customers.large.map((p) => p.name)]) expect(name.length, name).toBeLessThanOrEqual(17);
    // A decision's Inbox line in the deck is one line of a 21rem column.
    for (const o of northwind.deck.outcomes) if (o.kind === "decision") for (const opt of o.options) expect(opt.done.length, opt.done).toBeLessThanOrEqual(30);
  });
});
