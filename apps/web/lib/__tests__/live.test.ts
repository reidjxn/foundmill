import { describe, expect, it } from "vitest";
import {
  askToConnectBlocker, boardKindLabel, canSpeakAsBusiness, boardScope, boardTitle, connectStateOf, counterpartId, describeMetric, findDirectThread, formResults, formatMetricValue, groupConnections, humanise, joinNames,
  leaveBlocker, leftNote, otherParticipants, periodLabel, personName, positionLabel, postStatusLabel, REPORT_REASONS, reportReasonLabel, threadTitle, UNNAMED_PERSON, VISIBILITY_OPTIONS, visibilityLabel,
} from "../live";

const ME = "00000000-0000-4000-8000-0000000000aa";
const ANA = "00000000-0000-4000-8000-0000000000a1";
const BEN = "00000000-0000-4000-8000-0000000000b2";
const CAL = "00000000-0000-4000-8000-0000000000c3";

describe("profile visibility", () => {
  it("offers Public, Connections, Community and Private, in that order, with a line each", () => {
    expect(VISIBILITY_OPTIONS.map((o) => o.label)).toEqual(["Public", "Connections", "Community", "Private"]);
    expect(VISIBILITY_OPTIONS.every((o) => o.description.length > 10)).toBe(true);
    expect(VISIBILITY_OPTIONS[0]!.description).toContain("Foundmill");
    expect(visibilityLabel("community")).toBe("Community");
    expect(visibilityLabel("nonsense")).toBe("Private");
  });
});

describe("people", () => {
  it("names a person, or says a founder when the profile keeps the name back", () => {
    expect(personName({ userId: ANA, displayName: "  Ana Ruiz " })).toBe("Ana Ruiz");
    expect(personName({ userId: ANA, displayName: null })).toBe(UNNAMED_PERSON);
    expect(personName(undefined)).toBe(UNNAMED_PERSON);
  });
  it("joins names the way a thread title reads", () => {
    const card = (name: string | null, id = name ?? "x") => ({ userId: id, displayName: name });
    expect(joinNames([card("Ana")])).toBe("Ana");
    expect(joinNames([card("Ana"), card("Ben")])).toBe("Ana and Ben");
    expect(joinNames([card("Ana"), card("Ben"), card("Cal")])).toBe("Ana, Ben and 1 other");
    expect(joinNames([card("Ana"), card("Ben"), card("Cal"), card("Dee")])).toBe("Ana, Ben and 2 others");
    expect(joinNames([card(null)])).toBe("A founder");
    expect(joinNames([card("Ana"), card(null, "u1"), card(null, "u2")])).toBe("Ana and 2 founders");
    expect(joinNames([])).toBe("A founder");
  });
});

describe("connections", () => {
  const rows = [
    { id: "1", fromUser: ANA, toUser: ME, status: "requested" as const },
    { id: "2", fromUser: ME, toUser: BEN, status: "requested" as const },
    { id: "3", fromUser: CAL, toUser: ME, status: "accepted" as const },
    { id: "4", fromUser: ME, toUser: ANA, status: "accepted" as const },
    { id: "5", fromUser: BEN, toUser: ME, status: "blocked" as const },
  ];
  it("finds the person on the other end", () => {
    expect(counterpartId(rows[0]!, ME)).toBe(ANA);
    expect(counterpartId(rows[1]!, ME)).toBe(BEN);
  });
  it("groups requests for the viewer to answer, requests they sent, connections and blocks", () => {
    const g = groupConnections(rows, ME);
    expect(g.incoming.map((r) => r.id)).toEqual(["1"]);
    expect(g.outgoing.map((r) => r.id)).toEqual(["2"]);
    expect(g.accepted.map((r) => r.id)).toEqual(["3", "4"]);
    expect(g.blocked.map((r) => r.id)).toEqual(["5"]);
    expect(groupConnections([], ME)).toEqual({ incoming: [], outgoing: [], accepted: [], blocked: [] });
  });
});

