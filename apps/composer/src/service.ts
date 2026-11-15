/**
 * The Composer service facade (docs/ARCHITECTURE.md §11): narrate, refresh, commentary, chapter titles and the named
 * query registry, over one database and one models client. `createApp` wraps it in HTTP; tests call it directly.
 */
import { LIMITS } from "@foundmill/config";
import { repos, type Db, type InboxItem } from "@foundmill/db";
import { stableHash, type ModelClient, type ModelLogger } from "@foundmill/models";
import { NotFoundError, ValidationError } from "@foundmill/shared";
import { composeChapterTitle, parseQuarter, quarterOf, type ChapterTitleResult } from "./chapter";
import { composeCommentary, type CommentaryResult } from "./commentary";
import { composeNote } from "./compose";
import { loadContext } from "./context";
import { composeFounderTitles, type FounderTitlesResult } from "./founder-titles";
import { namedQueryCatalogue, runNamedQuery, type ExhibitData } from "./exhibits";
import { findPersisted, persistDrafts, persistNote, type Persisted } from "./persist";
import { RefreshEngine, type RefreshEngineOptions, type RefreshResult } from "./refresh";

export interface ComposerServiceDeps {
  db: Db;
  models: ModelClient;
  log: ModelLogger;
}

export type ComposerServiceOptions = RefreshEngineOptions;

export interface NarrateResult {
  item: InboxItem;
  eventIds: string[];
  /** The model was asked once more because its first output mentioned ids outside the manifest. */
  reasked: boolean;
  /** Entity ids linked in the note (markup and sweep). */
  entityIds: string[];
  /** Unverified CRM entities drafted from unknown proper nouns. */
  draftEntityIds: string[];
  costMinor: number;
  /** The model that wrote the note; null when the note was already written (`replayed`). */
  model: string | null;
  durationMs: number;
  /** True when these events were already narrated by an earlier call: its note is returned and nothing is written or billed. */
  replayed: boolean;
}

/** The idempotency key of narrating one set of events (order and repeats do not matter). */
export function narrationKey(eventIds: readonly string[]): string {
  return `narrate:${stableHash([...new Set(eventIds)].sort())}`;
}

export class ComposerService {
  readonly refreshEngine: RefreshEngine;
  private readonly draftsOn: boolean;
  private readonly deadlineMs: number;
  private readonly now: () => Date;
  /** Narrations being written, by business and event set: a retry of a slow call waits for it instead of writing again. */
  private readonly narrating = new Map<string, Promise<NarrateResult>>();

