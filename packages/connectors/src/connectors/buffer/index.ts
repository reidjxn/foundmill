/**
 * Live Buffer connector over the injected fetch (no SDK). The founder's own Buffer account only: the key comes from the
 * connect form and then from `ctx.credential`; there is no platform key and `secrets` is never read. The key travels in
 * the Authorization header and nowhere else. The organization is chosen when the founder connects and stored
 * (`integration.config.organizationId`); it is never a tool argument, and a channel from another organization of the
 * same key is treated as not found.
 *
 * Buffer answers GraphQL with HTTP 200 and `errors[]`. Every failure here is rebuilt from a status or an
 * `extensions.code` of ours: the vendor's message text never reaches an agent (it is third-party text, and a vendor body
 * could echo a key).
 *
 * NO WEBHOOKS: Buffer's API offers none that this version uses. Whether a post went out is read with `get_post`.
 */
import { AppError, uuid } from "@foundmill/shared";
import { ConfigError, ConnectInputError, connectInputValue, VendorError, type Connector, type DecryptedCredential, type IntegrationRecord } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { bearer, createHttp } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { bufferMock } from "./mock";
import {
  ACCOUNT_QUERY, BUFFER_CONNECT_FIELDS, BUFFER_KEY, BUFFER_BASE_URL, BUFFER_RATE_LIMITS, CHANNELS_QUERY, CHANNEL_QUERY, CODES, CREATE_POST_MUTATION, ORGANIZATION_ID_RE, POST_QUERY,
  bufferTools, createPostLedger, mapChannel, mapChannels, mapPost, queuePostFlow, shownName,
  type BfAccountData, type BfChannelData, type BfChannelsData, type BfCreateData, type BfOrganization, type BfPostData,
} from "./tools";

/** Buffer keys have no documented format: only the key in hand is masked out of text. */
export const redactKeys = (text: string, secret?: string): string => (secret ? text.split(secret).join("…") : text);

interface GraphQlBody<T> {
  data?: T | null;
  errors?: { message?: unknown; extensions?: { code?: unknown } }[] | null;
}

