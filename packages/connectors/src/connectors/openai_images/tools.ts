/**
 * OpenAI Images for the AI-generated faces of anthropomorphic agents (docs/DECISIONS.md, Anthropomorphic agents). Platform key
 * only (`OPENAI_API_KEY` on the gateway): a portrait is a platform asset made once per persona catalog key, so no business
 * connects or pays for it. API shape checked against OpenAI's image generation guide on 2026-10-22.
 */
import { z } from "zod";
import { defineTool } from "../../define";

export const OPENAI_IMAGES_KEY = "openai_images";
export const OPENAI_IMAGES_BASE_URL = "https://api.openai.com/v1";

export const PROMPT_MAX_CHARS = 2000;
export const IMAGE_SIZES = ["1024x1024"] as const;
export const IMAGE_QUALITIES = ["low", "medium", "high"] as const;
/** `output_format: "webp"` is what the real connector asks for; the mock draws a PNG because it has no encoder. */
export const IMAGE_MIMES = ["image/webp", "image/png"] as const;
/** WebP compression (0-100): a face at 1024 px stays sharp at 80 and is a fraction of the PNG's size. */
export const OUTPUT_COMPRESSION = 80;

export const GenerateImageInput = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX_CHARS),
  size: z.enum(IMAGE_SIZES).default("1024x1024"),
  quality: z.enum(IMAGE_QUALITIES).default("medium"),
});
export type GenerateImageInput = z.output<typeof GenerateImageInput>;

export const GenerateImageOutput = z.object({ mime: z.enum(IMAGE_MIMES), base64: z.string().min(1), model: z.string().min(1) });
export type GenerateImageOutput = z.output<typeof GenerateImageOutput>;

/**
 * Estimate in USD cents per 1024 px image. OpenAI bills these models by image tokens and publishes no per-image price,
 * so the figures are rough planning numbers, not an invoice ("Estimate").
 */
const COST_MINOR: Record<(typeof IMAGE_QUALITIES)[number], number> = { low: 1, medium: 4, high: 17 };
export const estimateImageCostMinor = (quality: GenerateImageInput["quality"]): number => COST_MINOR[quality];

export const openaiImagesTools = [
  defineTool({
    name: "generate_image",
    description: "Generate one square image from a text prompt (an AI-generated portrait). Returns the image as base64 with its mime type and the model that made it. Cost is an estimate.",
    input: GenerateImageInput,
    output: GenerateImageOutput,
    // Metered platform spend, never the business's money: it is "spendsMoney" for the policy engine like embeddings and sandbox
    // compute are. Nothing leaves the platform except the prompt, to the image vendor.
    hints: { spendsMoney: true, contactsThirdParty: false, requiresKitMode: false, irreversible: false },
    annotations: { readOnlyHint: false, idempotentHint: false },
    costMinor: (args) => estimateImageCostMinor(args.quality),
  }),
] as const;

export const OPENAI_IMAGES_RATE_LIMITS = { perMinute: 20, perDay: 400 };