  constructor(
    private readonly deps: ComposerServiceDeps,
    options: ComposerServiceOptions = {},
  ) {
    this.refreshEngine = new RefreshEngine(deps, options);
    this.draftsOn = options.persistDrafts ?? true;
    this.deadlineMs = options.composeDeadlineMs ?? LIMITS.composerDeadlineMs;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * `POST /v1/narrate`: one item narrating exactly these events, or `ComposerRejectedError` (422) after the single
   * re-ask. Idempotent per event set (audit CML-05): the orchestrator retries a narration whose answer it did not get
   * (a timeout, a restart), so a call for events already narrated together returns that note, and a call while the
   * same narration is still being written waits for it. Neither writes a second note or pays for a second one.
   */
  narrate(businessId: string, eventIds: readonly string[]): Promise<NarrateResult> {
    const ids = [...new Set(eventIds)];
    if (ids.length === 0) return Promise.reject(new ValidationError("eventIds must name at least one event"));
    const key = narrationKey(ids);
    const flight = `${businessId}:${key}`;
    const running = this.narrating.get(flight);
    if (running) return running.then((r) => ({ ...r, replayed: true, costMinor: 0 }));
    const p = this.narrateOnce(businessId, ids, key).finally(() => this.narrating.delete(flight));
    this.narrating.set(flight, p);
    return p;
  }

  private async narrateOnce(businessId: string, ids: string[], key: string): Promise<NarrateResult> {
    const started = Date.now();
    const done = await findPersisted(this.deps.db, businessId, key);
    if (done) return replay(done, started);
    const events = await repos.events.byIds(this.deps.db, businessId, ids);
    if (events.length !== ids.length) {
      const found = new Set(events.map((e) => e.id));
      throw new NotFoundError("event", ids.filter((id) => !found.has(id)).join(", "));
    }
    const ctx = await loadContext(this.deps.db, businessId, { now: this.now(), entityIds: events.flatMap((e) => e.entityIds), skipUnnarrated: true });
    const composed = await composeNote(this.deps, ctx, { mode: "events", events }, { onInvalidLinks: "reject", deadlineMs: this.deadlineMs });
    const persisted = await persistNote(this.deps.db, this.deps.log, {
      businessId,
      item: composed.item,
      eventIds: composed.eventIds,
      events,
      now: this.now(),
      costMinorInt: composed.costMinorInt,
      costCurrency: composed.costCurrency,
      slot: "narrate",
      idempotencyKey: key,
    });
    if (persisted.replayed) return replay(persisted, started);
    const draftEntityIds = this.draftsOn && composed.drafts.length ? await persistDrafts(this.deps.db, this.deps.log, businessId, composed.drafts, persisted.item.id, persisted.item.bodyMd) : [];
    return {
      item: persisted.item,
      eventIds: composed.eventIds,
      reasked: composed.reasked,
      entityIds: persisted.item.entityIds,
      draftEntityIds,
      costMinor: composed.costMinorInt,
      model: composed.model,
      durationMs: Date.now() - started,
      replayed: false,
    };
  }

  /** `POST /v1/refresh`: exactly one new item from the buffer (AC-11.3.2, AC-11.3.7). */
  refresh(businessId: string): Promise<RefreshResult> {
    return this.refreshEngine.refresh(businessId);
  }

  /** `POST /v1/commentary`. */
  commentary(businessId: string, journeyId: string): Promise<CommentaryResult> {
    return composeCommentary(this.deps, businessId, journeyId);
  }

  /**
   * `POST /v1/chapter-title`; `quarter` defaults to the current one. The model's title for a quarter that has ended is
   * stored (`chapter_titles`, 0044), so the Ribbon names that chapter from then on. A current quarter's facts still
   * move, and a provisional fallback is never stored: the Ribbon keeps its own provisional title until a model title.
   */
  async chapterTitle(businessId: string, quarter?: string): Promise<ChapterTitleResult> {
    const q = quarter ?? quarterOf(this.now());
    const result = await composeChapterTitle(this.deps, businessId, q);
    if (result.source === "model" && parseQuarter(q).to.getTime() <= this.now().getTime()) {
      await repos.journeys.setChapterTitle(this.deps.db, businessId, { chapterId: result.quarter, title: result.title, subtitle: result.subtitle, mood: result.mood });
    }
    return result;
  }

  /**
   * `POST /v1/founder-titles`: the business's open tasks without a founder title (or exactly `taskIds`) get one, in the
   * founder's words (0070; founder-titles.ts). Best effort per task: a bad answer leaves the technical title in place.
   */
  founderTitles(businessId: string, taskIds?: readonly string[]): Promise<FounderTitlesResult> {
    return composeFounderTitles(this.deps, businessId, taskIds);
  }

  exhibits(): ReturnType<typeof namedQueryCatalogue> {
    return namedQueryCatalogue();
  }

  exhibit(businessId: string, id: string): Promise<ExhibitData | null> {
    return runNamedQuery(this.deps.db, businessId, id, this.now());
  }

  /** Pre-writes a business's buffer (boot warm-up, tests). */
  warm(businessId: string): Promise<number> {
    return this.refreshEngine.warm(businessId);
  }

  /** Waits for background refills to settle (tests, shutdown). */
  drain(businessId?: string): Promise<void> {
    return this.refreshEngine.drain(businessId);
  }

  async healthy(): Promise<boolean> {
    try {
      await repos.inbox.bufferList(this.deps.db, "00000000-0000-0000-0000-000000000000");
      return true;
    } catch {
      return false;
    }
  }
}

export function createComposerService(deps: ComposerServiceDeps, options: ComposerServiceOptions = {}): ComposerService {
  return new ComposerService(deps, options);
}

/** A narration answered from the note already written for the same events (nothing written, nothing billed). */
function replay(persisted: Persisted, started: number): NarrateResult {
  return {
    item: persisted.item,
    eventIds: [...persisted.item.sourceEventIds],
    reasked: false,
    entityIds: persisted.item.entityIds,
    draftEntityIds: [],
    costMinor: 0,
    model: null,
    durationMs: Date.now() - started,
    replayed: true,
  };
}
