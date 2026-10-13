/**
 * Live Anthropic connector: `models.list` / `models.retrieve` with the founder's BYOK key or the platform
 * key. Used by BYOK validation (BUILD §10.2) and route availability checks; completions go through
 * packages/models. Secrets are never logged and never returned.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, resolveModel } from "@foundmill/models/routing";
import { uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { anthropicMock } from "./mock";
import { routedModelReport, toModelInfo } from "./shared";
import { ANTHROPIC_KEY, ANTHROPIC_RATE_LIMITS, anthropicTools } from "./tools";

export function createAnthropicConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);

  const clientFor = (apiKey: string | undefined): Anthropic => {
    if (!apiKey) throw new ConfigError(ANTHROPIC_KEY, "ANTHROPIC_API_KEY or a BYOK credential", "set the platform key or connect a founder key");
    return new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000, fetch });
  };
  const keyFor = (ctx: ToolContext) => ctx.credential?.secret ?? secrets.anthropicApiKey;

  return buildLiveConnector(
    {
      key: ANTHROPIC_KEY,
      displayName: "Anthropic",
      phase: 1,
      auth: { kind: "api_key", platformKey: true },
      tools: anthropicTools,
      rateLimits: ANTHROPIC_RATE_LIMITS,
      now,
      handlers: {
        list_models: async ({ limit }, ctx) => {
          const page = await clientFor(keyFor(ctx)).models.list({ limit });
          return { models: page.data.map(toModelInfo), hasMore: page.hasNextPage() };
        },
        get_model: async ({ modelId }, ctx) => toModelInfo(await clientFor(keyFor(ctx)).models.retrieve(modelId)),
        validate_key: async (_args, ctx) => {
          const client = clientFor(keyFor(ctx));
          try {
            const ids = new Set<string>();
            for await (const m of client.models.list({ limit: 100 })) ids.add(m.id);
            // A key may be valid yet lack access to a routed model (new model, restricted workspace).
            const report = routedModelReport(ids);
            for (const r of report) {
              if (!r.available) {
                try {
                  await client.models.retrieve(r.modelId);
                  r.available = true;
                } catch {
                  /* stays unavailable */
                }
              }
            }
            const missing = report.filter((r) => !r.available).map((r) => r.modelId);
            return { valid: missing.length === 0, reason: missing.length ? `Key cannot access: ${missing.join(", ")}` : null, routedModels: report, checkedAt: now().toISOString() };
          } catch (e) {
            const status = (e as { status?: number }).status;
            if (status === 401 || status === 403) return { valid: false, reason: `Anthropic rejected the key (${status})`, routedModels: routedModelReport(new Set()), checkedAt: now().toISOString() };
            throw e;
          }
        },
        // The business's own key only: a panel question is the business's research, never the platform's spend.
        ask_panel: async ({ question }, ctx) => {
          if (!ctx.credential?.secret) throw new ConfigError(ANTHROPIC_KEY, "the business's own Anthropic key", "store one in Settings › Keys");
          const model = resolveModel("worker").modelId;
          const response = await clientFor(ctx.credential.secret).messages.create({ model, max_tokens: 2048, output_config: { effort: "low" }, messages: [{ role: "user", content: question }] });
          const answer = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
          return { question, answer: answer || "(no answer)", model: response.model };
        },
      },
      connect: async (businessId, input) => {
        // BYOK: the gateway passes { apiKey } once; we validate it and hand it back for encryption.
        const apiKey = typeof input === "object" && input && typeof (input as { apiKey?: unknown }).apiKey === "string" ? (input as { apiKey: string }).apiKey : undefined;
        const client = clientFor(apiKey ?? secrets.anthropicApiKey);
        await client.models.retrieve(MODELS.haiku);
        const createdAt = now().toISOString();
        return {
          id: uuid(),
          businessId,
          connectorKey: ANTHROPIC_KEY,
          status: "connected",
          scopes: ["models:read", "messages:write"],
          accountLabel: apiKey ? "Anthropic (founder key)" : "Anthropic (platform credits)",
          externalAccountId: null,
          config: { billing: apiKey ? "byok" : "credits" },
          credentialRef: null,
          expiresAt: null,
          lastHealthAt: createdAt,
          createdAt,
          ...(apiKey ? { credentialToStore: { kind: "api_key" as const, secret: apiKey } } : {}),
        };
      },
      healthcheck: async () => {
        const startedAt = now().getTime();
        try {
          await clientFor(secrets.anthropicApiKey).models.retrieve(MODELS.haiku);
          return healthResult("connected", startedAt, { now });
        } catch (e) {
          if (e instanceof ConfigError) return healthResult("disconnected", startedAt, { message: e.message, now });
          return healthResult("degraded", startedAt, { message: e instanceof Error ? e.message : String(e), now });
        }
      },
    },
    anthropicMock,
  );
}

export { anthropicMock } from "./mock";
export { anthropicTools, ANTHROPIC_KEY } from "./tools";
