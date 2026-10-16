// @vitest-environment node
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { exampleRoute } from "@/components/landing/examples";

// The landing routes are prerendered: they must render without asking the api or reading a cookie.
vi.mock("@/lib/trpc-server", () => ({ serverApi: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/components/landing/LandingPage", () => ({ LandingPage: () => null }));

const { default: IndexPage, revalidate: indexRevalidate } = await import("../page");
const examplesRoute = await import("../examples/[id]/page");
const { default: StartPage } = await import("../start/page");
const { LandingPage } = await import("@/components/landing/LandingPage");
const { serverApi } = await import("@/lib/trpc-server");

type LandingProps = { initialExample?: { identity: { id: string; name: string } }; renderDay?: string };

function landingProps(element: unknown): LandingProps {
  expect(isValidElement(element)).toBe(true);
  expect((element as ReactElement).type).toBe(LandingPage);
  return (element as ReactElement<LandingProps>).props;
}

describe("`/` (the signed-out landing page, prerendered)", () => {
  it("renders the default business with the day it was rendered on, and regenerates hourly", () => {
    const props = landingProps(IndexPage());
    expect(props.initialExample).toBeUndefined();
    expect(props.renderDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(indexRevalidate).toBe(3600);
    expect(serverApi).not.toHaveBeenCalled();
  });
});

describe("/?example= (the landing page's deep link)", () => {
  it("is served from the business's own prerendered page: the proxy's rewrite target for each business but the default", () => {
    expect(exampleRoute("?example=glitchwick")).toBe("/examples/glitchwick");
    expect(exampleRoute("?example=%20Northwind%20")).toBe("/examples/northwind");
    expect(exampleRoute("?example=northwind&example=glitchwick")).toBe("/examples/northwind");
    for (const search of ["", "?example=tutorlane", "?example=acme", "?example=&example=northwind", "?other=northwind"]) expect(exampleRoute(search), search).toBeNull();
    expect(examplesRoute.generateStaticParams()).toEqual([{ id: "glitchwick" }, { id: "northwind" }]);
    expect(examplesRoute.dynamicParams).toBe(false);
  });

  it("loads the business on the server and hands it to the page whole", async () => {
    const props = landingProps(await examplesRoute.default({ params: Promise.resolve({ id: "glitchwick" }) }));
    expect(props.initialExample?.identity.name).toBe("Glitchwick");
    const northwind = landingProps(await examplesRoute.default({ params: Promise.resolve({ id: "northwind" }) })).initialExample;
    expect(northwind?.identity.name).toBe("Northwind Skincare");
    // The whole business, as plain data, so the server render and hydration show the same content.
    expect(JSON.parse(JSON.stringify(northwind))).toEqual(northwind);
    await expect(examplesRoute.default({ params: Promise.resolve({ id: "tutorlane" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/start (the signed-in index the proxy serves for `/`)", () => {
  it("shows the landing page, never a redirect that could loop, when the session did not hold up on the server", async () => {
    landingProps(await StartPage());
  });
});
