/**
 * The Composer service facade (docs/ARCHITECTURE.md §11): narrate, refresh, commentary, chapter titles and the named
 * query registry, over one database and one models client. `createApp` wraps it in HTTP; tests call it directly.
 */
import { repos, type Db, type InboxItem } from "@foundmill/db";
import type { ModelClient, ModelLogger } from "@foundmill/models";
import { NotFoundError, ValidationError } from "@foundmill/shared";
import { composeChapterTitle, quarterOf, type ChapterTitleResult } from "./chapter";
import { composeCommentary, type CommentaryResult } from "./commentary";
import { composeNote } from "./compose";
import { loadContext } from "./context";
import { namedQueryCatalogue, runNamedQuery, type ExhibitData } from "./exhibits";
import { persistDrafts, persistNote } from "./persist";
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
  model: string;
  durationMs: number;
}

export class ComposerService {
  readonly refreshEngine: RefreshEngine;
  private readonly draftsOn: boolean;
  private readonly now: () => Date;

  constructor(
    private readonly deps: ComposerServiceDeps,
    options: ComposerServiceOptions = {},
  ) {
    this.refreshEngine = new RefreshEngine(deps, options);
    this.draftsOn = options.persistDrafts ?? true;
    this.now = options.now ?? (() => new Date());
  }

  /** `POST /v1/narrate`: one item narrating exactly these events, or `ComposerRejectedError` (422) after the single re-ask. */
  async narrate(businessId: string, eventIds: readonly string[]): Promise<NarrateResult> {
    const started = Date.now();
    const ids = [...new Set(eventIds)];
    if (ids.length === 0) throw new ValidationError("eventIds must name at least one event");
    const events = await repos.events.byIds(this.deps.db, businessId, ids);
    if (events.length !== ids.length) {
      const found = new Set(events.map((e) => e.id));
      throw new NotFoundError("event", ids.filter((id) => !found.has(id)).join(", "));
    }
    const ctx = await loadContext(this.deps.db, businessId, { now: this.now(), entityIds: events.flatMap((e) => e.entityIds), skipUnnarrated: true });
    const composed = await composeNote(this.deps, ctx, { mode: "events", events }, { onInvalidLinks: "reject" });
    const persisted = await persistNote(this.deps.db, this.deps.log, {
      businessId,
      item: composed.item,
      eventIds: composed.eventIds,
      costMinorInt: composed.costMinorInt,
      costCurrency: composed.costCurrency,
      slot: "narrate",
    });
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

  /** `POST /v1/chapter-title`; `quarter` defaults to the current one. */
  chapterTitle(businessId: string, quarter?: string): Promise<ChapterTitleResult> {
    return composeChapterTitle(this.deps, businessId, quarter ?? quarterOf(this.now()));
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
