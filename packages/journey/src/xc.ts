/**
 * xC — expected conversion (BUILD §11.4 "xC: logistic regression on the business's touch features;
 * archetype priors until 50 conversions").
 *
 * Plain TypeScript: features per touch, logistic regression by full-batch gradient descent with L2 and a warm start
 * from the archetype prior, and `xcSeries` → the cumulative curve shown in the Match Day rails. Everything is
 * deterministic (no random initialisation, fixed epochs).
 */
import { CHANNEL_KEYS, type Archetype, type ChannelKey } from "@foundmill/shared/constants";
import { LIMITS } from "@foundmill/config";
import { OFFLINE_CHANNELS } from "./attribution";
import { compareByTimeThenId, hoursBetween } from "./time";
import type { Conversion, Touch, XcModel, XcPoint } from "./types";

// ---------------------------------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------------------------------

const BASE_FEATURES = [
  "bias",
  "log_touch_index", // log1p(position in the path)
  "months_since_first", // elapsed time since the first touch, in 30-day units, capped at 2
  "recency", // exp(−hours since the previous touch / 168)
  "identified", // the visitor is a known entity at this touch
  "code_redeemed",
  "distinct_channels", // distinct channels so far / 5, capped at 1
  "offline",
  "direct",
] as const;

export const XC_FEATURE_NAMES: readonly string[] = [...BASE_FEATURES, ...CHANNEL_KEYS.map((k) => `channel:${k}`)];
export const XC_FEATURE_COUNT = XC_FEATURE_NAMES.length;

export interface TouchFeatureContext {
  index: number;
  firstTouchAt: string;
  previousTouchAt: string | null;
  distinctChannelsSoFar: number;
}

export function touchFeatures(touch: Pick<Touch, "occurredAt" | "channelKey" | "kind" | "entityId">, ctx: TouchFeatureContext): number[] {
  const f = new Array<number>(XC_FEATURE_COUNT).fill(0);
  f[0] = 1;
  f[1] = Math.log1p(ctx.index);
  f[2] = Math.min(2, Math.max(0, hoursBetween(ctx.firstTouchAt, touch.occurredAt)) / 720);
  f[3] = ctx.previousTouchAt ? Math.exp(-Math.max(0, hoursBetween(ctx.previousTouchAt, touch.occurredAt)) / 168) : 0;
  f[4] = touch.entityId ? 1 : 0;
  f[5] = touch.kind === "code_redeemed" || touch.kind === "qr_scan" ? 1 : 0;
  f[6] = Math.min(1, ctx.distinctChannelsSoFar / 5);
  f[7] = touch.channelKey && OFFLINE_CHANNELS.has(touch.channelKey) ? 1 : 0;
  f[8] = touch.channelKey ? 0 : 1;
  if (touch.channelKey) f[BASE_FEATURES.length + CHANNEL_KEYS.indexOf(touch.channelKey)] = 1;
  return f;
}

