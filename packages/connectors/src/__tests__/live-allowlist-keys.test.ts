import { describe, expect, it } from "vitest";
import { KNOWN_CONNECTOR_KEYS } from "@foundmill/shared";
import { BUILTIN_CONNECTOR_KEYS, CONNECTOR_KEYS } from "../catalogue";

describe("LIVE_CONNECTORS allowlist names", () => {
  it("AC-3 KNOWN_CONNECTOR_KEYS is the catalogue, the built-ins and stripe_billing, so boot validation never drifts", () => {
    expect([...KNOWN_CONNECTOR_KEYS].sort()).toEqual([...CONNECTOR_KEYS, ...BUILTIN_CONNECTOR_KEYS, "stripe_billing"].sort());
  });
});
