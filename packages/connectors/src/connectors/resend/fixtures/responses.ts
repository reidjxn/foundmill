/** Canned Resend answers, shaped as documented at https://resend.com/docs/api-reference/domains/list-domains, .../emails/send-email and .../errors (read Nov 12, 2026). */
export const DOMAINS_OK = {
  object: "list",
  has_more: false,
  data: [
    { id: "d91cd9bd-1176-453e-8fc1-35364d380206", name: "northwindskincare.com", status: "verified", created_at: "2026-08-02T10:12:00.000Z", region: "us-east-1", open_tracking: false, click_tracking: false, capabilities: { sending: "enabled", receiving: "disabled" } },
    { id: "5b0e7c52-6f10-49a0-9a9e-0d3a5f1c2b77", name: "news.northwindskincare.com", status: "not_started", created_at: "2026-10-01T08:00:00.000Z", region: "eu-west-1", open_tracking: false, click_tracking: false, capabilities: { sending: "enabled", receiving: "disabled" } },
  ],
};

export const DOMAINS_NONE_VERIFIED = { object: "list", has_more: false, data: [DOMAINS_OK.data[1]] };

export const SEND_OK = { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" };

export const RESTRICTED_KEY = { statusCode: 401, name: "restricted_api_key", message: "This API key is restricted to only send emails" };
export const INVALID_KEY = { statusCode: 401, name: "validation_error", message: "API key is invalid" };
export const RATE_LIMITED = { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests. You can only make 10 requests per second." };
export const QUOTA_EXCEEDED = { statusCode: 429, name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." };
export const IDEMPOTENCY_CONFLICT = { statusCode: 409, name: "invalid_idempotent_request", message: "Same idempotency key used with a different request payload." };

/** The mock account: one verified fixture domain and one that is not. */
export const MOCK_VERIFIED_DOMAIN = "northwindskincare.com";
export const MOCK_UNVERIFIED_DOMAIN = "news.northwindskincare.com";
/** Addresses already on the mock project's suppression list (an opt-out and a bounce). */
export const MOCK_SUPPRESSED = ["unsub@example.com", "bounced@example.com"];
