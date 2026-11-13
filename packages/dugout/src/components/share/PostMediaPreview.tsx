"use client";
/**
 * A post draft's media in the share panel (docs/DESIGN.md §9g; packages/shared `post-media.ts`): the short video and the
 * voiceover the team made on the founder's own accounts, or one honest line about why there is none.
 *
 * - A ready, real item shows its preview (the browser's own player, with its controls) and "Save" as a real link with
 *   `download`, so it works without JavaScript. Nothing here plays by itself.
 * - A simulated item shows no preview and no "Save": nothing was made, and the line says so ("Simulated: no video was
 *   made…"). The same for an item that waits for the founder's OK, is being made, was declined or failed: words only.
 * - Not connected: the draft is text only, and the line says the video tools are not connected and where to connect them.
 * - The video and the voiceover are two files; when both are ready, a line says how to use them together.
 *
 * Fits a phone: the preview is never wider than the panel, and every control wraps.
 */
import { Download } from "lucide-react";
import { POST_MEDIA_WORDS, postMediaLine, postMediaPostable, type PostDraftMedia, type PostDraftMediaItem } from "@foundmill/shared/post-media";
import { Button } from "../foundation/Button";

export interface PostMediaPreviewProps {
  media: PostDraftMedia;
  /** "Save" was pressed for one item: which one, never the file. Called and not waited on. */
  onSave?: (kind: PostDraftMediaItem["kind"]) => void;
}

function Item({ item, onSave }: { item: PostDraftMediaItem; onSave?: PostMediaPreviewProps["onSave"] }) {
  const line = postMediaLine(item);
  if (!postMediaPostable(item)) {
    return (
      <p className="text-small text-secondary" data-share-media={item.kind} data-media-state={item.simulated ? "simulated" : item.state}>
        {line}
      </p>
    );
  }
  const save = item.kind === "video" ? POST_MEDIA_WORDS.saveVideo : POST_MEDIA_WORDS.saveVoiceover;
  return (
    <figure className="flex min-w-0 flex-col gap-1.5" data-share-media={item.kind} data-media-state="ready">
      {item.kind === "video" ? (
        <video src={item.url} controls playsInline preload="metadata" aria-label={POST_MEDIA_WORDS.previewLabel.video} className="aspect-[9/16] max-h-80 w-auto max-w-full self-start rounded-md border border-line bg-surface-2" data-media-preview="video" />
      ) : (
        <audio src={item.url} controls preload="metadata" aria-label={POST_MEDIA_WORDS.previewLabel.voiceover} className="w-full max-w-sm" data-media-preview="voiceover" />
      )}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-small text-primary">{line}</span>
        <Button size="sm" variant="ghost" icon={Download} asChild>
          <a href={item.url} download={item.fileName ?? true} onClick={() => onSave?.(item.kind)} data-media-save={item.kind}>
            {save}
          </a>
        </Button>
      </figcaption>
    </figure>
  );
}

export function PostMediaPreview({ media, onSave }: PostMediaPreviewProps) {
  const { video, voiceover } = media;
  const realVideo = postMediaPostable(video);
  return (
    <section aria-label={POST_MEDIA_WORDS.heading} className="flex flex-col gap-2 border-t border-line-faint pt-3" data-share-media-panel="">
      <h3 className="t-label text-secondary">{POST_MEDIA_WORDS.heading}</h3>
      {!video && media.videoTools === "not_connected" ? (
        <p className="text-small text-secondary" data-share-media="not-connected">
          {POST_MEDIA_WORDS.notConnected}
        </p>
      ) : null}
      {video ? <Item item={video} onSave={onSave} /> : null}
      {voiceover ? <Item item={voiceover} onSave={onSave} /> : null}
      {realVideo && !voiceover && media.voiceTools === "not_connected" ? <p className="text-small text-secondary">{POST_MEDIA_WORDS.voiceNotConnected}</p> : null}
      {realVideo && postMediaPostable(voiceover) ? <p className="text-small text-secondary" data-share-media-note="two-files">{POST_MEDIA_WORDS.twoFiles}</p> : null}
      {realVideo ? <p className="text-small text-secondary" data-share-media-note="save">{POST_MEDIA_WORDS.saveNote}</p> : null}
    </section>
  );
}