/** Feature rows for an ordered path (one per touch, context accumulated). */
export function pathFeatures(touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt" | "channelKey" | "kind" | "entityId">>): number[][] {
  const sorted = [...touches].sort(compareByTimeThenId);
  const seen = new Set<string>();
  const rows: number[][] = [];
  sorted.forEach((t, i) => {
    seen.add(t.channelKey ?? "direct");
    rows.push(touchFeatures(t, { index: i, firstTouchAt: sorted[0]!.occurredAt, previousTouchAt: i > 0 ? sorted[i - 1]!.occurredAt : null, distinctChannelsSoFar: seen.size }));
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// Archetype priors
// ---------------------------------------------------------------------------------------------------

const PRIOR_BASE: Record<(typeof BASE_FEATURES)[number], number> = {
  bias: -2.2, log_touch_index: 0.35, months_since_first: -0.2, recency: 0.3, identified: 1.1, code_redeemed: 0.8, distinct_channels: 0.4, offline: 0.1, direct: 0.2,
};

/** Channel log-odds by archetype: which channels tend to produce converting touches for that kind of business. */
const PRIOR_CHANNELS: Record<Archetype, Partial<Record<ChannelKey, number>>> = {
  b2b_saas: { lead_generation: 0.9, email_automation: 0.8, content: 0.6, seo: 0.5, geo: 0.5, paid_ads: 0.3, events: 0.6, pr: 0.2, social: 0.1, affiliate: 0.2 },
  consumer_app: { paid_ads: 0.7, social: 0.7, influencer: 0.6, seo: 0.4, content: 0.2, email_automation: 0.5, pr: 0.3, affiliate: 0.2 },
  marketplace: { seo: 0.7, social: 0.5, paid_ads: 0.5, content: 0.4, email_automation: 0.5, affiliate: 0.4, pr: 0.3, geo: 0.3 },
  dtc_physical: { paid_ads: 0.8, influencer: 0.8, social: 0.6, email_automation: 0.6, affiliate: 0.4, print: 0.3, direct_mail: 0.4, outdoor: 0.2, broadcast: 0.2, seo: 0.3 },
  hardware: { pr: 0.7, events: 0.7, content: 0.5, paid_ads: 0.3, email_automation: 0.5, social: 0.3, lead_generation: 0.5 },
  services: { lead_generation: 0.8, pr: 0.5, seo: 0.6, email_automation: 0.5, events: 0.5, content: 0.4, social: 0.2, direct_mail: 0.3 },
  content_media: { social: 0.8, seo: 0.7, content: 0.7, email_automation: 0.6, geo: 0.3, paid_ads: 0.2, pr: 0.4 },
};

export function archetypePrior(archetype: Archetype): XcModel {
  const weights = new Array<number>(XC_FEATURE_COUNT).fill(0);
  BASE_FEATURES.forEach((name, i) => {
    weights[i] = PRIOR_BASE[name];
  });
  const channels = PRIOR_CHANNELS[archetype];
  CHANNEL_KEYS.forEach((k, i) => {
    weights[BASE_FEATURES.length + i] = channels[k] ?? 0;
  });
  return { source: "archetype_prior", archetype, featureNames: [...XC_FEATURE_NAMES], weights, trainedOn: 0 };
}

// ---------------------------------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------------------------------

export interface XcSample {
  features: number[];
  /** 1 when the touch sits on a converting path. */
  label: 0 | 1;
}

export interface TrainXcOptions {
  epochs?: number;
  learningRate?: number;
  /** L2 strength towards the warm-start weights (keeps few-sample fits near the prior). */
  l2?: number;
  /** Warm start; defaults to zeros. */
  init?: XcModel | null;
  archetype?: Archetype | null;
  /** Labelled conversions represented in the samples (for the 50-conversion rule). */
  conversionCount?: number;
}

export const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Full-batch gradient descent on the logistic loss with L2 towards the warm start. Deterministic. */
export function trainXcModel(samples: readonly XcSample[], opts: TrainXcOptions = {}): XcModel {
  const epochs = opts.epochs ?? 400;
  const lr = opts.learningRate ?? 0.15;
  const l2 = opts.l2 ?? 0.01;
  const init = opts.init?.weights ?? new Array<number>(XC_FEATURE_COUNT).fill(0);
  const w = init.slice();
  const n = samples.length;
  if (n > 0) {
    const grad = new Array<number>(w.length).fill(0);
    for (let e = 0; e < epochs; e++) {
      grad.fill(0);
      for (const s of samples) {
        let z = 0;
        for (let i = 0; i < w.length; i++) z += w[i]! * (s.features[i] ?? 0);
        const err = sigmoid(z) - s.label;
        for (let i = 0; i < w.length; i++) grad[i] = grad[i]! + err * (s.features[i] ?? 0);
      }
      for (let i = 0; i < w.length; i++) {
        const reg = i === 0 ? 0 : l2 * (w[i]! - init[i]!);
        w[i] = w[i]! - lr * (grad[i]! / n + reg);
      }
    }
  }
  return { source: "trained", archetype: opts.archetype ?? opts.init?.archetype ?? null, featureNames: [...XC_FEATURE_NAMES], weights: w, trainedOn: opts.conversionCount ?? 0 };
}

/** Samples from labelled paths: every touch of a converting path is a positive, every touch of a lost path a negative. */
export function xcSamplesFromPaths(paths: ReadonlyArray<{ touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt" | "channelKey" | "kind" | "entityId">>; converted: boolean }>): XcSample[] {
  const out: XcSample[] = [];
  for (const p of paths) for (const features of pathFeatures(p.touches)) out.push({ features, label: p.converted ? 1 : 0 });
  return out;
}

/** The archetype prior until 50 labelled conversions (LIMITS.xcArchetypePriorUntilConversions), then the trained model when there is one. */
export function selectXcModel(input: { archetype: Archetype; conversionCount: number; trained?: XcModel | null }): XcModel {
  if (input.conversionCount >= LIMITS.xcArchetypePriorUntilConversions && input.trained && input.trained.source === "trained") return input.trained;
  return archetypePrior(input.archetype);
}

// ---------------------------------------------------------------------------------------------------
// Curve
// ---------------------------------------------------------------------------------------------------

export interface XcSeriesInput {
  touches: ReadonlyArray<Pick<Touch, "id" | "occurredAt" | "channelKey" | "kind" | "entityId">>;
  model: XcModel;
  /** When given, the curve ends with a terminal point at the conversion (cumulative 1). */
  conversion?: Pick<Conversion, "occurredAt"> | null;
}

/**
 * The xC curve: `p` is each touch's own conversion probability under the model and `cumulative` is
 * 1 − Π(1 − p_j) over the touches so far, so the curve is non-decreasing and stays inside [0, 1).
 * With a conversion, a final point at the conversion time closes the curve at 1.
 */
export function xcSeries(input: XcSeriesInput): XcPoint[] {
  const sorted = [...input.touches].sort(compareByTimeThenId);
  const rows = pathFeatures(sorted);
  const w = input.model.weights;
  const points: XcPoint[] = [];
  let survival = 1;
  rows.forEach((features, i) => {
    let z = 0;
    for (let k = 0; k < w.length; k++) z += (w[k] ?? 0) * (features[k] ?? 0);
    const p = Math.min(1 - 1e-9, Math.max(0, sigmoid(z)));
    survival *= 1 - p;
    const cumulative = Math.min(1, Math.max(0, 1 - survival));
    points.push({ index: i, touchId: sorted[i]!.id, at: sorted[i]!.occurredAt, p: round6(p), cumulative: round6(cumulative) });
  });
  if (input.conversion) {
    const at = typeof input.conversion.occurredAt === "string" ? input.conversion.occurredAt : new Date(input.conversion.occurredAt).toISOString();
    points.push({ index: points.length, touchId: null, at, p: 0, cumulative: 1 });
  }
  return points;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
