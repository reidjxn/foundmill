/**
 * Canned answers in the shapes ElevenLabs documents for `POST /v1/text-to-speech/{voice_id}` and
 * `POST /v1/speech-to-text`, and for their errors (API reference, checked Nov 12, 2026). The audio is a few bytes of an
 * MPEG-1 Layer III frame header after an ID3 tag: the connector never decodes it, it only hands it on as base64.
 */
export const TINY_MP3 = Buffer.concat([Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1"), Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00])]);
export const TINY_MP3_BASE64 = TINY_MP3.toString("base64");

/** A 200 answer to a transcription: the documented fields (word timings are not asked for). */
export const TRANSCRIPT_OK = { language_code: "eng", language_probability: 0.98, text: " Let's talk about the launch email. ", words: [], audio_duration_secs: 4.2 };
/** The same without `audio_duration_secs` (the schema marks it optional). */
export const TRANSCRIPT_NO_DURATION = { language_code: "eng", language_probability: 0.9, text: "hello there", words: [] };

/** 422: validation errors are a list. */
export const VALIDATION_ERROR = { detail: [{ loc: ["body", "text"], msg: "Field required", type: "missing" }] };
/** 401 with a key quoted back, as a vendor sometimes does: the connector must not pass it on. */
export const BAD_KEY = { detail: { status: "invalid_api_key", message: "Invalid API key: sk_0123456789abcdef0123456789abcdef0123456789abcdef" } };
export const QUOTA_EXCEEDED = { detail: { status: "quota_exceeded", message: "This request exceeds your quota of 10000. You have 12 credits remaining." } };
export const TOO_MANY = { detail: { status: "too_many_concurrent_requests", message: "Too many concurrent requests." } };
