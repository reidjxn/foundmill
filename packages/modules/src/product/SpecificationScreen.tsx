"use client";
/**
 * Product › Specification (BUILD §11.5): the block outline, one block in the collaborative editor (the host's Tiptap +
 * Yjs editor over apps/collab, or the plain fallback), pinned-block locks, and version history with compare and restore.
 * People who may not change the Product section (viewers, advisors, staff with read access) get a read-only editor and
 * no Pin, Publish or Restore: the API and the collab server refuse those writes anyway.
 */
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Bot, FileText, GitCompare, History, Lock, LockOpen, Pin, RotateCcw, Upload, UserRound } from "lucide-react";
import { Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DiffView, Icon, Panel, StatusPill, Textarea, cn, formatRelative, useFormatters, type StatusTone } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetQuery } from "@foundmill/widgets";
import { useCanWrite, useModuleEnv, type SpecEditorStatus } from "../env";
import type { ModuleScreenProps } from "../registry";
import { FoundationsBanner, useFoundations } from "./foundations";
import { pmToText } from "./prosemirror";
import { AuthorRef, InlineError, PinnedChip, Screen, blockTitle, findBlock, groupBySection, useAction, type SectionGroup } from "./shared";
import { SPEC_EDITOR_STATUS_LABEL, specDocumentName } from "./spec/contract";
import { PlainBlockEditor } from "./spec/PlainBlockEditor";
import type { SpecBlockRow, SpecCompareResponse, SpecGetResponse, SpecVersionRow } from "./types";

/** The whole spec as text, section by section, for version comparison. */
export function snapshotText(version: Pick<SpecVersionRow, "snapshot"> | null | undefined): string {
  const blocks = version?.snapshot?.blocks ?? [];
  return groupBySection(blocks)
    .map((g) => [`## ${g.section}`, ...g.blocks.map((b) => pmToText(b.content))].join("\n\n"))
    .join("\n\n");
}

const STATUS_TONE: Record<SpecEditorStatus, StatusTone> = { connecting: "info", connected: "good", disconnected: "bad", local: "neutral" };

function blockFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("block");
  } catch {
    return null;
  }
}

/* ---------- Outline ---------- */

