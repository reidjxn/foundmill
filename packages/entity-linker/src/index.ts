/**
 * @founder-manager/entity-linker — the hyperlinking pipeline (BUILD §2.1 rule 3, §11.3, §11.12).
 *
 *   buildManifest(entities)            → Manifest { byId, byAlias, text, lines, toJSON }
 *   parseEntityMarkup / validateMarkup → segments, { valid, unknownIds, invisibleIds, ... }
 *   buildReask / stripInvalidMentions  → the single re-ask, and the final fallback
 *   sweep(text, manifest, client?)     → exact → alias → fuzzy → partial; ambiguous → "Which one?"; unknown → draft
 *   resolveIdentity / planMerge        → strong identifiers, name+org score, thresholds, reversible merges
 *   toRenderTree                       → framework-free nodes for Dugout's EntityLink
 */
export * from "./types";
export { buildManifest, normalizeName, manifestLine, lookupByName, type BuildManifestOptions } from "./manifest";
export {
  parseEntityMarkup,
  validateMarkup,
  stripMarkup,
  renderPlain,
  serializeSegments,
  formatEntityMarkup,
  findMalformedMarkup,
  extractEntityIds,
  displayMatches,
} from "./markup";
export { buildReask, shouldReask, stripInvalidMentions, MAX_REASKS, type Reask, type ReaskOptions, type ReaskSuggestion } from "./reask";
export { sweep, guessKind, TIER_CONFIDENCE, SWEEP_SYSTEM_PROMPT, type SweepOptions } from "./sweep";
export { FUZZY_THRESHOLD, similarity, trigrams, trigramWords, bestSimilarity, foldText } from "./trigram";
export {
  STRONG_IDENTIFIERS,
  AUTO_MERGE_THRESHOLD,
  SUGGEST_THRESHOLD,
  normalizeIdentifier,
  normalizeIdentifiers,
  matchStrongIdentifiers,
  nameSimilarity,
  orgSimilarity,
  scoreNameOrg,
  decide,
  resolveIdentity,
  resolveIdentityWithModel,
  createModelScorer,
  planMerge,
  unmerge,
  type StrongIdentifier,
  type Identifiers,
  type IdentityRecord,
  type ResolutionDecision,
  type ScoredMatch,
  type Resolution,
  type ResolveOptions,
  type NameOrgScore,
  type MergeableEntity,
  type MergePlan,
} from "./resolve";
export { toRenderTree, entityIdsInTree, renderTreeToPlain, AMBIGUOUS_PROMPT, type RenderOptions } from "./render";
export { checkComposerText, linkComposerText, type ComposerCheck, type LinkedText } from "./pipeline";
