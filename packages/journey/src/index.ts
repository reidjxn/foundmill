// @foundmill/journey — attribution, xC, journey builder, round-up, trophies, chapters, daily rows and the
// synthetic journey data generator (docs/ARCHITECTURE.md §1, BUILD §11.2, §11.4, §17.2).
export * from "./types";
export {
  parseTouchSource, positionBased4020, buildMarkovModel, dataDrivenWeights, conversionPathsFromTouches, chooseModel, attribute,
  channelWeights, filterTouchesForConsent, selectJourneyTouches, hasClickIds, touchState, OFFLINE_CHANNELS, MARKOV_STATES,
} from "./attribution";
export type {
  AttributionRegistry, CodeRegistryEntry, ParseTouchSourceInput, ParsedTouchSource, TouchMedium, SelectJourneyTouchesInput, ConsentFilterResult,
  MarkovState, MarkovModel, ConversionPath, AttributeOptions, AttributionResult,
} from "./attribution";
export {
  XC_FEATURE_NAMES, XC_FEATURE_COUNT, touchFeatures, pathFeatures, archetypePrior, trainXcModel, xcSamplesFromPaths, selectXcModel, xcSeries, sigmoid,
} from "./xc";
export type { TouchFeatureContext, XcSample, TrainXcOptions, XcSeriesInput } from "./xc";
export { buildJourney, shouldPlayFullMatchDay, matchdayLevelFor } from "./builder";
export type { BuildJourneyInput, JourneyAgentInput, JourneyCounts, JourneyCosts } from "./builder";
export { percentile75, applyVolumeRules, buildDailyRoundup } from "./roundup";
export type { MatchDayDecision, ApplyVolumeRulesOptions, RoundupEntry, RoundupRow, RoundupTable } from "./roundup";
export { TROPHIES, TROPHY_BY_KEY, EVENT_TROPHIES, eventTrophyDescription, detectTrophies, customerTrophyFor, isEnterpriseContract, isTrophyKey, formatThreshold, thresholdFor, enterpriseContractMinMinor, ENTERPRISE_CONTRACT_MIN_MAJOR, ENTERPRISE_CONTRACT_MIN_MINOR } from "./trophies";
export type { TrophyCounters, TrophyMetric, TrophyDefinition, DetectTrophiesInput } from "./trophies";
export { buildChapters, chapterIdFor, provisionalChapterTitle } from "./chapters";
export type { BuildChaptersInput } from "./chapters";
export { aggregateDaily, emptyDailyRow, sortDaily, mergeDaily, rollupDaily, fillDays, sumDaily, trailingSum } from "./daily";
export type { AggregateDailyInput, DailySessionLike, DailyTaskLike, DailyChannelSpendLike, DailyDecisionLike, DailyTotals } from "./daily";
export { generateSyntheticJourneyData, generateSyntheticConversionPath, syntheticConversionGroups, emptyTouchSource } from "./synthetic";
export type {
  SyntheticDepartmentInput, GenerateSyntheticJourneyDataOptions, SyntheticJourneyData, SyntheticCustomer, SyntheticVisitor, SyntheticAgent, SyntheticCampaign,
  GenerateSyntheticConversionPathOptions, SyntheticConversionPath,
} from "./synthetic";
export { createSeededRng, clamp } from "./rng";
export type { SeededRng } from "./rng";
export {
  dayKeyUtc, dayKeyToDate, addDaysKey, daysBetween, eachDayKey, isoWeekdayUtc, hoursBetween, quarterOf, quarterStart, quarterEnd, compareByTimeThenId, toIso, DAY_MS, HOUR_MS,
} from "./time";
