"use client";
/**
 * The share panel (docs/DESIGN.md §9e; docs/NETWORK.md F3 "Tap-to-post"): a drafted post, and one control per network
 * that opens that network's own share window with the text and the link already in it. The founder presses Post
 * there; nothing is posted from here, and nothing here says anything was.
 *
 * - The text can be changed before sharing. Nothing is saved: the change lives in the panel, and every address is
 *   built again from it, fitted to each network (`shareTargets`), with the count per network as words.
 * - The networks are grouped by what a press really does: "Opens ready to post", "Opens with your link" (the text is
 *   not carried), "Copy and post in the app", and apart from them "Send to someone".
 * - Every control that opens a window is a real link (`<a target="_blank" rel="noopener noreferrer">`) in the button
 *   look, so it works without JavaScript and no pop-up blocker can eat it.
 * - A network is named by its word with a generic Lucide icon: no logos and no brand colors. Color is never the only
 *   signal: each group has its heading and its sentence.
 * - Where the browser offers the device's own share sheet, "Share…" comes first, and is never the only way.
 * - `onShare` is told which control was pressed (never the words). It is called and not waited on.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Copy, Download, ExternalLink, Link2, MessageCircle, Share2 } from "lucide-react";
import { POST_TEXT_MAX, withPostText, type PostDraft } from "@foundmill/shared/post-draft";
import {
  SHARE_KIND_WORDS,
  SHARE_MESSAGE_WORDS,
  SHARE_PANEL_WORDS,
  messageTargets,
  shareCountWords,
  shareTargets,
  type ShareOpened,
  type ShareTarget,
  type ShareTargetKind,
} from "@foundmill/shared/share-targets";
import { Button } from "../foundation/Button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Field } from "../foundation/Label";
import { Textarea } from "../foundation/Textarea";

export interface SharePostProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The panel's heading: "Share your page", "Share “Page live”". */
  title: string;
  description?: string;
  /** The draft as it was made. The founder's change to the text stays in the panel. */
  draft: PostDraft;
  /** The product's name (APP_NAME), for the one honest line at the foot. */
  appName: string;
  /** A share control was pressed: which one, never the words. Called and not waited on. */
  onShare?: (opened: ShareOpened) => void;
}

/** What "Copy" could not do, said plainly. */
const COPY_FAILED = "That could not be copied. Select it and copy it yourself.";

const GROUP_ORDER: readonly ShareTargetKind[] = ["tap", "link_only", "copy"];

