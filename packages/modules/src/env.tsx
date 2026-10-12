"use client";
/**
 * Host-provided environment for module screens (docs/ARCHITECTURE.md §18 keeps modules free of the tRPC client and the
 * Next router; this context carries the few non-data things a screen needs from the host).
 *
 * - `collabUrl`: the Hocuspocus WebSocket (apps/collab) the Specification tab connects to. Default ws://localhost:4004.
 * - `collabToken`: the bearer the collab server authenticates (the Supabase access token, or a dev token).
 * - `SpecEditor`: the host's collaborative block editor (Tiptap 3 + Yjs + @hocuspocus/provider, see
 *   product/spec/editor-contract.ts). When absent, the Specification tab falls back to the plain block editor that
 *   saves through `product.spec.editBlock`.
 * - `canWrite`: whether the signed-in person may change a section (a write role and the section's staff permission,
 *   `hasSectionAccess` in @foundmill/shared, as the API and apps/collab enforce). Screens hide or lock their editing
 *   controls when it is false, so a viewer never types into an editor whose edits the server throws away.
 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { Section } from "@foundmill/shared/permissions";

export const DEFAULT_COLLAB_URL = "ws://localhost:4004";

/** Props every spec block editor implementation receives (the host's Tiptap editor or the plain fallback). */
export interface SpecEditorProps {
  businessId: string;
  blockId: string;
  /** `spec:<businessId>:<blockId>` (apps/collab document-name.ts). */
  documentName: string;
  collabUrl: string;
  collabToken?: string;
  /** ProseMirror JSON as last read from `product.spec.get`; the collab server is the source of truth once connected. */
  initialContent: Record<string, unknown>;
  /** Human-edited (pinned) blocks are locked for agents; humans keep writing. */
  pinned: boolean;
  readOnly?: boolean;
  /** Called when the editor persists content outside the CRDT path (the plain fallback does; Tiptap does not need to). */
  onSaved?: (content: Record<string, unknown>) => void;
  onStatusChange?: (status: SpecEditorStatus) => void;
}

export type SpecEditorStatus = "connecting" | "connected" | "disconnected" | "local";

export interface ModuleEnv {
  collabUrl: string;
  collabToken?: string;
  SpecEditor?: ComponentType<SpecEditorProps>;
  /** Whether the signed-in person may change `section`. Outside a host (stories, tests) everything is writable. */
  canWrite: (section: Section) => boolean;
}

const writeAll = () => true;
const DEFAULT_ENV: ModuleEnv = { collabUrl: DEFAULT_COLLAB_URL, canWrite: writeAll };

const Ctx = createContext<ModuleEnv>(DEFAULT_ENV);

export function ModuleEnvProvider({ value, children }: { value: Partial<ModuleEnv>; children: ReactNode }) {
  return <Ctx.Provider value={{ ...DEFAULT_ENV, ...value }}>{children}</Ctx.Provider>;
}

/** The host environment; outside a provider the defaults apply (local collab server, plain editor). */
export function useModuleEnv(): ModuleEnv {
  return useContext(Ctx);
}

/** Whether the signed-in person may change `section` (the host's role and staff permissions). */
export function useCanWrite(section: Section): boolean {
  return useContext(Ctx).canWrite(section);
}