describe("message threads", () => {
  const direct = { id: "t1", participantIds: [ME, ANA], subject: null };
  const group = { id: "t2", participantIds: [ME, ANA, BEN], subject: null };
  const named = { id: "t3", participantIds: [ME, CAL], subject: "  Intro  " };
  const names = (id: string) => ({ userId: id, displayName: ({ [ANA]: "Ana", [BEN]: "Ben" } as Record<string, string>)[id] ?? null });
  it("lists who else is in a thread", () => {
    expect(otherParticipants(group, ME)).toEqual([ANA, BEN]);
  });
  it("titles a thread by its subject, else by who it is with", () => {
    expect(threadTitle(named, ME, names)).toBe("Intro");
    expect(threadTitle(direct, ME, names)).toBe("Ana");
    expect(threadTitle(group, ME, names)).toBe("Ana and Ben");
    expect(threadTitle({ id: "t4", participantIds: [ME, CAL], subject: null }, ME, names)).toBe("A founder");
  });
  it("finds the one-to-one thread with a person, never a group thread", () => {
    expect(findDirectThread([group, direct, named], ME, ANA)?.id).toBe("t1");
    expect(findDirectThread([group], ME, ANA)).toBeUndefined();
    expect(findDirectThread([direct], ME, BEN)).toBeUndefined();
  });
});

describe("asking to connect and moderation copy (audit #28, #34, #66)", () => {
  const row = (id: string, fromUser: string, toUser: string, status: "requested" | "accepted" | "blocked") => ({ id, fromUser, toUser, status });
  it("reads where the viewer stands with a person from their own rows", () => {
    const rows = [row("1", ME, ANA, "accepted"), row("2", ME, BEN, "requested"), row("3", CAL, ME, "requested")];
    expect(connectStateOf(rows, ME, ME)).toBe("self");
    expect(connectStateOf(rows, ME, ANA)).toBe("connected");
    expect(connectStateOf(rows, ME, BEN)).toBe("requested");
    expect(connectStateOf(rows, ME, CAL)).toBe("incoming");
    expect(connectStateOf([row("4", ME, CAL, "blocked")], ME, CAL)).toBe("blocked");
    expect(connectStateOf(rows, ME, "00000000-0000-4000-8000-0000000000ff")).toBe("none");
  });

  it("asks only from a LIVE business the founder may speak for, and says why not", () => {
    const live = { gameMode: "live", committedAt: new Date(), archivedAt: null };
    expect(askToConnectBlocker({ business: live, membership: { role: "owner" } })).toBeNull();
    expect(askToConnectBlocker({ business: { ...live, gameMode: "personal" }, membership: { role: "owner" } })).toMatch(/LIVE business/);
    expect(askToConnectBlocker({ business: live, membership: { role: "viewer" } })).toMatch(/role/);
    expect(askToConnectBlocker({ business: live, membership: { role: "member", sectionPermissions: { live: "read" } } })).toMatch(/role/);
  });

  it("names a post's status, the reasons to report, and who left a thread", () => {
    expect(postStatusLabel("pending_review")).toBe("Held for review");
    expect(postStatusLabel("hidden")).toBe("Hidden by a moderator");
    expect(postStatusLabel("visible")).toBeNull();
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(["spam", "harassment", "personal_data", "scam", "off_topic", "other"]);
    expect(reportReasonLabel("personal_data")).toBe("Someone's personal data");
    const names: Record<string, string> = { [ANA]: "Ana", [BEN]: "Ben" };
    expect(leftNote([], () => undefined)).toBeNull();
    expect(leftNote([ANA, BEN], (id) => ({ userId: id, displayName: names[id] ?? null }))).toBe("Ana and Ben left this conversation");
  });

  it("keeps the owner of a community joined by invitation in it, and lets everyone else leave", () => {
    expect(leaveBlocker({ role: "owner", visibility: "private" })).toMatch(/invitation only/);
    expect(leaveBlocker({ role: "owner", visibility: "public" })).toBeNull();
    expect(leaveBlocker({ role: "moderator", visibility: "private" })).toBeNull();
    expect(leaveBlocker({ role: null, visibility: "private" })).toBeNull();
  });
});