function Group({ id, title, note, children, kind }: { id: string; title: string; note?: string; children: ReactNode; kind: string }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 border-t border-line-faint pt-3" data-share-group={kind}>
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="t-label text-secondary">
          {title}
        </h3>
        {note ? <p className="text-small text-secondary">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** "212 of 280", and that the text was cut when it was: words, never a color alone. */
function Count({ target }: { target: ShareTarget }) {
  return (
    <span className="text-small tabular-nums text-secondary" data-share-count={target.network}>
      {shareCountWords(target.used, target.max)}
      {target.shortened ? `, ${SHARE_PANEL_WORDS.shortened}` : ""}
    </span>
  );
}

export function SharePost({ open, onOpenChange, title, description, draft, appName, onShare }: SharePostProps) {
  const id = useId();
  const [text, setText] = useState(draft.text);
  const [said, setSaid] = useState<string | null>(null);
  // A new draft, or the panel opened again: the founder starts from the draft's own words.
  useEffect(() => {
    if (open) {
      setText(draft.text);
      setSaid(null);
    }
  }, [open, draft.text, draft.link]);
  // The device's own share sheet, where the browser has one. Known only in the browser, after the first paint.
  const [device, setDevice] = useState(false);
  useEffect(() => {
    setDevice(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const current = useMemo(() => withPostText(draft, text), [draft, text]);
  const targets = useMemo(() => shareTargets(current), [current]);
  const messages = useMemo(() => messageTargets(current), [current]);
  const byKind = (kind: ShareTargetKind) => targets.filter((t) => t.kind === kind);
  const link = current.link;

  const tell = (opened: ShareOpened) => {
    try {
      onShare?.(opened);
    } catch {
      // Recording a share never gets in the way of the share.
    }
  };
  const copy = async (value: string, done: string, opened: ShareOpened) => {
    tell(opened);
    try {
      await navigator.clipboard.writeText(value);
      setSaid(done);
    } catch {
      setSaid(COPY_FAILED);
    }
  };
  const shareOnDevice = () => {
    tell({ network: null, target: "device" });
    // The person may close the sheet without choosing anything: that is not an error.
    void navigator.share({ text: current.text.trim(), ...(link ? { url: link } : {}) }).catch(() => undefined);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="share-post">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-text`} label={SHARE_PANEL_WORDS.text} hint={SHARE_PANEL_WORDS.textHint}>
            <Textarea id={`${id}-text`} rows={3} maxLength={POST_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)} data-share-text="" />
          </Field>
          {link ? (
            <div className="flex flex-col gap-1">
              <span className="t-label text-secondary">{SHARE_PANEL_WORDS.link}</span>
              <span className="t-mono min-w-0 break-all text-primary" data-share-link="">
                {link}
              </span>
            </div>
          ) : null}
          {device ? (
            <div>
              <Button variant="tinted" icon={Share2} onClick={shareOnDevice} data-share-device="">
                {SHARE_PANEL_WORDS.device}
              </Button>
            </div>
          ) : null}

          {GROUP_ORDER.map((kind) => {
            const group = byKind(kind);
            if (group.length === 0) return null;
            const words = SHARE_KIND_WORDS[kind];
            return (
              <Group key={kind} id={`${id}-${kind}`} kind={kind} title={words.title} note={words.note}>
                <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                  {group.map((t) => (
                    <li key={t.network} className="flex flex-wrap items-center gap-x-2 gap-y-1" data-share-network={t.network} data-share-kind={t.kind}>
                      {t.href ? (
                        <Button size="sm" variant={kind === "tap" ? "tinted" : "default"} icon={ExternalLink} asChild>
                          <a href={t.href} target="_blank" rel="noopener noreferrer" aria-label={`${t.label}: ${words.title.toLowerCase()}, in a new tab`} onClick={() => tell({ network: t.network, target: kind === "tap" ? "tap" : "link_only" })} data-share-open={t.network}>
                            {t.label}
                          </a>
                        </Button>
                      ) : (
                        <>
                          <span className="text-body-strong text-primary">{t.label}</span>
                          <Button size="sm" icon={Copy} onClick={() => void copy(t.copyText, SHARE_PANEL_WORDS.textCopied, { network: t.network, target: "copy" })} aria-label={`${SHARE_PANEL_WORDS.copyText} for ${t.label}`} data-share-copy={t.network}>
                            {SHARE_PANEL_WORDS.copyText}
                          </Button>
                          {t.image ? (
                            <Button size="sm" variant="ghost" icon={Download} asChild>
                              <a href={t.image.url} download target="_blank" rel="noopener noreferrer" aria-label={`${SHARE_PANEL_WORDS.downloadImage} for ${t.label}`} data-share-image={t.network}>
                                {SHARE_PANEL_WORDS.downloadImage}
                              </a>
                            </Button>
                          ) : null}
                        </>
                      )}
                      {kind === "link_only" ? null : <Count target={t} />}
                      {t.note ? <span className="text-small text-secondary">{t.note}</span> : null}
                    </li>
                  ))}
                </ul>
                {/* The words are not carried into these windows, so they are one press away to paste there. */}
                {kind === "link_only" ? (
                  <div>
                    <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy(current.text.trim(), SHARE_PANEL_WORDS.textCopied, { network: null, target: "copy" })} data-share-copy-text="">
                      {SHARE_PANEL_WORDS.copyText}
                    </Button>
                  </div>
                ) : null}
              </Group>
            );
          })}

          <Group id={`${id}-message`} kind="message" title={SHARE_MESSAGE_WORDS.title}>
            <div className="flex flex-wrap items-center gap-2">
              {messages.map((m) => (
                <Button key={m.app} size="sm" icon={MessageCircle} asChild>
                  <a href={m.href} target="_blank" rel="noopener noreferrer" aria-label={`${m.label}: send it to someone, in a new tab`} onClick={() => tell({ network: m.app, target: "message" })} data-share-message={m.app}>
                    {m.label}
                  </a>
                </Button>
              ))}
              {link ? (
                <Button size="sm" icon={Link2} onClick={() => void copy(link, SHARE_MESSAGE_WORDS.copied, { network: null, target: "copy" })} data-share-copy-link="">
                  {SHARE_MESSAGE_WORDS.copyLink}
                </Button>
              ) : null}
            </div>
          </Group>
        </DialogBody>
        <DialogFooter className="justify-between">
          <span className="min-w-0 flex-1 text-small text-secondary">
            <span data-share-honest="">{SHARE_PANEL_WORDS.honest(appName)}</span>{" "}
            <span role="status" aria-live="polite" className="text-primary" data-share-said="">
              {said}
            </span>
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {SHARE_PANEL_WORDS.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
