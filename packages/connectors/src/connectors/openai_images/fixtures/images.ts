/**
 * Canned answers in the shape OpenAI documents for `POST /v1/images/generations` and its errors (image generation guide,
 * checked 2026-10-22). The image is a 1x1 WebP so the fixture stays small; the connector never decodes it.
 */
export const TINY_WEBP_BASE64 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

export const IMAGES_OK = { created: 1_760_000_000, data: [{ b64_json: TINY_WEBP_BASE64 }], output_format: "webp", quality: "medium", size: "1024x1024", usage: { total_tokens: 1056, input_tokens: 56, output_tokens: 1000 } };

export const IMAGES_MODERATION_BLOCKED = { error: { message: "Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com.", type: "image_generation_user_error", param: null, code: "moderation_blocked" } };

/** OpenAI masks the key it echoes back; the connector must still never pass such text on unredacted. */
export const IMAGES_BAD_KEY = { error: { message: "Incorrect API key provided: sk-proj-abcdefghijklmnop1234. You can find your API key at https://platform.openai.com/account/api-keys.", type: "invalid_request_error", param: null, code: "invalid_api_key" } };

export const IMAGES_RATE_LIMITED = { error: { message: "Rate limit reached for images. Please try again in 20s.", type: "rate_limit_exceeded", param: null, code: "rate_limit_exceeded" } };
