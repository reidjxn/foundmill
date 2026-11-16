/**
 * WP-05 T12: which of an agent's connectors the gateway would refuse for this project (`unusableConnectors`), told to the
 * agent before it starts and used to skip a session that cannot do anything real. It is the gateway's own rule
 * (`connectionRefused`, apps/gateway pipeline.ts `connectionRefusal`): an account-free connector in mock mode on a real
 * project, a sign-in connector with no connection when live, or with none or only a `mock` row in mock mode.
 */
import { describe, expect, it } from "vitest";
import { connectionRefused, unusableConnectors, type ChannelAvailabilityFacts } from "../channel-availability";

const realProject = (over: Partial<ChannelAvailabilityFacts> = {}): ChannelAvailabilityFacts => ({ liveConnectors: [], connectedConnectors: [], mockResultsAllowed: false, ...over });

describe("unusableConnectors", () => {
  it("lists an account-free connector in mock mode on a real project, and a sign-in connector nobody connected", () => {
    expect(unusableConnectors(["platform", "web", "google_drive", "quarantine"], realProject())).toEqual(["web", "google_drive"]);
  });

  it("never lists platform or quarantine, whatever the facts", () => {
    expect(unusableConnectors(["platform", "quarantine"], realProject())).toEqual([]);
    expect(unusableConnectors(["platform", "quarantine"], realProject({ liveConnectors: "all" }))).toEqual([]);
  });

  it("lists nothing where simulated results are allowed and the connectors run in mock mode (a sample business, development, test)", () => {
    expect(unusableConnectors(["web", "google_drive", "ecb_rates", "github"], realProject({ mockResultsAllowed: true }))).toEqual([]);
  });

  it("an account-free connector that is live here is usable; a sign-in connector that is live needs a connection", () => {
    expect(unusableConnectors(["web", "google_drive"], realProject({ liveConnectors: ["web", "google_drive"] }))).toEqual(["google_drive"]);
    expect(unusableConnectors(["web", "google_drive"], realProject({ liveConnectors: "all", connectedConnectors: ["google_drive"] }))).toEqual([]);
    // Live means connected or not, even for a sample business: the gateway refuses a live call with no connection.
    expect(unusableConnectors(["google_drive"], realProject({ liveConnectors: "all", mockResultsAllowed: true }))).toEqual(["google_drive"]);
  });

  it("a connected sign-in connector in mock mode is usable (its row is not a mock one)", () => {
    expect(unusableConnectors(["github"], realProject({ connectedConnectors: ["github"] }))).toEqual([]);
  });

  it("leaves the connectors that refuse a simulated send by themselves to them (platform_mail)", () => {
    expect(unusableConnectors(["platform_mail"], realProject())).toEqual([]);
  });

  it("skips a key no connector serves (the gateway answers that with a 404, not as not connected) and repeats nothing", () => {
    expect(unusableConnectors(["no_such_connector", "web", "web"], realProject())).toEqual(["web"]);
  });
});

describe("connectionRefused (the gateway's two 409 branches)", () => {
  const base = { mode: "mock" as const, mockResultsAllowed: false, integrationStatus: null };
  it("account-free: refused only in mock mode on a real project, and never for a self-refusing connector", () => {
    expect(connectionRefused("web", { ...base, accountFree: true })).toBe(true);
    expect(connectionRefused("web", { ...base, accountFree: true, mode: "live" })).toBe(false);
    expect(connectionRefused("web", { ...base, accountFree: true, mockResultsAllowed: true })).toBe(false);
    expect(connectionRefused("platform_mail", { ...base, accountFree: true })).toBe(false);
  });
  it("sign-in, live: refused with no row, whatever its status otherwise", () => {
    expect(connectionRefused("stripe", { ...base, accountFree: false, mode: "live" })).toBe(true);
    expect(connectionRefused("stripe", { ...base, accountFree: false, mode: "live", mockResultsAllowed: true })).toBe(true);
    expect(connectionRefused("stripe", { ...base, accountFree: false, mode: "live", integrationStatus: "mock" })).toBe(false);
  });
  it("sign-in, mock: refused with no row or a mock row on a real project", () => {
    expect(connectionRefused("stripe", { ...base, accountFree: false })).toBe(true);
    expect(connectionRefused("stripe", { ...base, accountFree: false, integrationStatus: "mock" })).toBe(true);
    expect(connectionRefused("stripe", { ...base, accountFree: false, integrationStatus: "connected" })).toBe(false);
    expect(connectionRefused("stripe", { ...base, accountFree: false, mockResultsAllowed: true })).toBe(false);
  });
});
