import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { FOLLOW_ERRORS } from "@foundmill/shared/project-page";
import { followErrorKind, followErrorState, followFormProblem, readFollowForm } from "../public-follow";

const apiError = (code: string, appCode?: string) => new TRPCClientError("the api's own words", { result: { error: { code: -32000, message: "the api's own words", data: { code, httpStatus: 400, appCode } } } } as never);

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("the public page's follow form, server half", () => {
  it("reads the four fields, bounded; the box counts only when it posts yes", () => {
    expect(readFollowForm(form({ slug: " northwind ", email: "  maya@example.com ", consent: "yes", website: "" }))).toEqual({ slug: "northwind", email: "maya@example.com", consent: true, website: "" });
    expect(readFollowForm(form({ slug: "n", email: "x".repeat(1000), consent: "on" }))).toMatchObject({ consent: false, website: "" });
    expect(readFollowForm(form({ slug: "n", email: "x".repeat(1000) })).email.length).toBeLessThanOrEqual(264);
  });

  it("an empty address or an unticked box is answered before the api, keeping the address", () => {
    expect(followFormProblem({ slug: "n", email: "", consent: true, website: "" })).toEqual({ status: "error", field: "email", message: FOLLOW_ERRORS.email, email: "" });
    expect(followFormProblem({ slug: "n", email: "maya@example.com", consent: false, website: "" })).toEqual({ status: "error", field: "consent", message: FOLLOW_ERRORS.consent, email: "maya@example.com" });
    expect(followFormProblem({ slug: "n", email: "maya@example.com", consent: true, website: "" })).toBeNull();
  });

  it("turns the api's refusals into the shared sentences, never the api's message", () => {
    expect(followErrorKind(apiError("BAD_REQUEST", "follow_email"))).toBe("email");
    expect(followErrorKind(apiError("BAD_REQUEST", "follow_consent"))).toBe("consent");
    expect(followErrorKind(apiError("NOT_FOUND", "follow_closed"))).toBe("closed");
    expect(followErrorKind(apiError("TOO_MANY_REQUESTS", "rate_limited"))).toBe("busy");
    expect(followErrorKind(apiError("INTERNAL_SERVER_ERROR"))).toBe("failed");
    expect(followErrorKind(new Error("network down"))).toBe("failed");
    const state = followErrorState(apiError("TOO_MANY_REQUESTS", "rate_limited"), "maya@example.com");
    expect(state).toEqual({ status: "error", field: null, message: FOLLOW_ERRORS.busy, email: "maya@example.com" });
    expect(JSON.stringify(state)).not.toContain("the api's own words");
  });
});
