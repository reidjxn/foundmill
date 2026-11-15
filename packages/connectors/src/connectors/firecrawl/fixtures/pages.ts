/** Deterministic pages for the mock Firecrawl connector (INTEGRATIONS_MODE=mock). Fixture content, never a real page. */
export interface MockScrape {
  title: string;
  description: string;
  markdown: string;
}

export const NORTHWIND_HOST = "northwindskincare.com";

/** Pages of the Northwind Skincare demo project, by host + path (no trailing slash). */
export const NORTHWIND_PAGES: Record<string, MockScrape> = {
  [NORTHWIND_HOST]: {
    title: "Northwind Skincare: fragrance-free skincare for sensitive skin",
    description: "Three-step fragrance-free routines for sensitive skin, shipped every quarter.",
    markdown: [
      "# Northwind Skincare",
      "",
      "Fragrance-free skincare for sensitive skin, shipped to your door every quarter.",
      "",
      "## The routine",
      "",
      "- Gentle cleanser, 150 ml",
      "- Barrier moisturizer, 50 ml",
      "- Daily mineral SPF 30, 50 ml",
      "",
      "## Pricing",
      "",
      "A quarterly refill costs $32 with free shipping over $40. Pause or skip any time.",
      "",
      "## Questions",
      "",
      "**Is it safe for eczema-prone skin?** Every formula is fragrance-free and patch-tested; ask your dermatologist if unsure.",
      "",
      "**Where do you ship?** The US and Canada.",
    ].join("\n"),
  },
  [`${NORTHWIND_HOST}/refill`]: {
    title: "Quarterly refills | Northwind Skincare",
    description: "Refill your routine every quarter for $32, with free shipping over $40.",
    markdown: ["# Quarterly refills", "", "Refills ship every quarter at $32. A bundle of two routines is $58 per quarter.", "", "Pause, skip or cancel from your account at any time."].join("\n"),
  },
};

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** The fixture for an address: a Northwind page, or a generic page built from the host and the words in the path. */
export function mockScrapeFor(url: URL): MockScrape {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");
  const known = NORTHWIND_PAGES[`${host}${path}`];
  if (known) return known;
  const words = decodeURIComponent(path).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const subject = words.length ? titleCase(words.join(" ").toLowerCase()) : "Home";
  return {
    title: `${subject} | ${host}`,
    description: `A page about ${subject.toLowerCase()} on ${host}.`,
    markdown: [`# ${subject}`, "", `This page on ${host} describes ${subject.toLowerCase()}.`, "", "It lists what the business offers, who it is for and how to get in touch."].join("\n"),
  };
}
