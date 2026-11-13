// @foundmill/models — see docs/ARCHITECTURE.md §6 and BUILD §10.
export * from "./routing";
export * from "./pricing";
export * from "./types";
export * from "./errors";
export { platformBillingRefusal, clearPlatformBillingRefusal, notePlatformBillingRefusal, type PlatformBillingRefusal } from "./billing-state";
export { canonicalJson, stableHash, seededRng, uuidFromSeed, isUuidLike, UUID_RE, type Rng } from "./hash";
export { parseJsonLoose } from "./json";
export { JsonElementScanner, getAtPath, arrayAtPath, elementPathKeys, type ScannedElement, type JsonElementScannerOptions } from "./stream-json";
export { streamStructured, runStructuredStream, StreamInterruptedError, elementIndexOf, DEFAULT_PARTIAL_THROTTLE_MS, MAX_STREAM_INTERRUPTIONS, type StreamCallArgs, type StreamCallResult, type StructuredStreamDeps } from "./structured-stream";
export * from "./rate-limit";
export { gateModelClient, type ModelCallGate, type ModelCallVerdict } from "./gate";
export * from "./schemas";
export * from "./planParams";
// Team call (docs/TEAM_CALL.md §4): not through ./schemas, which this module imports `PlanAction` from.
export * from "./team-call-schema";
export {
  createModelClient,
  effectiveModelMode,
  LiveModelClient,
  validateApiKey,
  billingRefusal,
  keyFingerprint,
  MAX_TOKENS_CEILING,
  ROUTE_RESERVE_TOKENS,
  DEFAULT_MAX_ATTEMPTS,
  type CreateModelClientOptions,
  type LiveModelClientOptions,
} from "./client";
export * from "./mock";