function Outline({ groups, selectedId, onSelect }: { groups: SectionGroup[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const flat = useMemo(() => groups.flatMap((g) => g.blocks), [groups]);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const idx = flat.findIndex((b) => b.id === selectedId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = flat[Math.min(flat.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        onSelect(next.id);
        (e.currentTarget.querySelector(`[data-outline-block="${next.id}"]`) as HTMLElement | null)?.focus();
      }
    } else if (e.key === "Home" && flat[0]) onSelect(flat[0].id);
    else if (e.key === "End" && flat.length) onSelect(flat[flat.length - 1]!.id);
  };
  return (
    <nav aria-label="Spec outline" className="flex flex-col" onKeyDown={onKeyDown}>
      {groups.map((g) => (
        <section key={g.section} aria-label={g.section}>
          <h3 className="t-label sticky top-0 bg-panel px-panel-pad py-1.5">{g.section}</h3>
          <ul>
            {g.blocks.map((b) => {
              const active = b.id === selectedId;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    data-outline-block={b.id}
                    aria-current={active ? "true" : undefined}
                    tabIndex={active || (!selectedId && b === flat[0]) ? 0 : -1}
                    onClick={() => onSelect(b.id)}
                    title={blockTitle(b)}
                    className={cn(
                      "flex min-h-row-comfortable w-full items-start gap-2 px-panel-pad py-1.5 text-left text-body outline-none transition-colors duration-micro ease-dugout hover:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link",
                      active ? "row-selected text-primary" : "text-primary",
                    )}
                  >
                    <Icon icon={b.authoredByKind === "agent" ? Bot : UserRound} size="inline" className="mt-0.5 shrink-0 text-secondary" label={b.authoredByKind === "agent" ? "Agent-written" : "Human-written"} />
                    {/* Two lines of the block's first sentence, never a one-line stub. */}
                    <span className="line-clamp-2 min-w-0 flex-1 break-words">{blockTitle(b)}</span>
                    {b.pinned ? <Icon icon={Lock} size="inline" className="mt-0.5 shrink-0 text-status-info" label="Pinned" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/* ---------- Editor panel ---------- */

function EditorPanel({ businessId, block, canWrite, onChanged }: { businessId: string; block: SpecBlockRow | undefined; canWrite: boolean; onChanged: () => void }) {
  const env = useModuleEnv();
  const Editor = env.SpecEditor ?? PlainBlockEditor;
  const [status, setStatus] = useState<SpecEditorStatus>(env.SpecEditor ? "connecting" : "local");
  const action = useAction();
  const onStatusChange = useCallback((s: SpecEditorStatus) => setStatus(s), []);

  const togglePin = async () => {
    if (!block) return;
    await action.run("product.spec.editBlock", { blockId: block.id, patch: { pinned: !block.pinned } }, { key: "pin", then: onChanged });
  };

  return (
    <Panel
      title={block ? block.section : "Block"}
      span={6}
      empty={!block ? { icon: FileText, children: "Pick a block in the outline to read or edit it." } : undefined}
      actions={
        block ? (
          <>
            {block.pinned ? <PinnedChip /> : null}
            {canWrite ? (
              <Button size="sm" variant="ghost" icon={block.pinned ? LockOpen : Pin} onClick={() => void togglePin()} loading={action.pending === "pin"} aria-pressed={block.pinned}>
                {block.pinned ? "Unpin" : "Pin"}
              </Button>
            ) : null}
          </>
        ) : null
      }
      footer={
        block ? (
          <>
            {/* The host editor shows its own live status; the fallback editor has none, so the footer carries it. */}
            {env.SpecEditor ? null : (
              <StatusPill tone={STATUS_TONE[status]} pulse={status === "connecting"}>
                {SPEC_EDITOR_STATUS_LABEL[status]}
              </StatusPill>
            )}
            <span className="flex-1" />
            <AuthorRef kind={block.authoredByKind} id={block.authoredBy} />
            <span className="tabular-nums">· version {block.version}</span>
            {block.updatedAt ? <span className="tabular-nums">· {formatRelative(block.updatedAt)}</span> : null}
            <InlineError error={action.error} />
          </>
        ) : undefined
      }
      bodyClassName="flex min-h-96 flex-col"
    >
      {block ? (
        <>
          {block.pinned ? (
            <p className="mb-2 flex items-center gap-1.5 text-small text-secondary">
              <Icon icon={Lock} size="inline" className="text-status-info" />
              Pinned: agents cannot change this block without an accepted change proposal.{canWrite ? " Your edits keep it pinned." : ""}
            </p>
          ) : null}
          <Editor
            key={block.id}
            businessId={businessId}
            blockId={block.id}
            documentName={specDocumentName(businessId, block.id)}
            collabUrl={env.collabUrl}
            collabToken={env.collabToken}
            initialContent={block.content}
            pinned={block.pinned}
            readOnly={!canWrite}
            onSaved={onChanged}
            onStatusChange={onStatusChange}
          />
        </>
      ) : null}
    </Panel>
  );
}

/* ---------- History panel ---------- */

function HistoryPanel({ versions, canWrite, onRestored, onPublished }: { versions: ReturnType<typeof useWidgetQuery<SpecVersionRow[]>>; canWrite: boolean; onRestored: () => void; onPublished: () => void }) {
  const { formatDate, formatDateSmart, formatDateTime } = useFormatters();
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<SpecVersionRow | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changelog, setChangelog] = useState("");
  const action = useAction();
  const list = versions.data ?? [];

  const pick = (v: number) => {
    if (from === null || (from !== null && to !== null)) {
      setFrom(v);
      setTo(null);
    } else if (v !== from) {
      setTo(Math.max(from, v));
      setFrom(Math.min(from, v));
    }
  };
  const compare = useWidgetQuery<SpecCompareResponse>("product.spec.compare", from !== null && to !== null ? { from, to } : undefined, { enabled: compareOpen && from !== null && to !== null });

  const restore = async () => {
    if (!restoreTarget) return;
    await action.run("product.spec.restore", { version: restoreTarget.version }, {
      key: "restore",
      then: () => {
        setRestoreTarget(null);
        onRestored();
      },
    });
  };
  const publish = async () => {
    await action.run("product.spec.publish", { changelogMd: changelog }, {
      key: "publish",
      then: () => {
        setPublishOpen(false);
        setChangelog("");
        onPublished();
      },
    });
  };

  return (
    <Panel
      title="Version history"
      span={3}
      loading={versions.isLoading}
      error={versions.error ? versions.error.message : undefined}
      onRetry={versions.refetch}
      empty={
        versions.data && list.length === 0
          ? canWrite
            ? { icon: History, children: "Versions appear when a change proposal is accepted or you publish the current spec.", action: { label: "Publish version", icon: Upload, onClick: () => setPublishOpen(true) } }
            : { icon: History, children: "Versions appear when a change proposal is accepted or the spec is published." }
          : undefined
      }
      actions={
        <>
          <Button size="sm" variant="ghost" icon={GitCompare} disabled={from === null || to === null} onClick={() => setCompareOpen(true)}>
            Compare
          </Button>
          {canWrite ? (
            <Button size="sm" variant="ghost" icon={Upload} onClick={() => setPublishOpen(true)}>
              Publish
            </Button>
          ) : null}
        </>
      }
      footer={<span>{from !== null && to !== null ? `Comparing v${from} → v${to}` : from !== null ? `v${from} selected · pick another to compare` : "Pick two versions to compare"}</span>}
      flush
    >
      <ol className="flex flex-col divide-y divide-subtle/50" aria-label="Spec versions">
        {list.map((v, i) => {
          const selected = v.version === from || v.version === to;
          return (
            <li key={v.id} className={cn("flex items-start gap-2 px-panel-pad py-2", selected && "bg-panel-alt")} data-version={v.version}>
              <button type="button" onClick={() => pick(v.version)} aria-pressed={selected} aria-label={`Select version ${v.version} for comparison`} className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border outline-none focus-visible:outline-2 focus-visible:outline-link", selected ? "border-kit-primary bg-kit-primary" : "border-secondary")}>
                {selected ? <span className="size-1.5 rounded-full bg-kit-on-primary" /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-body-strong text-primary tabular-nums">v{v.version}</span>
                  {i === 0 ? <Chip tone="good">Latest</Chip> : null}
                  <span className="flex-1" />
                  <time dateTime={new Date(v.publishedAt).toISOString()} title={formatDateTime(v.publishedAt)} className="text-small text-secondary tabular-nums">
                    {formatDateSmart(v.publishedAt)}
                  </time>
                </div>
                <p className="line-clamp-2 break-words text-small text-secondary" title={v.changelogMd}>
                  {v.changelogMd || "No changelog"}
                </p>
                <div className="mt-1 flex items-center gap-2 text-small text-secondary">
                  <span className="tabular-nums">{v.snapshot?.blocks?.length ?? 0} blocks</span>
                  {v.publishedBy ? <AuthorRef kind="user" id={v.publishedBy} /> : <span>System</span>}
                  <span className="flex-1" />
                  {i !== 0 && canWrite ? (
                    <Button size="sm" variant="ghost" icon={RotateCcw} className="h-6 px-1.5" onClick={() => setRestoreTarget(v)}>
                      Restore
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent size="xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              Compare v{from} → v{to}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {compare.isLoading ? <p className="text-body text-secondary">Loading versions…</p> : null}
            {compare.error ? <InlineError error={compare.error} /> : null}
            {compare.data ? (
              <DiffView readOnly title={`${compare.data.from.changelogMd || `v${compare.data.from.version}`} → ${compare.data.to.changelogMd || `v${compare.data.to.version}`}`} original={snapshotText(compare.data.from)} proposed={snapshotText(compare.data.to)} labels={{ original: `v${compare.data.from.version}`, proposed: `v${compare.data.to.version}` }} defaultMode="side-by-side" maxHeight={520} />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompareOpen(false)}>
              Close
            </Button>
            {compare.data && from !== null && canWrite ? (
              <Button
                variant="default"
                icon={RotateCcw}
                onClick={() => {
                  setCompareOpen(false);
                  setRestoreTarget(compare.data!.from);
                }}
              >
                Restore v{from}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoreTarget !== null} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Restore version {restoreTarget?.version}?</DialogTitle>
            <DialogDescription>Every block returns to the state published {restoreTarget ? formatDate(restoreTarget.publishedAt) : ""}. Blocks added since are archived, not deleted; the current state stays comparable in history.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <InlineError error={action.error} />
            <Button variant="ghost" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" icon={RotateCcw} onClick={() => void restore()} loading={action.pending === "restore"}>
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Publish a spec version</DialogTitle>
            <DialogDescription>Snapshots every block as the next immutable version. Development is told to re-plan when it matters.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label htmlFor="spec-changelog" className="t-label mb-1 block">
              Changelog
            </label>
            <Textarea id="spec-changelog" rows={4} value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="What changed and why" maxLength={4000} />
          </DialogBody>
          <DialogFooter>
            <InlineError error={action.error} />
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={Upload} onClick={() => void publish()} loading={action.pending === "publish"}>
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* ---------- Screen ---------- */

export function SpecificationScreen({ businessId }: ModuleScreenProps) {
  const spec = useWidgetQuery<SpecGetResponse>("product.spec.get", {});
  const versions = useWidgetQuery<SpecVersionRow[]>("product.spec.versions", undefined);
  const [selectedId, setSelectedId] = useState<string | null>(() => blockFromLocation());
  const groups = useMemo(() => groupBySection(spec.data?.blocks ?? []), [spec.data]);
  const refetchAll = useCallback(() => {
    spec.refetch();
    versions.refetch();
  }, [spec, versions]);
  useBusinessEvents(refetchAll, ["spec.version_published"]);
  // The first specification is drafted on the first open; show the drafting and reload the blocks when it is ready.
  const foundations = useFoundations(refetchAll);

  useEffect(() => {
    if (!spec.data?.blocks.length) return;
    if (!selectedId || !findBlock(spec.data.blocks, selectedId)) setSelectedId(groups[0]?.blocks[0]?.id ?? null);
  }, [spec.data, groups, selectedId]);

  const block = findBlock(spec.data?.blocks, selectedId);
  const canWrite = useCanWrite("product");

  return (
    <Screen name="product/specification">
      <FoundationsBanner foundations={foundations} detail={{ sectionText: true }} />
      <Panel
        title="Outline"
        span={3}
        loading={spec.isLoading}
        error={spec.error ? spec.error.message : undefined}
        onRetry={spec.refetch}
        empty={spec.data && spec.data.blocks.length === 0 ? { icon: FileText, title: "No spec yet", children: "The outline is seeded from the archetype when the business is created; the Product lead fills it in the first cycle." } : undefined}
        footer={spec.data ? <span className="tabular-nums">{spec.data.blocks.length} blocks in {groups.length} sections · ↑↓ to move</span> : undefined}
        flush
      >
        <Outline groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
      </Panel>
      <EditorPanel businessId={businessId} block={block} canWrite={canWrite} onChanged={refetchAll} />
      <HistoryPanel versions={versions} canWrite={canWrite} onRestored={refetchAll} onPublished={refetchAll} />
    </Screen>
  );
}
