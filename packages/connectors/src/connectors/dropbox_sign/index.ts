/** Live Dropbox Sign connector: Basic auth with the API key (per business or platform), form-encoded sends, verified callbacks. */
import { uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { basicAuth, createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { dropboxSignMock } from "./mock";
import { DROPBOX_SIGN_BASE_URL, DROPBOX_SIGN_CONNECT_FIELDS, DROPBOX_SIGN_KEY, DROPBOX_SIGN_RATE_LIMITS, dropboxSignTools, mapSignatureRequest, sendRequestForm, type HsListResponse, type HsSignatureRequest } from "./tools";
import { createDropboxSignWebhook } from "./webhooks";

export function createDropboxSignConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now, getBusinessSecret, resolveBusinessId } = resolveLiveOptions(options);
  const http = (apiKey: string | undefined): HttpClient => {
    if (!apiKey) throw new ConfigError(DROPBOX_SIGN_KEY, "DROPBOX_SIGN_API_KEY or a per-business credential");
    return createHttp({ connectorKey: DROPBOX_SIGN_KEY, baseUrl: DROPBOX_SIGN_BASE_URL, fetch, headers: { authorization: basicAuth(apiKey) } });
  };
  const forCtx = (ctx: ToolContext) => http(ctx.credential?.secret ?? secrets.dropboxSignApiKey);
  const webhook = createDropboxSignWebhook({
    apiKeyFor: async (businessId) => (businessId && getBusinessSecret ? await getBusinessSecret(businessId, "dropbox_sign_api_key") : null) ?? secrets.dropboxSignApiKey ?? null,
    resolveBusinessId,
    now,
  });

  return buildLiveConnector(
    {
      key: DROPBOX_SIGN_KEY,
      displayName: "Dropbox Sign",
      phase: 1,
      auth: { kind: "api_key" },
      tools: dropboxSignTools,
      rateLimits: DROPBOX_SIGN_RATE_LIMITS,
      now,
      webhooks: [webhook],
      handlers: {
        list_signature_requests: async ({ page, pageSize }, ctx) => {
          const res = await forCtx(ctx).json<HsListResponse>("GET", "/signature_request/list", { query: { page, page_size: pageSize } });
          return { items: res.signature_requests.map(mapSignatureRequest), numPages: res.list_info.num_pages };
        },
        get_signature_request: async ({ signatureRequestId }, ctx) => mapSignatureRequest((await forCtx(ctx).json<{ signature_request: HsSignatureRequest }>("GET", `/signature_request/${signatureRequestId}`)).signature_request),
        send_signature_request: async (args, ctx) => mapSignatureRequest((await forCtx(ctx).json<{ signature_request: HsSignatureRequest }>("POST", "/signature_request/send", { form: sendRequestForm(args) })).signature_request),
        cancel_signature_request: async ({ signatureRequestId }, ctx) => {
          await forCtx(ctx).raw("POST", `/signature_request/cancel/${signatureRequestId}`);
          return { cancelled: true as const, signatureRequestId };
        },
      },
      connectFields: DROPBOX_SIGN_CONNECT_FIELDS,
      // The founder's own key only: signature requests are billed to their plan, never to the platform's (BUILD §10).
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(DROPBOX_SIGN_KEY, "apiKey", "Enter your Dropbox Sign API key to connect Dropbox Sign");
        const account = await http(apiKey).json<{ account: { account_id: string; email_address: string } }>("GET", "/account");
        const createdAt = now().toISOString();
        return {
          id: uuid(), businessId, connectorKey: DROPBOX_SIGN_KEY, status: "connected", scopes: [], accountLabel: account.account.email_address, externalAccountId: account.account.account_id, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          await http(secrets.dropboxSignApiKey).json("GET", "/account");
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          return healthResult(e instanceof ConfigError ? "disconnected" : "degraded", startedAt, { now, message: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    dropboxSignMock,
  );
}

export { dropboxSignMock, createDropboxSignMock, signedCallbackRequest } from "./mock";
export { dropboxSignTools, DROPBOX_SIGN_KEY, DROPBOX_SIGN_CALLBACK_RESPONSE } from "./tools";
export { createDropboxSignWebhook, normaliseCallback as normaliseDropboxSignCallback } from "./webhooks";
