import { describe, expect, it } from "vitest";
import { LIMITS } from "@founder-manager/config";
import {
  attribute, buildMarkovModel, channelWeights, chooseModel, conversionPathsFromTouches, dataDrivenWeights, filterTouchesForConsent, OFFLINE_CHANNELS,
  parseTouchSource, positionBased4020, selectJourneyTouches, type AttributionRegistry, type ConversionPath,
} from "../attribution";
import { closeTo, CONVERTED_AT, ENTITY_ID, FIVE_TOUCH, fid, makeTouches, OTHER_ENTITY_ID, sum, VISITOR_ID } from "./fixtures";

const REGISTRY: AttributionRegistry = {
  ownHosts: ["northwind.example", "shop.northwind.example"],
  codes: {
    "MAIL-SPRING": { channelKey: "direct_mail", campaignId: fid("ca", 1), kind: "promo", label: "Spring postcard" },
    PAPER10: { channelKey: "print", campaignId: fid("ca", 2), kind: "promo", label: "Local paper" },
    RADIO15: { channelKey: "broadcast", campaignId: fid("ca", 3), kind: "promo", label: "Radio spot" },
    "QR-STATION": { channelKey: "outdoor", campaignId: fid("ca", 4), kind: "qr", label: "Station billboard" },
    "INF-MIRA": { channelKey: "influencer", campaignId: fid("ca", 5), kind: "influencer" },
    "AFF-TOOLSTACK": { channelKey: "affiliate", campaignId: fid("ca", 6), kind: "affiliate" },
  },
  vanityUrls: {
    "/radio": { channelKey: "broadcast", campaignId: fid("ca", 3), kind: "vanity_url" },
    "go.northwind.example": { channelKey: "print", campaignId: fid("ca", 2), kind: "vanity_url" },
    "northwind.example/tv": { channelKey: "broadcast", campaignId: fid("ca", 7), kind: "vanity_url" },
  },
  trackingNumbers: {
    "+44 20 7946 0101": { channelKey: "direct_mail", campaignId: fid("ca", 1), kind: "tracking_number" },
    "020 7946 0103": { channelKey: "broadcast", campaignId: fid("ca", 3), kind: "tracking_number" },
  },
};