export function createBufferConnector(options: LiveConnectorOptions = {}): Connector {
  const { fetch, now } = resolveLiveOptions(options);
  const ledger = createPostLedger(now);

  const missingKey = () => new ConfigError(BUFFER_KEY, "the business's own Buffer API key", "connect Buffer in Settings › Integrations");

  /** The stored organization. A stored value that is not an id is a setup fault, never ignored. */
  const organizationOf = (integration: IntegrationRecord): string => {
    const o = integration.config?.organizationId;
    if (typeof o !== "string" || !ORGANIZATION_ID_RE.test(o)) throw new ConfigError(BUFFER_KEY, "a stored Buffer organization", "reconnect Buffer in Settings › Integrations");
    return o;
  };

  /**
   * One GraphQL call with the given key. A transport failure is rebuilt from its status; 401 is a wrong key; 429 carries
   * Retry-After as a number of seconds; a 200 with `errors[]` is mapped by `extensions.code`.
   */
  const call = async <T>(secret: string, query: string, variables?: Record<string, unknown>): Promise<T> => {
    const http = createHttp({ connectorKey: BUFFER_KEY, baseUrl: BUFFER_BASE_URL, fetch, headers: { authorization: bearer(secret) } });
    let res: Response;
    try {
      res = await http.raw("POST", "/", { body: { query, ...(variables ? { variables } : {}) }, okStatuses: [401, 429] });
    } catch (e) {
      if (!(e instanceof VendorError)) throw e;
      throw new VendorError(BUFFER_KEY, e.httpStatus, `POST / → ${e.httpStatus}`);
    }
    if (res.status === 401) throw new VendorError(BUFFER_KEY, 401, "POST / → 401 (Buffer did not accept the API key)");
    if (res.status === 429) {
      const wait = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
      throw new VendorError(BUFFER_KEY, 429, `POST / → 429 (Buffer's rate limit${Number.isFinite(wait) && wait > 0 ? `; try again in ${Math.min(wait, 86_400)} seconds` : ""})`);
    }
    let body: GraphQlBody<T>;
    try {
      body = (await res.json()) as GraphQlBody<T>;
    } catch {
      throw new VendorError(BUFFER_KEY, 502, "POST / returned non-JSON body");
    }
    const codes = (body?.errors ?? []).map((e) => (typeof e?.extensions?.code === "string" ? e.extensions.code : "UNKNOWN"));
    if (codes.length > 0 && (body.data === null || body.data === undefined || codes.some((c) => c === "UNAUTHORIZED" || c === "RATE_LIMIT_EXCEEDED"))) {
      if (codes.includes("UNAUTHORIZED")) throw new VendorError(BUFFER_KEY, 401, "POST / → 401 (UNAUTHORIZED)");
      if (codes.includes("INSUFFICIENT_SCOPE")) throw new AppError(CODES.insufficientScope, "This Buffer key is not allowed to do that. Create a key with full access in Buffer (Settings › API) and reconnect it in Settings › Integrations.", 403);
      if (codes.includes("RATE_LIMIT_EXCEEDED")) throw new VendorError(BUFFER_KEY, 429, "POST / → 429 (RATE_LIMIT_EXCEEDED)");
      throw new VendorError(BUFFER_KEY, 502, "POST / answered with an error");
    }
    if (body?.data === null || body?.data === undefined) throw new VendorError(BUFFER_KEY, 502, "POST / answered without data");
    return body.data;
  };

  const organizations = async (secret: string): Promise<{ id: string; name: string }[]> => {
    const data = await call<BfAccountData>(secret, ACCOUNT_QUERY);
    return (data.account?.organizations ?? [])
      .filter((o: BfOrganization): o is { id: string; name?: unknown } => typeof o?.id === "string" && ORGANIZATION_ID_RE.test(o.id))
      .map((o) => ({ id: o.id, name: shownName(o.name) }));
  };

  return buildLiveConnector(
    {
      key: BUFFER_KEY,
      displayName: "Buffer",
      phase: 2,
      auth: { kind: "api_key" },
      tools: bufferTools,
      rateLimits: BUFFER_RATE_LIMITS,
      now,
      handlers: {
        list_channels: async (_a, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const data = await call<BfChannelsData>(secret, CHANNELS_QUERY, { organizationId: organizationOf(ctx.integration) });
          const out = mapChannels(data);
          ctx.log.info({ connector: BUFFER_KEY, tool: "list_channels", count: out.channels.length }, "buffer channels listed");
          return out;
        },
        queue_post: async (args, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const organizationId = organizationOf(ctx.integration);
          const out = await queuePostFlow(args, {
            businessId: ctx.businessId,
            now,
            ledger,
            lookupChannel: async (id) => {
              const data = await call<BfChannelData>(secret, CHANNEL_QUERY, { id });
              // A channel of another organization of the same key is not this project's.
              if (!data.channel || data.channel.organizationId !== organizationId) return null;
              return mapChannel(data.channel);
            },
            createPost: async (input) => (await call<BfCreateData>(secret, CREATE_POST_MUTATION, { input })).createPost,
          });
          ctx.log.info({ connector: BUFFER_KEY, tool: "queue_post", network: out.network, status: out.status, withImage: out.withImage }, "buffer post queued");
          return out;
        },
        get_post: async ({ postId }, ctx) => {
          const secret = ctx.credential?.secret;
          if (!secret) throw missingKey();
          const post = mapPost((await call<BfPostData>(secret, POST_QUERY, { id: postId })).post);
          if (!post) throw new VendorError(BUFFER_KEY, 404, "POST / → 404 (no post with that id)");
          return post;
        },
      },
      connectFields: BUFFER_CONNECT_FIELDS,
      connect: async (businessId, input) => {
        const apiKey = connectInputValue(input, "apiKey");
        if (!apiKey) throw new ConnectInputError(BUFFER_KEY, "apiKey", "Enter your Buffer API key to connect Buffer");
        const wanted = connectInputValue(input, "organizationId");
        if (wanted && !ORGANIZATION_ID_RE.test(wanted)) throw new ConnectInputError(BUFFER_KEY, "organizationId", "That is not a Buffer organization id. Leave it empty if your account has one organization");
        const orgs = await organizations(apiKey);
        if (orgs.length === 0) throw new ConnectInputError(BUFFER_KEY, "apiKey", "This Buffer account has no organization yet. Finish setting up Buffer, then connect again");
        const chosen = wanted ? orgs.find((o) => o.id === wanted) : orgs.length === 1 ? orgs[0] : undefined;
        if (!chosen) {
          const list = orgs.map((o) => `${o.name} (${o.id})`).join("; ");
          throw new ConnectInputError(BUFFER_KEY, "organizationId", wanted ? `Your Buffer account has no organization with that id. Yours: ${list}` : `Your Buffer account has more than one organization. Enter the id of the one to use: ${list}`);
        }
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: BUFFER_KEY,
          status: "connected",
          scopes: [],
          accountLabel: chosen.name,
          externalAccountId: chosen.id,
          config: { organizationId: chosen.id },
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          credentialToStore: { kind: "api_key" as const, secret: apiKey },
        };
      },
      healthcheck: async (integration, credential?: DecryptedCredential) => {
        const startedAt = now().getTime();
        const secret = credential?.secret;
        if (!secret) return healthResult("disconnected", startedAt, { now, message: "No Buffer API key is connected" });
        try {
          const orgs = await organizations(secret);
          const stored = integration.config?.organizationId;
          if (typeof stored === "string" && !orgs.some((o) => o.id === stored)) return healthResult("degraded", startedAt, { now, message: "the connected Buffer organization is no longer on this account" });
          return healthResult("connected", startedAt, { now, details: { organizations: orgs.length } });
        } catch (e) {
          return healthResult("degraded", startedAt, { now, message: redactKeys(e instanceof Error ? e.message : String(e), secret) });
        }
      },
    },
    bufferMock,
  );
}

export { bufferMock, createBufferMock } from "./mock";
export { bufferTools, BUFFER_KEY } from "./tools";