describe("speaking as a business", () => {
  const live = { gameMode: "live", committedAt: new Date(), archivedAt: null };
  it("is offered only for a LIVE, committed, active business, to a writer with write access to the live section", () => {
    expect(canSpeakAsBusiness({ business: live, membership: { role: "owner", sectionPermissions: {} } })).toBe(true);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "admin", sectionPermissions: {} } })).toBe(true);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "member", sectionPermissions: { finance: "none" } } })).toBe(true);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "member" } })).toBe(true);
    // Read-only roles, and a member held back on the live section.
    expect(canSpeakAsBusiness({ business: live, membership: { role: "viewer", sectionPermissions: {} } })).toBe(false);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "advisor", sectionPermissions: { live: "write" } } })).toBe(false);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "member", sectionPermissions: { live: "read" } } })).toBe(false);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "member", sectionPermissions: { live: "none" } } })).toBe(false);
    expect(canSpeakAsBusiness({ business: live, membership: { role: "member", sectionPermissions: { live: "write" } } })).toBe(true);
    // The business itself.
    expect(canSpeakAsBusiness({ business: { ...live, gameMode: "personal" }, membership: { role: "owner" } })).toBe(false);
    expect(canSpeakAsBusiness({ business: { ...live, committedAt: null }, membership: { role: "owner" } })).toBe(false);
    expect(canSpeakAsBusiness({ business: { ...live, archivedAt: new Date() }, membership: { role: "owner" } })).toBe(false);
  });
});

describe("leaderboards", () => {
  it("humanises keys with the acronyms people expect", () => {
    expect(humanise("customers_won")).toBe("Customers won");
    expect(humanise("b2b_saas")).toBe("B2B SaaS");
    expect(humanise("mrr_growth")).toBe("MRR growth");
    expect(humanise("open")).toBe("Open");
    expect(humanise("")).toBe("");
  });
  it("reads periods, scopes and titles", () => {
    expect(periodLabel("2026-Q4")).toBe("Q4 2026");
    expect(periodLabel("2026-10")).toBe("Oct 2026");
    expect(periodLabel("all-time")).toBe("All time");
    expect(periodLabel("whenever")).toBe("whenever");
    const board = { id: "b", boardKind: "growth", division: "b2b_saas", period: "2026-Q4", metric: "mrr_growth_pct", archetype: "b2b_saas", region: "eu", computedAt: null };
    expect(boardKindLabel("customers_won")).toBe("Customers won");
    expect(boardScope(board)).toBe("B2B SaaS · EU");
    expect(boardScope({ division: "open", archetype: null, region: null })).toBe("Open");
    expect(boardScope({ division: "revenue_1m", archetype: "marketplace", region: "us" })).toBe("Marketplace · Revenue 1m · US");
    expect(boardTitle(board)).toBe("Growth · B2B SaaS · EU");
  });
  it("knows what a board ranks on and how its values read", () => {
    expect(describeMetric("mrr_growth_pct")).toEqual({ label: "MRR growth", format: "percent" });
    expect(describeMetric("customers_won")).toEqual({ label: "Customers won", format: "integer" });
    expect(describeMetric("mrr")).toEqual({ label: "MRR", format: "number" });
    expect(describeMetric("net_revenue_retention")).toEqual({ label: "Net revenue retention", format: "number" });
    expect(formatMetricValue("18.4000", "percent")).toBe("18.4%");
    expect(formatMetricValue(47, "integer")).toBe("47");
    expect(formatMetricValue("12400.5", "number")).toBe("12,400.5");
    expect(formatMetricValue("n/a", "number")).toBe("—");
    expect(positionLabel(3)).toBe("#3");
  });
  it("turns the form string into cells and ignores anything else", () => {
    expect(formResults("WWDLW")).toEqual(["success", "success", "partial", "failure", "success"]);
    expect(formResults("w-d l?")).toEqual(["success", "partial", "failure"]);
    expect(formResults("")).toEqual([]);
  });
});
