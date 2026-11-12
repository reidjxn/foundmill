import { describe, expect, it } from "vitest";
import {
  askToConnectBlocker, canSpeakAsBusiness, connectStateOf, counterpartId, findDirectThread, groupConnections, joinNames,
  leaveBlocker, leftNote, otherParticipants, personName, postStatusLabel, threadParticipants, threadSubject, REPORT_REASONS, reportReasonLabel, requestOutcome, threadTitle, UNNAMED_PERSON, VISIBILITY_OPTIONS, visibilityLabel,
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
    // Every setting says that people you write to or ask to connect see your name, which is what the name lookup does.
    const copy = Object.fromEntries(VISIBILITY_OPTIONS.map((o) => [o.value, o.description]));
    expect(copy.private).toBe("Nobody, except people you write to or ask to connect.");
    expect(copy.connections).toContain("anyone you write to or ask to connect");
    expect(copy.community).toContain("anyone you write to or ask to connect");
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
    expect(joinNames([card("Ana"), card("Ben"), card("Cal"), card("Dee")], { all: true })).toBe("Ana, Ben, Cal and Dee");
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
  it("titles a thread by who it is with, never by the subject the sender chose (audit GLS2F-06, LS2-04)", () => {
    expect(threadTitle(named, ME, names)).toBe("A founder");
    expect(threadTitle(direct, ME, names)).toBe("Ana");
    expect(threadTitle(group, ME, names)).toBe("Ana and Ben");
    expect(threadTitle({ id: "t4", participantIds: [ME, CAL], subject: null }, ME, names)).toBe("A founder");
    const spoof = { id: "t5", participantIds: [ME, ANA], subject: "Foundmill Support: verify your account" };
    expect(threadTitle(spoof, ME, names)).toBe("Ana");
    expect(threadSubject(spoof)).toBe("Foundmill Support: verify your account");
  });
  it("names every participant of a group in the header, and keeps the subject as a separate line", () => {
    const crowd = { id: "t6", participantIds: [ME, ANA, BEN, CAL], subject: "Launch" };
    expect(threadTitle(crowd, ME, names)).toBe("Ana, Ben and 1 other");
    expect(threadParticipants(crowd, ME, names)).toBe("Ana, Ben and A founder");
    expect(threadParticipants(direct, ME, names)).toBe("Ana");
    expect(threadParticipants(group, ME, names)).toBe("Ana and Ben");
    expect(threadSubject(named)).toBe("Intro");
    expect(threadSubject(direct)).toBeNull();
    expect(threadSubject({ subject: "   " })).toBeNull();
  });
  it("finds the one-to-one thread with a person, never a group thread", () => {
    expect(findDirectThread([group, direct, named], ME, ANA)?.id).toBe("t1");
    expect(findDirectThread([group], ME, ANA)).toBeUndefined();
    expect(findDirectThread([direct], ME, BEN)).toBeUndefined();
    // A group that shrank to the two of us (Ben left) is still a group: a Send to Ana opens our direct thread instead.
    const shrunk = { id: "t5", participantIds: [ME, ANA], subject: null, kind: "group" as const };
    expect(findDirectThread([shrunk], ME, ANA)).toBeUndefined();
    expect(findDirectThread([shrunk, { ...direct, kind: "direct" as const }], ME, ANA)?.id).toBe("t1");
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

  it("tells what a sent request came to (a request to a business cannot know its owner beforehand)", () => {
    expect(requestOutcome(row("1", ME, ANA, "requested"), ME)).toBe("sent");
    expect(requestOutcome(row("2", ANA, ME, "requested"), ME)).toBe("incoming");
    expect(requestOutcome(row("3", ANA, ME, "accepted"), ME)).toBe("connected");
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
