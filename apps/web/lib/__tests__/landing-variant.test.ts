import { describe, expect, it } from "vitest";
import { decideRedirect } from "@/lib/auth/redirects";
import { CHANNEL_VARIANTS, DEFAULT_LANDING_VARIANT, LANDING_VARIANTS, landingVariant, landingVariantRoute, landingVariantSignal } from "../landing-variant";

describe("landing variants (which page a signed-out `/` serves)", () => {
  it("a link's own lp wins, then the page this browser was given, then the link's channel, then the default", () => {
    expect(landingVariant("?lp=builder", "running")).toBe("builder");
    expect(landingVariant("?utm_source=producthunt", "running")).toBe("builder");
    expect(landingVariant("", "running")).toBe("running");
    expect(landingVariant("?utm_source=tiktok", null)).toBe(DEFAULT_LANDING_VARIANT);
    expect(landingVariant("", undefined)).toBe(DEFAULT_LANDING_VARIANT);
  });

  it("a link can ask for the default by name, which replaces an earlier page", () => {
    expect(landingVariantSignal("?lp=first")).toBe("first");
    expect(landingVariant("?lp=first", "builder")).toBe("first");
  });

  it("ignores a page or a cookie value that does not exist", () => {
    expect(landingVariantSignal("?lp=../../login")).toBeNull();
    expect(landingVariant("?lp=nope", "also-nope")).toBe(DEFAULT_LANDING_VARIANT);
  });

  it("reads the channel whatever its case, and only maps channels to pages that exist", () => {
    expect(landingVariantSignal("?utm_source=GitHub")).toBe("builder");
    for (const v of Object.values(CHANNEL_VARIANTS)) expect(LANDING_VARIANTS).toContain(v);
  });

  it("the default is `/` itself; every other page has its own prerendered route", () => {
    expect(landingVariantRoute(DEFAULT_LANDING_VARIANT)).toBeNull();
    expect(landingVariantRoute("no-idea")).toBe("/lp/no-idea");
  });
});

describe("decideRedirect: the landing page's variants", () => {
  const signedOut = (search: string, landingVariant?: string) => decideRedirect({ pathname: "/", search, authenticated: false, landingVariant });

  it("serves a variant under `/` to a signed-out visitor, and the default page as it is", () => {
    expect(signedOut("?lp=has-idea")).toEqual({ kind: "rewrite", to: "/lp/has-idea" });
    expect(signedOut("", "running")).toEqual({ kind: "rewrite", to: "/lp/running" });
    expect(signedOut("")).toEqual({ kind: "next" });
    expect(signedOut("?lp=first", "running")).toEqual({ kind: "next" });
  });

  it("an example deep link still wins, and a signed-in founder never sees a variant", () => {
    expect(signedOut("?example=glitchwick&lp=builder")).toEqual({ kind: "rewrite", to: "/examples/glitchwick" });
    expect(decideRedirect({ pathname: "/", search: "?lp=builder", authenticated: true, lastBusinessId: null })).toEqual({ kind: "rewrite", to: "/start" });
  });

  it("a variant's own route is public, so the rewrite is never bounced to sign-in", () => {
    expect(decideRedirect({ pathname: "/lp/builder", authenticated: false })).toEqual({ kind: "next" });
  });
});
