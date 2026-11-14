import { AppError } from "@foundmill/shared";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, uuidFromSeed } from "../../mock-utils";
import { CH_INSTAGRAM, CH_LINKEDIN, CH_MASTODON, CH_TIKTOK, CH_X, ORG_ID } from "./fixtures/responses";
import { BUFFER_CONNECT_FIELDS, BUFFER_KEY, BUFFER_RATE_LIMITS, bufferTools, createPostLedger, mapChannel, mapChannels, queuePostFlow, type BfChannel, type BufferChannelT, type GetPostOutputT } from "./tools";

export const MOCK_NOTICE = "Simulated: nothing was queued in Buffer and nothing was posted. These are invented example channels.";

const MOCK_CHANNELS: BfChannel[] = [CH_X, CH_LINKEDIN, CH_INSTAGRAM, CH_TIKTOK, CH_MASTODON];

interface MockPost {
  id: string;
  channelId: string;
  service: string;
  dueAt: string;
  text: string;
}

/**
 * One Buffer account per business: the queued posts are the business's own. Every call is recorded and nothing leaves.
 * The mock never reports a post as sent: a queued post stays `scheduled`, so nothing simulated reads as published.
 * The same refusals as the live side apply (they share `queuePostFlow`); the clock for "in the future" is the real one,
 * the slot a `queue` post gets is fixed, so results are deterministic.
 */
export function createBufferMock(options: { clock?: () => Date } = {}) {
  const clock = options.clock ?? (() => new Date());
  const ledger = createPostLedger(clock);
  const world = perBusiness(() => ({ posts: new Map<string, MockPost>() }));
  const channelById = (id: string): BufferChannelT | null => {
    const raw = MOCK_CHANNELS.find((c) => c.id === id);
    return raw ? mapChannel(raw) : null;
  };

  const connector = buildMockConnector({
    key: BUFFER_KEY,
    displayName: "Buffer",
    phase: 2,
    auth: { kind: "api_key" },
    tools: bufferTools,
    rateLimits: BUFFER_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      list_channels: async () => ({ ...mapChannels({ channels: MOCK_CHANNELS }), simulated: true as const, notice: MOCK_NOTICE }),
      queue_post: async (args, ctx) => {
        const { posts } = world(ctx.businessId);
        const slot = new Date(MOCK_NOW.getTime() + 30 * 3_600_000).toISOString();
        const out = await queuePostFlow(args, {
          businessId: ctx.businessId,
          now: clock,
          ledger,
          lookupChannel: async (id) => channelById(id),
          createPost: async (input) => {
            const channelId = String(input.channelId);
            const dueAt = typeof input.dueAt === "string" ? input.dueAt : slot;
            const id = uuidFromSeed("buffer-post", ctx.businessId, channelId, String(input.text), dueAt).replace(/-/g, "").slice(0, 24);
            posts.set(id, { id, channelId, service: channelById(channelId)?.service ?? "unknown", dueAt, text: String(input.text) });
            return { __typename: "PostActionSuccess", post: { id, dueAt, status: "scheduled" } };
          },
        });
        return { ...out, simulated: true as const, notice: MOCK_NOTICE };
      },
      get_post: async ({ postId }, ctx) => {
        const post = world(ctx.businessId).posts.get(postId);
        if (!post) throw new AppError("not_found", "Buffer has no post with that id (simulated).", 404);
        const out: GetPostOutputT = { id: post.id, channelId: post.channelId, service: post.service, status: "scheduled", dueAt: post.dueAt, sentAt: null, url: null };
        return { ...out, simulated: true as const, notice: MOCK_NOTICE };
      },
    },
    connectFields: BUFFER_CONNECT_FIELDS,
    connect: async (businessId) => mockIntegrationRecord(BUFFER_KEY, businessId, { accountLabel: "Northwind Skincare (Buffer, mock)", config: { organizationId: ORG_ID } }),
    healthcheck: async (integration) => mockHealth(BUFFER_KEY, { queued: world(integration.businessId).posts.size }),
  });
  /** `queuedFor(businessId)`: that business's recorded (simulated) posts (tests). */
  return Object.assign(connector, { queuedFor: (businessId: string) => [...world(businessId).posts.values()] });
}

export const bufferMock = createBufferMock();