describe("parseTouchSource — UTM, referrer and click ids", () => {
  it("reads UTM parameters from the landing URL and maps utm_medium to a channel", () => {
    const p = parseTouchSource({ url: "https://northwind.example/?utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_term=serum" });
    expect(p.channelKey).toBe("paid_ads");
    expect(p.kind).toBe("ad_click");
    expect(p.source.utm).toEqual({ source: "google", medium: "cpc", campaign: "brand", term: "serum", content: null });
    expect(p.rule).toBe("utm_medium:cpc");
    expect(p.offline).toBe(false);
  });

  it("explicit UTM values win over the URL's", () => {
    const p = parseTouchSource({ url: "https://northwind.example/?utm_medium=cpc", utm: { medium: "email", source: "sendgrid" } });
    expect(p.channelKey).toBe("email_automation");
    expect(p.kind).toBe("email_click");
  });

  it.each([
    ["gclid", "paid_ads"],
    ["ttclid", "paid_ads"],
    ["li_fat_id", "paid_ads"],
    ["msclkid", "paid_ads"],
  ])("a %s click id is a third-party paid touch", (key, channel) => {
    const p = parseTouchSource({ url: `https://northwind.example/landing?${key}=XyZ123` });
    expect(p.channelKey).toBe(channel);
    expect(p.kind).toBe("ad_click");
    expect(p.firstParty).toBe(false);
    expect(p.source.clickIds[key as "gclid"]).toBe("XyZ123");
    expect(p.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("a lone fbclid with organic social UTM is organic social; without paid UTM it is low-confidence paid", () => {
    const organic = parseTouchSource({ url: "https://northwind.example/?utm_source=instagram&utm_medium=social&fbclid=abc" });
    expect(organic.channelKey).toBe("social");
    expect(organic.firstParty).toBe(false);
    const unsure = parseTouchSource({ url: "https://northwind.example/?fbclid=abc" });
    expect(unsure.channelKey).toBe("paid_ads");
    expect(unsure.confidence).toBeLessThan(0.9);
    const paid = parseTouchSource({ url: "https://northwind.example/?utm_medium=paid_social&fbclid=abc" });
    expect(paid.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies referrers: search, AI assistants, social, communities, webmail, other sites", () => {
    expect(parseTouchSource({ url: "https://northwind.example/", referrer: "https://www.google.com/" }).channelKey).toBe("seo");
    expect(parseTouchSource({ url: "https://northwind.example/", referrer: "https://www.bing.com/search?q=x" }).channelKey).toBe("seo");
    expect(parseTouchSource({ url: "https://northwind.example/", referrer: "https://chatgpt.com/" }).channelKey).toBe("geo");
    expect(parseTouchSource({ url: "https://northwind.example/", referrer: "https://www.perplexity.ai/search/abc" }).channelKey).toBe("geo");
    expect(parseTouchSource({ url: "https://northwind.example/", referrer: "https://www.instagram.com/p/1" }).channelKey).toBe("social");
    expect(parseTouchSource({ url: "https://northwind.example/", referrer: "https://news.ycombinator.com/item?id=1" }).channelKey).toBe("social");
    const webmail = parseTouchSource({ url: "https://northwind.example/", referrer: "https://mail.google.com/mail/u/0/" });
    expect(webmail.channelKey).toBe("email_automation");
    expect(webmail.kind).toBe("email_click");
    const press = parseTouchSource({ url: "https://northwind.example/", referrer: "https://dailybeacon.example/story/1" });
    expect(press.channelKey).toBe("pr");
    expect(press.medium).toBe("referral");
  });

  it("ignores self-referrals from the business's own hosts and reports direct", () => {
    const p = parseTouchSource({ url: "https://northwind.example/pricing", referrer: "https://shop.northwind.example/cart", registry: REGISTRY });
    expect(p.channelKey).toBeNull();
    expect(p.medium).toBe("direct");
    expect(p.source.referrerHost).toBeNull();
    const sub = parseTouchSource({ url: "https://northwind.example/pricing", referrer: "https://www.northwind.example/" });
    expect(sub.rule).toBe("direct");
  });

  it("email provider events become email touches of the right kind", () => {
    expect(parseTouchSource({ provider: "sendgrid", eventName: "open" })).toMatchObject({ channelKey: "email_automation", kind: "email_open", firstParty: true });
    expect(parseTouchSource({ provider: "sendgrid", eventName: "click" }).kind).toBe("email_click");
    expect(parseTouchSource({ provider: "SendGrid", eventName: "inbound" }).kind).toBe("email_reply");
    expect(parseTouchSource({ provider: "sendgrid", eventName: "delivered" }).kind).toBe("email_delivered");
  });

  it("providers that name a channel (events tool, outbound tool) attribute without a URL", () => {
    expect(parseTouchSource({ provider: "events", eventName: "badge_scan" })).toMatchObject({ channelKey: "events", kind: "form_submit" });
    expect(parseTouchSource({ provider: "outbound", eventName: "meeting_booked" })).toMatchObject({ channelKey: "lead_generation", kind: "meeting" });
    // A URL with its own UTM still wins over the provider's channel.
    expect(parseTouchSource({ provider: "events", url: "https://northwind.example/?utm_medium=cpc" }).channelKey).toBe("paid_ads");
  });

  it("a plain visit with nothing to go on is direct with confidence 1", () => {
    const p = parseTouchSource({ url: "https://northwind.example/" });
    expect(p).toMatchObject({ channelKey: null, kind: "visit", medium: "direct", confidence: 1, firstParty: true, offline: false });
  });

  it("tolerates garbage input", () => {
    expect(parseTouchSource({ url: "not a url at all ???", referrer: "::::" }).rule).toBe("direct");
    expect(parseTouchSource({}).rule).toBe("direct");
  });
});

describe("parseTouchSource — promo, affiliate and offline codes (AC-11.4.4)", () => {
  it.each([
    ["MAIL-SPRING", "direct_mail", "code_redeemed", "promo", 1],
    ["paper10", "print", "code_redeemed", "promo", 2],
    [" Radio15 ", "broadcast", "code_redeemed", "promo", 3],
    ["QR-STATION", "outdoor", "qr_scan", "qr", 4],
    ["INF-MIRA", "influencer", "code_redeemed", "influencer", 5],
    ["AFF-TOOLSTACK", "affiliate", "code_redeemed", "affiliate", 6],
  ])("registry code %s → %s", (code, channel, kind, codeKind, campaign) => {
    const p = parseTouchSource({ code, registry: REGISTRY });
    expect(p.channelKey).toBe(channel);
    expect(p.kind).toBe(kind);
    expect(p.source.codeKind).toBe(codeKind);
    expect(p.campaignId).toBe(fid("ca", campaign));
    expect(p.rule).toBe("code:registry");
    expect(p.firstParty).toBe(true);
    expect(p.offline).toBe(OFFLINE_CHANNELS.has(channel as "print"));
  });

  it("offline registry codes attribute to the wings channels: direct mail, print, OOH, broadcast", () => {
    const channels = ["MAIL-SPRING", "PAPER10", "RADIO15", "QR-STATION"].map((code) => parseTouchSource({ code, registry: REGISTRY }));
    expect(channels.map((p) => p.channelKey)).toEqual(["direct_mail", "print", "broadcast", "outdoor"]);
    expect(channels.every((p) => p.offline && p.medium === "offline")).toBe(true);
  });

  it("codes carried on the URL are picked up (code / promo / ref / via)", () => {
    expect(parseTouchSource({ url: "https://northwind.example/?code=PAPER10", registry: REGISTRY }).channelKey).toBe("print");
    expect(parseTouchSource({ url: "https://northwind.example/?promo=mail-spring", registry: REGISTRY }).channelKey).toBe("direct_mail");
    const via = parseTouchSource({ url: "https://northwind.example/?via=toolstack" });
    expect(via.channelKey).toBe("affiliate");
    expect(via.source.codeKind).toBe("affiliate");
    expect(via.rule).toBe("code:url_ref_param");
  });

  it("falls back to prefix heuristics for codes not in the registry", () => {
    expect(parseTouchSource({ code: "MAIL-2025" })).toMatchObject({ channelKey: "direct_mail", rule: "code:prefix" });
    expect(parseTouchSource({ code: "QR_7" })).toMatchObject({ channelKey: "outdoor", kind: "qr_scan" });
    expect(parseTouchSource({ code: "TV10" }).channelKey).toBe("broadcast");
    expect(parseTouchSource({ code: "PRINT-APR" }).channelKey).toBe("print");
    expect(parseTouchSource({ code: "AFF-99" })).toMatchObject({ channelKey: "affiliate", source: { codeKind: "affiliate" } });
    // "MAILBOX" is not a mail code: the prefix must be followed by a digit or separator.
    expect(parseTouchSource({ code: "MAILBOX" }).rule).toBe("code:unknown");
  });

  it("an unknown promo code keeps the channel from UTM when there is one, otherwise unknown", () => {
    const withUtm = parseTouchSource({ code: "WELCOME", url: "https://northwind.example/?utm_medium=email&code=WELCOME" });
    expect(withUtm.channelKey).toBe("email_automation");
    expect(withUtm.kind).toBe("code_redeemed");
    const alone = parseTouchSource({ code: "WELCOME" });
    expect(alone.channelKey).toBeNull();
    expect(alone.confidence).toBeLessThan(0.5);
  });

  it("tracking phone numbers compare on digits only and produce call touches", () => {
    const call = parseTouchSource({ trackingNumber: "+44 (0)20 7946 0103", registry: REGISTRY });
    expect(call).toMatchObject({ channelKey: "broadcast", kind: "call", offline: true, rule: "tracking_number:registry" });
    expect(call.source.offlineKey).toBe("+44 (0)20 7946 0103");
    expect(call.source.codeKind).toBe("tracking_number");
    expect(call.campaignId).toBe(fid("ca", 3));
    const mail = parseTouchSource({ trackingNumber: "02079460101", registry: REGISTRY });
    expect(mail.channelKey).toBe("direct_mail");
    const unknown = parseTouchSource({ trackingNumber: "0800 000 000" });
    expect(unknown).toMatchObject({ channelKey: null, kind: "call", rule: "tracking_number:unknown" });
  });

  it("vanity URLs match by path, host, or host + path", () => {
    expect(parseTouchSource({ url: "https://northwind.example/radio/", registry: REGISTRY })).toMatchObject({ channelKey: "broadcast", rule: "vanity_url:registry", source: { codeKind: "vanity_url", offlineKey: "/radio" } });
    expect(parseTouchSource({ url: "https://go.northwind.example/anything", registry: REGISTRY }).channelKey).toBe("print");
    expect(parseTouchSource({ url: "https://www.northwind.example/TV", registry: REGISTRY }).campaignId).toBe(fid("ca", 7));
    expect(parseTouchSource({ url: "https://northwind.example/tv-guide", registry: REGISTRY }).rule).toBe("direct");
  });

  it("QR scans without a registered code land on outdoor (or the offline channel the UTM names)", () => {
    expect(parseTouchSource({ url: "https://northwind.example/qr/shelter" })).toMatchObject({ channelKey: "outdoor", kind: "qr_scan", source: { codeKind: "qr" } });
    expect(parseTouchSource({ url: "https://northwind.example/?utm_medium=qr" }).channelKey).toBe("outdoor");
    expect(parseTouchSource({ url: "https://northwind.example/?qr=1&utm_medium=print" }).channelKey).toBe("print");
    expect(parseTouchSource({ url: "https://northwind.example/", eventName: "scan" }).kind).toBe("qr_scan");
  });

  it("the parsed source round-trips through the TouchSource schema", () => {
    const p = parseTouchSource({ url: "https://northwind.example/?utm_source=google&utm_medium=cpc&gclid=1", code: "PAPER10", registry: REGISTRY, agentId: fid("a9", 1), label: "x" });
    expect(p.source.agentId).toBe(fid("a9", 1));
    expect(p.source.landingUrl).toContain("gclid=1");
    expect(p.source.utm.source).toBe("google");
    expect(p.source.label).toBe("x");
  });
});

describe("positionBased4020", () => {
  it("matches the hand-computed 40 / 20 / 40 fixtures and sums to 1", () => {
    const five = positionBased4020(makeTouches(FIVE_TOUCH));
    expect(five[fid("t", 1)]).toBeCloseTo(0.4, 12);
    expect(five[fid("t", 2)]).toBeCloseTo(0.2 / 3, 12);
    expect(five[fid("t", 3)]).toBeCloseTo(0.2 / 3, 12);
    expect(five[fid("t", 4)]).toBeCloseTo(0.2 / 3, 12);
    expect(five[fid("t", 5)]).toBeCloseTo(0.4, 12);
    expect(closeTo(sum(Object.values(five)), 1)).toBe(true);

    const three = positionBased4020(makeTouches(FIVE_TOUCH.slice(0, 3)));
    expect([three[fid("t", 1)], three[fid("t", 2)], three[fid("t", 3)]]).toEqual([0.4, 0.2, 0.4]);

    const four = positionBased4020(makeTouches(FIVE_TOUCH.slice(0, 4)));
    expect(four[fid("t", 2)]).toBeCloseTo(0.1, 12);
    expect(four[fid("t", 3)]).toBeCloseTo(0.1, 12);
  });

  it("handles 0, 1 and 2 touches", () => {
    expect(positionBased4020([])).toEqual({});
    expect(positionBased4020(makeTouches(FIVE_TOUCH.slice(0, 1)))).toEqual({ [fid("t", 1)]: 1 });
    expect(positionBased4020(makeTouches(FIVE_TOUCH.slice(0, 2)))).toEqual({ [fid("t", 1)]: 0.5, [fid("t", 2)]: 0.5 });
  });

  it("orders by time, not by input order, and breaks ties by id", () => {
    const touches = makeTouches(FIVE_TOUCH);
    const shuffled = [touches[3]!, touches[0]!, touches[4]!, touches[2]!, touches[1]!];
    expect(positionBased4020(shuffled)).toEqual(positionBased4020(touches));
    const tie = [{ id: fid("t", 2), occurredAt: CONVERTED_AT }, { id: fid("t", 1), occurredAt: CONVERTED_AT }, { id: fid("t", 3), occurredAt: CONVERTED_AT }];
    expect(positionBased4020(tie)).toEqual({ [fid("t", 1)]: 0.4, [fid("t", 2)]: 0.2, [fid("t", 3)]: 0.4 });
  });
});

describe("data-driven attribution — Markov removal effect", () => {
  const PATHS: ConversionPath[] = [
    { states: ["paid_ads", "email_automation"], converted: true },
    { states: ["paid_ads"], converted: false },
    { states: ["seo", "email_automation"], converted: true },
    { states: ["seo"], converted: false },
  ];

  it("computes removal effects and attribution matching the hand-solved chain", () => {
    const m = buildMarkovModel(PATHS);
    expect(m.pathCount).toBe(4);
    expect(m.convertedCount).toBe(2);
    expect(m.baseConversionProbability).toBeCloseTo(0.5, 9);
    // Email is on every converting path: removing it kills every conversion.
    expect(m.removalEffects.email_automation).toBeCloseTo(1, 9);
    expect(m.removalEffects.paid_ads).toBeCloseTo(0.5, 9);
    expect(m.removalEffects.seo).toBeCloseTo(0.5, 9);
    expect(m.removalEffects.social).toBe(0);
    expect(m.attribution.email_automation).toBeCloseTo(0.5, 9);
    expect(m.attribution.paid_ads).toBeCloseTo(0.25, 9);
    expect(m.attribution.seo).toBeCloseTo(0.25, 9);
    expect(closeTo(sum(Object.values(m.attribution)), 1)).toBe(true);
    expect(m.transitions.start).toEqual({ paid_ads: 0.5, seo: 0.5 });
  });

  it("splits a channel's share across its touches on the path and normalises to 1", () => {
    const m = buildMarkovModel(PATHS);
    const touches = makeTouches([{ hoursBefore: 48, channelKey: "paid_ads" }, { hoursBefore: 2, channelKey: "email_automation" }]);
    const w = dataDrivenWeights(touches, m)!;
    expect(w[fid("t", 1)]).toBeCloseTo(1 / 3, 9);
    expect(w[fid("t", 2)]).toBeCloseTo(2 / 3, 9);
    const twoEmails = makeTouches([{ hoursBefore: 48, channelKey: "paid_ads" }, { hoursBefore: 20, channelKey: "email_automation" }, { hoursBefore: 2, channelKey: "email_automation" }]);
    const w3 = dataDrivenWeights(twoEmails, m)!;
    expect(w3[fid("t", 2)]).toBeCloseTo(w3[fid("t", 3)]!, 12);
    expect(closeTo(sum(Object.values(w3)), 1)).toBe(true);
  });

  it("returns null when no channel on the path has an effect, and {} for no touches", () => {
    const m = buildMarkovModel(PATHS);
    expect(dataDrivenWeights(makeTouches([{ hoursBefore: 1, channelKey: "social" }]), m)).toBeNull();
    expect(dataDrivenWeights([], m)).toEqual({});
  });

  it("a model with no converting path attributes nothing", () => {
    const m = buildMarkovModel([{ states: ["seo"], converted: false }]);
    expect(m.baseConversionProbability).toBe(0);
    expect(sum(Object.values(m.attribution))).toBe(0);
    expect(buildMarkovModel([]).pathCount).toBe(0);
  });

  it("conversionPathsFromTouches orders by time and maps missing channels to direct", () => {
    const touches = makeTouches([{ hoursBefore: 10, channelKey: "seo" }, { hoursBefore: 1, channelKey: null }]);
    const paths = conversionPathsFromTouches([{ touches: [touches[1]!, touches[0]!], converted: true }]);
    expect(paths).toEqual([{ states: ["seo", "direct"], converted: true }]);
  });

  it("handles a cycle (a channel revisited) without diverging", () => {
    const m = buildMarkovModel([
      { states: ["seo", "social", "seo", "email_automation"], converted: true },
      { states: ["social", "seo", "social"], converted: false },
      { states: ["seo", "seo"], converted: true },
    ]);
    expect(m.baseConversionProbability).toBeGreaterThan(0);
    expect(m.baseConversionProbability).toBeLessThanOrEqual(1);
    expect(closeTo(sum(Object.values(m.attribution)), 1)).toBe(true);
  });
});

describe("chooseModel / attribute — the 200-conversion switch", () => {
  it("is position-based below 200 and data-driven from the 200th conversion", () => {
    expect(LIMITS.attributionPositionBasedUntilConversions).toBe(200);
    expect(chooseModel(0)).toBe("position_based_40_20_40");
    expect(chooseModel(199)).toBe("position_based_40_20_40");
    expect(chooseModel(200)).toBe("data_driven_markov");
    expect(chooseModel(5_000)).toBe("data_driven_markov");
  });

  it("attribute() falls back to position-based when the data-driven model is unusable, and says why", () => {
    const touches = makeTouches(FIVE_TOUCH);
    const below = attribute(touches, { conversionCount: 199 });
    expect(below.model).toBe("position_based_40_20_40");
    expect(below.reason).toContain("199");
    const noModel = attribute(touches, { conversionCount: 200 });
    expect(noModel.model).toBe("position_based_40_20_40");
    expect(noModel.reason).toMatch(/no Markov/);
    const m = buildMarkovModel([{ states: ["paid_ads", "seo"], converted: true }, { states: ["paid_ads"], converted: false }]);
    const withModel = attribute(touches, { conversionCount: 200, markov: m });
    expect(withModel.model).toBe("data_driven_markov");
    expect(closeTo(sum(Object.values(withModel.weights)), 1)).toBe(true);
    const unusable = attribute(makeTouches([{ hoursBefore: 1, channelKey: "social" }]), { conversionCount: 200, markov: m });
    expect(unusable.model).toBe("position_based_40_20_40");
  });
});

describe("consent and stitching", () => {
  it("without consent keeps first-party touches only and flags a partial journey", () => {
    const touches = makeTouches(FIVE_TOUCH);
    for (const consent of ["unknown", "denied", "withdrawn"] as const) {
      const r = filterTouchesForConsent(touches, consent);
      expect(r.partialJourney).toBe(true);
      expect(r.removed.map((t) => t.id)).toEqual([fid("t", 1)]);
      expect(r.touches).toHaveLength(4);
      expect(r.touches.every((t) => t.firstParty && !t.source.clickIds.gclid)).toBe(true);
    }
    const granted = filterTouchesForConsent(touches, "granted");
    expect(granted.partialJourney).toBe(false);
    expect(granted.touches).toHaveLength(5);
    expect(granted.removed).toEqual([]);
  });

  it("a first-party touch that still carries a click id is removed without consent", () => {
    const t = makeTouches([{ hoursBefore: 1, firstParty: true, source: { clickIds: { gclid: null, gbraid: null, wbraid: null, fbclid: "f", ttclid: null, li_fat_id: null, msclkid: null, twclid: null, rdt_cid: null } } }]);
    expect(filterTouchesForConsent(t, "denied").touches).toEqual([]);
  });

  it("selectJourneyTouches stitches the entity's touches with its visitors', inside the window, sorted, de-duplicated", () => {
    const mine = makeTouches(FIVE_TOUCH);
    const other = { ...mine[1]!, id: fid("x", 1), visitorId: fid("v", 9), entityId: OTHER_ENTITY_ID };
    const late = { ...mine[2]!, id: fid("x", 2), occurredAt: "2025-06-12T10:00:00.000Z" };
    const old = { ...mine[2]!, id: fid("x", 3), occurredAt: "2025-01-01T00:00:00.000Z" };
    const selected = selectJourneyTouches({ touches: [late, other, old, ...mine.slice().reverse(), mine[0]!], entityId: ENTITY_ID, visitorIds: [VISITOR_ID], before: CONVERTED_AT });
    expect(selected.map((t) => t.id)).toEqual(mine.map((t) => t.id));
    const noVisitor = selectJourneyTouches({ touches: mine, entityId: ENTITY_ID, before: CONVERTED_AT });
    expect(noVisitor.map((t) => t.id)).toEqual([fid("t", 3), fid("t", 5)]);
    const longWindow = selectJourneyTouches({ touches: [old, ...mine], entityId: ENTITY_ID, visitorIds: [VISITOR_ID], before: CONVERTED_AT, lookbackDays: 365 });
    expect(longWindow[0]!.id).toBe(fid("x", 3));
  });

  it("channelWeights totals the weights per channel, highest first", () => {
    const touches = makeTouches(FIVE_TOUCH);
    const w = positionBased4020(touches);
    const channels = channelWeights(touches, w);
    expect(channels[0]!.channelKey === "paid_ads" || channels[0]!.channelKey === "lead_generation").toBe(true);
    expect(channels.find((c) => c.channelKey === null)?.touchCount).toBe(1);
    expect(closeTo(sum(channels.map((c) => c.weight)), 1)).toBe(true);
    expect(sum(channels.map((c) => c.touchCount))).toBe(5);
  });
});
