/**
 * Persistence for spec-block documents through `@foundmill/db` repositories only (ARCHITECTURE §4).
 *
 * There is no Yjs state column on `spec_blocks` (checked 0003_product.sql), so the store converts: load reads
 * `spec_blocks.content` (ProseMirror JSON) into the Yjs fragment; save converts the fragment back and calls
 * `repos.product.editBlock`, which bumps `version` and records `authored_by_kind` / `authored_by` for the last
 * writer. Unchanged content is not written again, so idle documents never inflate the version. A store that carries a
 * human's edit pins the block (BUILD §11.5 "never overwrite pinned (human-edited) blocks", AC-11.5.3), exactly as
 * product.spec.editBlock does in apps/api; an agent's or the system's store leaves `pinned` as it is.
 */
import { repos, type Db, type SpecBlock } from "@foundmill/db";
import type * as Y from "yjs";
import { DEFAULT_FRAGMENT, EMPTY_DOC, fillFragment, fragmentToPmDoc, parsePmDoc, type PmNode } from "./prosemirror";

export type AuthorKind = "user" | "agent" | "system";

export interface Author {
  kind: AuthorKind;
  id: string | null;
}

export interface SpecBlockStore {
  /** The block row (throws NotFoundError when the block is not in the business). */
  getBlock(businessId: string, specBlockId: string): Promise<SpecBlock>;
  /** Fills a freshly created document from the stored ProseMirror JSON. Returns the block. */
  load(businessId: string, specBlockId: string, document: Y.Doc): Promise<SpecBlock>;
  /**
   * Persists the document's current content when it differs from what was last stored. The block is pinned when the
   * author is a user or `options.humanEdited` says a human changed the document since the last store.
   */
  save(businessId: string, specBlockId: string, document: Y.Doc, author: Author, options?: SaveOptions): Promise<{ stored: boolean; block: SpecBlock | null }>;
  /** Forget the cached last-stored content (called on unload). */
  forget(businessId: string, specBlockId: string): void;
}

export interface SaveOptions {
  /** A human edited the document since the last store, even if an agent's update came last. */
  humanEdited?: boolean;
}

export interface SpecBlockStoreOptions {
  field?: string;
}

const keyOf = (businessId: string, specBlockId: string) => `${businessId}:${specBlockId}`;

/** Parses stored content defensively: a corrupt row degrades to an empty document rather than refusing to open. */
export function contentToPmDoc(content: unknown): PmNode {
  try {
    return parsePmDoc(content);
  } catch {
    return EMPTY_DOC;
  }
}

export function createSpecBlockStore(db: Db, options: SpecBlockStoreOptions = {}): SpecBlockStore {
  const field = options.field ?? DEFAULT_FRAGMENT;
  /** Serialised content last loaded or stored per document, to skip no-op writes. */
  const lastStored = new Map<string, string>();

  return {
    getBlock: (businessId, specBlockId) => repos.product.getBlock(db, businessId, specBlockId),

    async load(businessId, specBlockId, document) {
      const block = await repos.product.getBlock(db, businessId, specBlockId);
      const pm = contentToPmDoc(block.content);
      const fragment = document.getXmlFragment(field);
      if (fragment.length === 0) document.transact(() => fillFragment(fragment, pm), { source: "local", skipStoreHooks: true });
      lastStored.set(keyOf(businessId, specBlockId), JSON.stringify(fragmentToPmDoc(fragment)));
      return block;
    },

    async save(businessId, specBlockId, document, author, options = {}) {
      const content = fragmentToPmDoc(document.getXmlFragment(field));
      const serialised = JSON.stringify(content);
      const key = keyOf(businessId, specBlockId);
      if (lastStored.get(key) === serialised) return { stored: false, block: null };
      const block = await repos.product.editBlock(db, businessId, specBlockId, {
        content: content as unknown as Record<string, unknown>,
        authoredByKind: author.kind,
        authoredBy: author.id,
        ...(author.kind === "user" || options.humanEdited ? { pinned: true } : {}),
      });
      lastStored.set(key, serialised);
      return { stored: true, block };
    },

    forget(businessId, specBlockId) {
      lastStored.delete(keyOf(businessId, specBlockId));
    },
  };
}
