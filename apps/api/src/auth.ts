/**
 * Bearer-token verification lives in `@foundmill/shared/auth-verifier`, shared with apps/stream (WP-11 T13). This file
 * re-exports it so the api's imports and suites stay as they were.
 */
export * from "@foundmill/shared/auth-verifier";
