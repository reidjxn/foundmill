import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, uuidFromSeed } from "../../mock-utils";
import { assertImageUrl, estimateClipCostMinor, mapStart, RUNWAY_KEY, RUNWAY_RATE_LIMITS, runwayTools } from "./tools";

export const MOCK_NOTICE = "Simulated: no video was made. The address below is a placeholder that opens nothing, and nothing was spent at Runway.";

/** A placeholder address on a name that can never resolve (`.invalid`), so a simulated clip cannot be published by mistake. */
export const mockClipUrl = (taskId: string): string => `https://simulated.runway.invalid/${taskId}.mp4`;

/**
 * Deterministic and offline. The same request makes the same task id; looking any task up answers SUCCEEDED with a
 * placeholder address, marked simulated. The address guard of the live connector applies here too.
 */
export const runwayMock = buildMockConnector({
  key: RUNWAY_KEY,
  displayName: "Runway",
  phase: 3,
  auth: { kind: "api_key" },
  tools: runwayTools,
  rateLimits: RUNWAY_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    generate_video_from_text: async ({ prompt, ratio, durationSeconds, model }) => {
      const taskId = uuidFromSeed("runway", "text", prompt, ratio, durationSeconds, model);
      return { ...mapStart({ id: taskId, estimatedCost: { credits: estimateClipCostMinor(model, durationSeconds) } }, { model, ratio, durationSeconds })!, simulated: true as const, notice: MOCK_NOTICE };
    },
    generate_video_from_image: async ({ promptImageUrl, prompt, ratio, durationSeconds, model }) => {
      assertImageUrl(promptImageUrl);
      const taskId = uuidFromSeed("runway", "image", promptImageUrl, prompt, ratio, durationSeconds, model);
      return { ...mapStart({ id: taskId, estimatedCost: { credits: estimateClipCostMinor(model, durationSeconds) } }, { model, ratio, durationSeconds })!, simulated: true as const, notice: MOCK_NOTICE };
    },
    get_video_task: async ({ taskId }) => ({
      taskId: taskId.toLowerCase(),
      status: "SUCCEEDED",
      progress: 1,
      outputUrls: [mockClipUrl(taskId.toLowerCase())],
      urlsExpireAt: new Date(MOCK_NOW.getTime() + 24 * 3_600_000).toISOString(),
      creditsUsed: 0,
      failureCode: null,
      failure: null,
      simulated: true as const,
      notice: MOCK_NOTICE,
    }),
    // Nothing was made, so there is nothing to copy: no bytes, and never "ready".
    download_video: async ({ taskId }) => ({ taskId: taskId.toLowerCase(), status: "SUCCEEDED", ready: false, mime: null, base64: null, bytes: 0, simulated: true as const, notice: MOCK_NOTICE }),
  },
  connect: async (businessId) => mockIntegrationRecord(RUNWAY_KEY, businessId, { accountLabel: "Runway (mock)" }),
  healthcheck: async () => mockHealth(RUNWAY_KEY),
});
