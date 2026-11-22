// @foundmill/models — see docs/ARCHITECTURE.md §6 and BUILD §10.
export * from "./routing";
export * from "./pricing";
export * from "./types";
export * from "./batch";
export * from "./training-estimate";
export * from "./errors";
export { platformBillingRefusal, clearPlatformBillingRefusal, notePlatformBillingRefusal, type PlatformBillingRefusal } from "./billing-state";
export { canonicalJson, stableHash, seededRng, uuidFromSeed, isUuidLike, UUID_RE, type Rng } from "./hash";
export { parseJsonLoose } from "./json";
export { JsonElementScanner, getAtPath, arrayAtPath, elementPathKeys, type ScannedElement, type JsonElementScannerOptions } from "./stream-json";
export { streamStructured, runStructuredStream, StreamInterruptedError, elementIndexOf, DEFAULT_PARTIAL_THROTTLE_MS, MAX_STREAM_INTERRUPTIONS, type StreamCallArgs, type StreamCallResult, type StructuredStreamDeps } from "./structured-stream";
export * from "./rate-limit";
export { gateModelClient, type ModelCallGate, type ModelCallVerdict } from "./gate";
export { enforceModelFunding, type FreeCapCheck, type FundingOf, type ModelFunding } from "./free-plan";
export * from "./schemas";
export * from "./planParams";
// Team call (docs/TEAM_CALL.md §4): not through ./schemas, which this module imports `PlanAction` from.
export * from "./team-call-schema";
// The design check's reviewer (item 13): route `designReview`, the only route that carries images.
export * from "./design-review-schema";
export { assertImagesAllowed, countImages, withoutImageData, ImageNotAllowedError, MAX_IMAGES_PER_REQUEST, MAX_IMAGE_BASE64_CHARS, IMAGE_TOKEN_ESTIMATE } from "./images";
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
export { OWN_KEY_GATEWAY_PATH, OWN_KEY_MISSING, OWN_KEY_REFUSED, ownKeyViaGateway, routeOwnKeyCalls, type OwnKeyViaGatewayOptions, type RouteOwnKeyOptions } from "./own-key-route";
