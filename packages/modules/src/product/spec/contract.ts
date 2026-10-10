/**
 * Collab editor contract shared by the Specification tab and the host's Tiptap implementation.
 * Document names follow apps/collab/src/document-name.ts: `spec:<businessId>:<specBlockId>`.
 */
export type { SpecEditorProps, SpecEditorStatus } from "../../env";

export function specDocumentName(businessId: string, specBlockId: string): string {
  return `spec:${businessId}:${specBlockId}`;
}

export const SPEC_EDITOR_STATUS_LABEL = {
  connecting: "Connecting",
  connected: "Live",
  disconnected: "Offline",
  local: "Editing",
} as const;
