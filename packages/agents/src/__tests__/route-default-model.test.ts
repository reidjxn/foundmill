import { ROUTES } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { ROUTE_DEFAULT_MODEL } from "../types";

describe("ROUTE_DEFAULT_MODEL", () => {
  it("mirrors the model of every route in packages/models (WP-09 T6)", () => {
    expect(ROUTE_DEFAULT_MODEL).toEqual(Object.fromEntries(Object.entries(ROUTES).map(([route, def]) => [route, def.model])));
  });
});
