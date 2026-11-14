/**
 * Images on a message (item 13, the design check): only a route marked `vision` in routing.ts may send them, a message
 * carries at most `MAX_IMAGES_PER_REQUEST` across the request, and each must be a supported type within the API's size.
 * Both clients call `assertImagesAllowed` before anything goes out, so a mistake fails in mock mode as it would live.
 */
import { routeAcceptsImages, type RouteKey } from "./routing";
import { CHAT_IMAGE_MEDIA_TYPES, type ChatMessage } from "./types";

/** Images one request may carry (the API takes more; the design check sends at most 8 screenshots). */
export const MAX_IMAGES_PER_REQUEST = 20;
/** Largest base64 payload of one image (the API's limit is 5 MB of image data). */
export const MAX_IMAGE_BASE64_CHARS = Math.floor((5 * 1024 * 1024 * 4) / 3);
/** Rough input tokens of one screenshot, for the rate limiter's reservation (≈ width × height / 750, capped by the API). */
export const IMAGE_TOKEN_ESTIMATE = 1_600;

export class ImageNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageNotAllowedError";
  }
}

export function countImages(messages: readonly ChatMessage[]): number {
  return messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
}

export function assertImagesAllowed(route: RouteKey, messages: readonly ChatMessage[]): void {
  const count = countImages(messages);
  if (count === 0) return;
  if (!routeAcceptsImages(route)) throw new ImageNotAllowedError(`Route "${route}" does not accept images; only vision routes in routing.ts do.`);
  if (count > MAX_IMAGES_PER_REQUEST) throw new ImageNotAllowedError(`A request carries at most ${MAX_IMAGES_PER_REQUEST} images (got ${count}).`);
  for (const m of messages) {
    if (m.images?.length && m.role !== "user") throw new ImageNotAllowedError("Only user messages carry images.");
    for (const img of m.images ?? []) {
      if (!(CHAT_IMAGE_MEDIA_TYPES as readonly string[]).includes(img.mediaType)) throw new ImageNotAllowedError(`Unsupported image type ${img.mediaType}.`);
      if (!img.data || img.data.length > MAX_IMAGE_BASE64_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(img.data.slice(0, 4096))) throw new ImageNotAllowedError("An image is empty, too large or not base64.");
    }
  }
}

/** The messages with each image's data replaced by a fixed marker: for hashing, logs and token estimates. */
export function withoutImageData(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.images?.length ? { ...m, images: m.images.map((img) => ({ mediaType: img.mediaType, data: `<image ${img.data.length} chars>` })) } : m));
}
