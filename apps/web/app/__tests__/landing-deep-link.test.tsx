// @vitest-environment node
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// Signed out: the page renders the landing page without asking the api anything.
vi.mock("@/lib/trpc-server", () => ({ serverApi: vi.fn(async () => null) }));
vi.mock("@/lib/auth/server", () => ({ getLastBusinessId: vi.fn(async () => null) }));
vi.mock("@/lib/auth/current-business", () => ({ pickCurrentBusiness: vi.fn(() => null) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/landing/LandingPage", () => ({ LandingPage: () => null }));

const { default: IndexPage } = await import("../page");
const { LandingPage } = await import("@/components/landing/LandingPage");

async function landingFor(query: Record<string, string | string[] | undefined>) {
  const element = (await IndexPage({ searchParams: Promise.resolve(query) })) as ReactElement<{ initialExample?: { identity: { id: string; name: string } } }>;
  expect(isValidElement(element)).toBe(true);
  expect(element.type).toBe(LandingPage);
  return element.props.initialExample;
}

describe("/?example= (the landing page's deep link)", () => {
  it("loads a non-default business on the server and hands it to the page whole", async () => {
    expect((await landingFor({ example: "glitchwick" }))?.identity.name).toBe("Glitchwick");
    const northwind = await landingFor({ example: "northwind" });
    expect(northwind?.identity.name).toBe("Northwind Skincare");
    // The whole business, as plain data, so the server render and hydration show the same content.
    expect(JSON.parse(JSON.stringify(northwind))).toEqual(northwind);
  });

  it("passes nothing for the default business, an unknown value or no value: the page's own Tutorlane", async () => {
    for (const query of [{}, { example: "tutorlane" }, { example: "acme" }, { example: ["", "northwind"] }]) expect(await landingFor(query), JSON.stringify(query)).toBeUndefined();
    expect((await landingFor({ example: ["northwind", "glitchwick"] }))?.identity.id).toBe("northwind");
  });
});
