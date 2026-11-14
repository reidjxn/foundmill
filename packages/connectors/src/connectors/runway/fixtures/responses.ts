/**
 * Canned Runway answers, shaped as documented at https://docs.dev.runwayml.com (openapi.json: POST /v1/text_to_video,
 * POST /v1/image_to_video, GET /v1/tasks/{id}, GET /v1/organization; read Nov 13, 2026). No live account was used:
 * these are the documented shapes, not recordings. Re-record against a real key when one is available.
 */
export const TASK_ID = "17f20503-6c24-4c16-946b-35dbbce2af2f";

export const START_OK = { id: TASK_ID, estimatedCost: { credits: 60 } };

export const TASK_PENDING = { id: TASK_ID, createdAt: "2026-11-13T10:00:00.000Z", status: "PENDING", estimatedCost: { credits: 60 } };
export const TASK_THROTTLED = { id: TASK_ID, createdAt: "2026-11-13T10:00:00.000Z", status: "THROTTLED", estimatedCost: { credits: 60 } };
export const TASK_RUNNING = { id: TASK_ID, createdAt: "2026-11-13T10:00:00.000Z", status: "RUNNING", progress: 0.4, estimatedCost: { credits: 60 } };
export const OUTPUT_URL = "https://dnznrvs05pmza.cloudfront.net/clips/17f20503.mp4?_jwt=eyJhbGciOiJIUzI1NiJ9.signed-part&_runway=1";
export const TASK_SUCCEEDED = { id: TASK_ID, createdAt: "2026-11-13T10:00:00.000Z", status: "SUCCEEDED", output: [OUTPUT_URL], cost: { credits: 60 } };
export const TASK_FAILED = { id: TASK_ID, createdAt: "2026-11-13T10:00:00.000Z", status: "FAILED", failure: "Content moderation: the prompt was refused.", failureCode: "SAFETY.INPUT.TEXT", cost: { credits: 60 } };
export const TASK_CANCELLED = { id: TASK_ID, createdAt: "2026-11-13T10:00:00.000Z", status: "CANCELLED", cost: { credits: 0 } };
export const TASK_NOT_FOUND = { error: "Task not found" };

export const ORGANIZATION_OK = { creditBalance: 2400, tier: { maxMonthlyCreditSpend: 10000, models: {} }, usage: {} };

export const UNAUTHORIZED = { error: "Invalid API key" };
export const BAD_REQUEST = { error: "Validation of body failed", issues: [{ code: "too_big", path: ["promptText"], message: "String must contain at most 1000 character(s)" }] };
export const RATE_LIMITED = { error: "You have exceeded the rate limit for this endpoint." };
export const INSUFFICIENT_CREDITS = { error: "You do not have enough credits to run this task." };
