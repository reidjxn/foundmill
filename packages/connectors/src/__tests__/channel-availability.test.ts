/**
 * Which channels can really act (founder, 2026-11-11). The acting-tools table must name only tools a connector serves
 * (and never a route-only or service-only one, which no agent holds), the channels without a publisher are pinned here
 * so adding one is a deliberate edit, and `channelAvailability` answers each of its five reasons. The fifth, `by_tap`
 * (founder, 2026-11-12), is the social channel's alone: available with no connector because the founder posts each draft
 * with one press, never a channel the team runs, and second to `acts`.
 */
import { CHANNEL_BY_TAP_SENTENCE, CHANNEL_KEYS, CHANNELS_SHARED_BY_TAP, TAP_POST_NETWORKS, channelEngineMayRun, channelMayRun, channelTeamRuns, type ChannelKey } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { createAllConnectors, createBuiltinConnectors } from "../catalogue";
import { ACTING_CONNECTOR_NAMES, CHANNEL_ACTING_TOOLS, channelAvailabilities, channelAvailability, channelAvailabilityFacts, channelAvailabilityRows, channelRefusal, everyChannelAvailable, firstChannelToOpen, type ChannelAvailabilityFacts } from "../channel-availability";
import { GATEWAY_TOOL_NAMES, isRouteOnlyTool, isServiceOnlyConnector } from "../grants";

describe("CHANNEL_ACTING_TOOLS", () => {
  it("has an entry for every channel and no other key", () => {
    expect(Object.keys(CHANNEL_ACTING_TOOLS).sort()).toEqual([...CHANNEL_KEYS].sort());
  });

  it("names only tools a connector serves, as connector:tool, that an agent can hold", () => {
    for (const [channel, refs] of Object.entries(CHANNEL_ACTING_TOOLS)) {
      for (const ref of refs) {
        expect(ref, `${channel}: "${ref}" is not connector:tool`).toMatch(/^[a-z0-9_]+:[a-z0-9_]+$/);
        const [connector, tool] = ref.split(":") as [string, string];
        expect(GATEWAY_TOOL_NAMES[connector], `${channel}: no connector "${connector}" is served`).toBeDefined();
        expect(GATEWAY_TOOL_NAMES[connector], `${channel}: ${connector} serves no tool "${tool}"`).toContain(tool);
        expect(isServiceOnlyConnector(connector), `${channel}: ${connector} is the platform's own, no agent calls it`).toBe(false);
        expect(isRouteOnlyTool(connector, tool), `${channel}: ${ref} is route-only, no agent holds it`).toBe(false);
      }
    }
  });

  it("fails when a listed ref names a tool no connector serves", () => {
    const served = (ref: string) => {
      const [connector, tool] = ref.split(":") as [string, string];
      return GATEWAY_TOOL_NAMES[connector]?.includes(tool) === true;
    };
    expect(served("sendgrid:send_mail")).toBe(true);
    expect(served("github:commit_files")).toBe(true);
    expect(served("sendgrid:publish_post")).toBe(false);
    expect(served("meta_ads:create_campaign")).toBe(false);
  });

  it("has the display name of every connector it names, as the connector itself spells it", () => {
    const connectors = new Map([...createAllConnectors({ secrets: {} }), ...createBuiltinConnectors({ secrets: {} })].map((c) => [c.key, c.displayName]));
    const named = new Set(Object.values(CHANNEL_ACTING_TOOLS).flatMap((refs) => refs.map((r) => r.split(":")[0]!)));
    expect(Object.keys(ACTING_CONNECTOR_NAMES).sort()).toEqual([...named].sort());
    for (const key of named) expect(ACTING_CONNECTOR_NAMES[key], key).toBe(connectors.get(key));
  });

  it("pins which channels act and which have no publisher yet (edit this list when a publisher is built)", () => {
    const acting = CHANNEL_KEYS.filter((k) => CHANNEL_ACTING_TOOLS[k].length > 0);
    const empty = CHANNEL_KEYS.filter((k) => CHANNEL_ACTING_TOOLS[k].length === 0);
    expect(CHANNEL_ACTING_TOOLS.email_automation).toEqual(["sendgrid:send_mail", "platform_mail:send_mail", "resend:send_mail"]);
    expect(CHANNEL_ACTING_TOOLS.seo).toEqual(["github:commit_files"]);
    expect(CHANNEL_ACTING_TOOLS.geo).toEqual(["github:commit_files"]);
    expect(acting).toEqual(["email_automation", "seo", "geo"]);
    expect(empty).toEqual(["lead_generation", "content", "social", "paid_ads", "influencer", "affiliate", "direct_mail", "print", "broadcast", "outdoor", "pr", "events"]);
  });
});

describe("channelAvailability", () => {
  const facts = (over: Partial<ChannelAvailabilityFacts> = {}): ChannelAvailabilityFacts => ({ liveConnectors: [], connectedConnectors: [], mockResultsAllowed: false, ...over });

  it("simulated_allowed: every channel is available where simulated results are allowed", () => {
    const all = channelAvailabilities(facts({ mockResultsAllowed: true }));
    expect(Object.keys(all)).toHaveLength(15);
    // A channel the founder can also post by tap says so there too (the Board shows its sentence on a development stack).
    for (const key of CHANNEL_KEYS) expect(all[key], key).toEqual(key === "social" ? { available: true, reason: "simulated_allowed", byTap: true } : { available: true, reason: "simulated_allowed" });
  });

  it("no_publisher: a channel with no acting tool is not available, whatever is connected", () => {
    expect(channelAvailability("content", facts({ liveConnectors: "all", connectedConnectors: ["sendgrid", "github"] }))).toEqual({ available: false, reason: "no_publisher" });
    expect(channelAvailability("print", facts())).toEqual({ available: false, reason: "no_publisher" });
  });

  it("by_tap: the social channel is available with no connector, because the founder posts each one with one press", () => {
    // The constant list of channels and at least one network that opens ready to post: both, or nothing.
    expect(CHANNELS_SHARED_BY_TAP).toEqual(["social"]);
    expect(TAP_POST_NETWORKS.length).toBeGreaterThan(0);
    const social = channelAvailability("social", facts());
    expect(social).toEqual({ available: true, reason: "by_tap", byTap: true });
    // Whatever else is connected changes nothing while no publishing tool is listed for it.
    expect(channelAvailability("social", facts({ liveConnectors: "all", connectedConnectors: ["sendgrid", "github"] }))).toEqual({ available: true, reason: "by_tap", byTap: true });
    // No other channel is by tap.
    const all = channelAvailabilities(facts());
    expect(CHANNEL_KEYS.filter((k) => all[k].reason === "by_tap")).toEqual(["social"]);
    expect(CHANNEL_KEYS.filter((k) => all[k].byTap)).toEqual(["social"]);
    // On the board, and never a channel the team runs: no engine, nothing launched or measured.
    expect(channelMayRun(social, false)).toBe(true);
    expect(channelTeamRuns(social)).toBe(false);
    expect(channelEngineMayRun(social, false)).toBe(false);
    // Offline tracking is the founder's own choice and runs as before.
    expect(channelEngineMayRun(social, true)).toBe(true);
    expect(channelAvailabilityRows(facts()).social.sentence).toBe(CHANNEL_BY_TAP_SENTENCE);
  });

  it("acts comes before by_tap: once a publishing connector is connected the team posts; listed and not connected, it stays by tap", () => {
    const table = { ...CHANNEL_ACTING_TOOLS, social: ["github:commit_files"] } as Record<ChannelKey, readonly string[]>;
    const acting = channelAvailability("social", facts({ liveConnectors: ["github"], connectedConnectors: ["github"] }), table);
    expect(acting).toEqual({ available: true, reason: "acts" });
    expect(channelTeamRuns(acting)).toBe(true);
    expect(channelEngineMayRun(acting, false)).toBe(true);
    // The connector exists and is not connected: the founder still posts by tap, and is not told to connect anything.
    expect(channelAvailability("social", facts({ liveConnectors: ["github"] }), table)).toEqual({ available: true, reason: "by_tap", byTap: true });
    expect(channelAvailability("social", facts(), table)).toEqual({ available: true, reason: "by_tap", byTap: true });
  });

  it("not_connected: the connector is mock here, or the business has not connected it", () => {
    // Mock for the deployment: not the founder's step.
    expect(channelAvailability("email_automation", facts())).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false });
    // Connected in Settings while the connector is mock here: still not real.
    expect(channelAvailability("email_automation", facts({ connectedConnectors: ["sendgrid"] }))).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false });
    // Live here, not connected for this business: the founder can connect it.
    expect(channelAvailability("email_automation", facts({ liveConnectors: ["sendgrid"] }))).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: true });
    expect(channelAvailability("seo", facts({ liveConnectors: "all" }))).toEqual({ available: false, reason: "not_connected", connectorKey: "github", connectable: true });
  });

  it("acts: an acting tool's connector is live here and connected for the business", () => {
    expect(channelAvailability("email_automation", facts({ liveConnectors: ["sendgrid"], connectedConnectors: ["sendgrid"] }))).toEqual({ available: true, reason: "acts" });
    expect(channelAvailability("seo", facts({ liveConnectors: ["github", "domains"], connectedConnectors: ["github"] }))).toEqual({ available: true, reason: "acts" });
    expect(channelAvailability("geo", facts({ liveConnectors: "all", connectedConnectors: ["github"] }))).toEqual({ available: true, reason: "acts" });
    // GitHub connected does not open email.
    expect(channelAvailability("email_automation", facts({ liveConnectors: "all", connectedConnectors: ["github"] })).available).toBe(false);
  });

  it("the Foundmill sending address opens email for every project, with nothing to connect, and is never named as the founder's step", () => {
    expect(channelAvailability("email_automation", facts({ platformMail: true }))).toEqual({ available: true, reason: "acts" });
    expect(channelAvailability("email_automation", facts({ liveConnectors: ["sendgrid"], platformMail: true }))).toEqual({ available: true, reason: "acts" });
    // The founder's own SendGrid still opens it, as before.
    expect(channelAvailability("email_automation", facts({ liveConnectors: ["sendgrid"], connectedConnectors: ["sendgrid"], platformMail: false }))).toEqual({ available: true, reason: "acts" });
    // Off: the reason names SendGrid, never the platform address.
    expect(channelAvailability("email_automation", facts({ platformMail: false }))).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false });
    // It opens nothing but email.
    expect(channelAvailability("seo", facts({ platformMail: true })).available).toBe(false);
    const rows = channelAvailabilityRows(facts({ liveConnectors: ["sendgrid"], platformMail: true }));
    expect(rows.email_automation.sentence).toBeNull();
    expect(firstChannelToOpen(rows)).toBeNull();
  });

  it("lead_generation has no publisher: finding people on Apollo is a read, and reaching them is the email channel's", () => {
    expect(channelAvailability("lead_generation", facts({ liveConnectors: "all", connectedConnectors: ["apollo", "sendgrid", "resend", "github"], platformMail: true }))).toEqual({ available: false, reason: "no_publisher" });
  });

  it("the founder's own Resend opens email on its own; with nothing connected and platform mail off the reason still names SendGrid first", () => {
    expect(channelAvailability("email_automation", facts({ liveConnectors: ["resend"], connectedConnectors: ["resend"] }))).toEqual({ available: true, reason: "acts" });
    expect(channelAvailability("email_automation", facts({ liveConnectors: "all", connectedConnectors: ["resend"] }))).toEqual({ available: true, reason: "acts" });
    // Connected but Resend is not live here.
    expect(channelAvailability("email_automation", facts({ connectedConnectors: ["resend"] })).available).toBe(false);
    // Nothing connected, platform mail off: the first live acting connector in table order is named (SendGrid), else the first connectable.
    expect(channelAvailability("email_automation", facts({ liveConnectors: "all", platformMail: false }))).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: true });
    expect(channelAvailability("email_automation", facts({ platformMail: false }))).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false });
    // Only Resend live: Resend is the one the founder could connect.
    expect(channelAvailability("email_automation", facts({ liveConnectors: ["resend"] }))).toEqual({ available: false, reason: "not_connected", connectorKey: "resend", connectable: true });
  });

  it("any one of several acting tools is enough", () => {
    const table = { ...CHANNEL_ACTING_TOOLS, content: ["sendgrid:send_mail", "github:commit_files"] } as Record<ChannelKey, readonly string[]>;
    expect(channelAvailability("content", facts({ liveConnectors: ["github"], connectedConnectors: ["github"] }), table)).toEqual({ available: true, reason: "acts" });
    expect(channelAvailability("content", facts({ liveConnectors: ["github"] }), table)).toEqual({ available: false, reason: "not_connected", connectorKey: "github", connectable: true });
  });
});

describe("channelAvailabilityFacts", () => {
  const integrations = [
    { connectorKey: "github", status: "connected" },
    { connectorKey: "sendgrid", status: "mock" },
    { connectorKey: "stripe", status: "degraded" },
    { connectorKey: "gmail", status: "expired" },
    { connectorKey: "notion", status: "connected", archivedAt: new Date() },
  ];

  it("reads the deployment's live connectors, the business's connected integrations and the sample rule", () => {
    const staging = channelAvailabilityFacts({ APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "github, domains" }, { isDemo: false }, integrations);
    expect(staging).toEqual({ liveConnectors: ["github", "domains"], connectedConnectors: ["github", "stripe"], mockResultsAllowed: false, platformMail: false });
    // The Foundmill sending address: on only with its domain set and SendGrid live.
    expect(channelAvailabilityFacts({ APP_ENV: "production", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "sendgrid", PLATFORM_MAIL_DOMAIN: "mail.foundmill.com" }, { isDemo: false }, []).platformMail).toBe(true);
    expect(channelAvailabilityFacts({ APP_ENV: "production", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "", PLATFORM_MAIL_DOMAIN: "mail.foundmill.com" }, { isDemo: false }, []).platformMail).toBe(false);
    expect(channelAvailabilityFacts({ APP_ENV: "production", INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" }, { isDemo: false }, []).platformMail).toBe(false);
    expect(channelAvailabilityFacts({ APP_ENV: "production", INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" }, { isDemo: false }, []).liveConnectors).toBe("all");
  });

  it("a sample business anywhere and any business in development or test keep all fifteen", () => {
    expect(everyChannelAvailable({ APP_ENV: "production" }, { isDemo: true })).toBe(true);
    expect(everyChannelAvailable({ APP_ENV: "test" }, { isDemo: false })).toBe(true);
    expect(everyChannelAvailable({ APP_ENV: "development" }, { isDemo: false })).toBe(true);
    expect(everyChannelAvailable({ APP_ENV: "staging" }, { isDemo: false })).toBe(false);
    const sample = channelAvailabilities(channelAvailabilityFacts({ APP_ENV: "production", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" }, { isDemo: true }, []));
    expect(Object.values(sample).every((a) => a.available)).toBe(true);
  });

  it("rows carry the founder's sentence, the refusal names the channel, and what opens first is the founder's own step or nothing", () => {
    const env = { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "" } as const;
    const rows = channelAvailabilityRows(channelAvailabilityFacts(env, { isDemo: false }, []));
    expect(rows.content).toEqual({ available: false, reason: "no_publisher", sentence: "Not available yet: the team cannot publish here yet." });
    expect(rows.social).toEqual({ available: true, reason: "by_tap", byTap: true, sentence: "You post each one with one press: the text and link are filled in for you." });
    expect(rows.email_automation).toEqual({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false, sentence: "Not available yet: SendGrid is not switched on for your project yet. Nothing is waiting on you." });
    expect(channelRefusal("content", rows.content)).toBe("Content marketing is not available yet: the team cannot publish there yet.");
    expect(firstChannelToOpen(rows)).toBeNull();

    const withGithub = channelAvailabilityRows(channelAvailabilityFacts({ ...env, LIVE_CONNECTORS: "github" }, { isDemo: false }, []));
    expect(withGithub.seo.sentence).toBe("Not available yet: connect GitHub in Settings › Integrations and the team can run this.");
    // A repository-backed channel is never named as the first to open: a first-time founder is not sent to connect a
    // code repository to find customers. The email line is said instead (null).
    expect(firstChannelToOpen(withGithub)).toBeNull();
    const withSending = channelAvailabilityRows(channelAvailabilityFacts({ ...env, LIVE_CONNECTORS: "github,sendgrid" }, { isDemo: false }, []));
    expect(firstChannelToOpen(withSending)).toEqual({ label: "Email automation", connectorName: "SendGrid", connectable: true });
    const sample = channelAvailabilityRows(channelAvailabilityFacts(env, { isDemo: true }, []));
    // Every channel runs for a sample business; the one the founder can also post by tap says so, the rest say nothing.
    expect(Object.values(sample).every((r) => r.available)).toBe(true);
    expect(CHANNEL_KEYS.filter((k) => sample[k].sentence !== null)).toEqual(["social"]);
    expect(sample.social).toEqual({ available: true, reason: "simulated_allowed", byTap: true, sentence: CHANNEL_BY_TAP_SENTENCE });
  });

  it("production as documented (mock integrations, GitHub live): a person's project gets SEO and GEO once GitHub is connected, social by tap from the start, and nothing else", () => {
    const env = { APP_ENV: "staging", INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "github,domains" } as const;
    const before = channelAvailabilities(channelAvailabilityFacts(env, { isDemo: false }, []));
    expect(CHANNEL_KEYS.filter((k) => before[k].available)).toEqual(["social"]);
    // Nothing the team can run yet: the founder's own posting is not a channel that runs on its own.
    expect(CHANNEL_KEYS.filter((k) => channelTeamRuns(before[k]))).toEqual([]);
    const after = channelAvailabilities(channelAvailabilityFacts(env, { isDemo: false }, [{ connectorKey: "github", status: "connected" }]));
    expect(CHANNEL_KEYS.filter((k) => after[k].available)).toEqual(["seo", "geo", "social"]);
    expect(CHANNEL_KEYS.filter((k) => channelTeamRuns(after[k]))).toEqual(["seo", "geo"]);
  });
});
