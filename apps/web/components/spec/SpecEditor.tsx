"use client";
/**
 * The collaborative spec block editor the business shell hands to @foundmill/modules through `ModuleEnv.SpecEditor`
 * (BUILD §11.5; docs/ARCHITECTURE.md §1 apps/collab). Tiptap 3 with StarterKit, the Collaboration extension over a
 * Yjs document and CollaborationCaret for other writers' carets; `@hocuspocus/provider` connects to
 * `NEXT_PUBLIC_COLLAB_URL` with the Supabase access token (or the dev bearer) and the document name
 * `spec:<businessId>:<specBlockId>` on the default `default` fragment. The collab server loads the block, stores
 * debounced edits and records the human writer, so nothing is saved from here while connected.
 *
 * Local mode (status "local"): with no collab URL, or when the first connection fails (auth refused, server down),
 * the same editor runs on the block's `initialContent` without Yjs, with undo/redo, and saves whole blocks through
 * `product.spec.editBlock` (⌘/Ctrl+S; Esc reverts), exactly like the modules' plain fallback. People who may not change
 * the Product section get a read-only editor: the screen says so through `readOnly`, and the collab server's own answer
 * (scope `readonly` on authentication) locks it too, so nobody types into a document whose edits are refused.
 */
import { useMutation } from "@tanstack/react-query";
import { HocuspocusProvider, WebSocketStatus, type AuthorizedScope } from "@hocuspocus/provider";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Y from "yjs";
import { Button, StatusPill } from "@foundmill/dugout";
import type { SpecEditorProps, SpecEditorStatus } from "@foundmill/modules/env";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { caretColourFor, useSpecUser } from "./spec-user";

/** How long the first sync may take before the editor gives up on the collab server and keeps edits local. */
export const CONNECT_TIMEOUT_MS = 8_000;
/** Yjs field the Collaboration extension and apps/collab share (Tiptap's default). */
export const COLLAB_FIELD = "default";

export type EditorMode = "collab" | "local";

/** Maps the Hocuspocus socket status onto the SpecEditor status contract. */
export function statusFromSocket(status: WebSocketStatus, synced: boolean): SpecEditorStatus {
  if (status === WebSocketStatus.Connected) return synced ? "connected" : "connecting";
  if (status === WebSocketStatus.Connecting) return "connecting";
  return "disconnected";
}

/** Read only when the screen says so or the collab server granted only `readonly` (viewers, advisors, Product read). */
export function isReadOnly(readOnly: boolean | undefined, scope: AuthorizedScope | null): boolean {
  return Boolean(readOnly) || scope === "readonly";
}

/** The mode a block opens in: collaborative when a collab URL is configured, local otherwise. */
export function initialMode(collabUrl: string | undefined): EditorMode {
  return collabUrl && collabUrl.trim().length > 0 ? "collab" : "local";
}

interface CollabSession {
  doc: Y.Doc;
  provider: HocuspocusProvider;
}

export function SpecEditor(props: SpecEditorProps) {
  const [mode, setMode] = useState<EditorMode>(() => initialMode(props.collabUrl));
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  useEffect(() => {
    setMode(initialMode(props.collabUrl));
    setFallbackReason(null);
  }, [props.collabUrl, props.documentName]);

  const toLocal = useCallback((reason: string) => {
    setFallbackReason(reason);
    setMode("local");
  }, []);

  if (mode === "collab") return <CollabBlockEditor key={`collab:${props.documentName}`} {...props} onGiveUp={toLocal} />;
  return <LocalBlockEditor key={`local:${props.documentName}`} {...props} reason={fallbackReason} />;
}

/* ---------- collaborative ---------- */

function CollabBlockEditor({ documentName, collabUrl, collabToken, pinned, readOnly, onStatusChange, onGiveUp }: SpecEditorProps & { onGiveUp: (reason: string) => void }) {
  const user = useSpecUser();
  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<SpecEditorStatus>("connecting");
  const [scope, setScope] = useState<AuthorizedScope | null>(null);
  const synced = useRef(false);

  useEffect(() => {
    const doc = new Y.Doc();
    let gaveUp = false;
    const giveUp = (reason: string) => {
      if (gaveUp || synced.current) return;
      gaveUp = true;
      onGiveUp(reason);
    };
    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: documentName,
      document: doc,
      // The dev bearer apps/collab accepts under DEV_AUTH_USER_ID (docs/DECISIONS.md) when there is no Supabase session.
      token: collabToken ?? "dev",
      onStatus: ({ status: s }) => {
        setStatus(statusFromSocket(s, synced.current));
      },
      onSynced: () => {
        synced.current = true;
        setStatus("connected");
      },
      onAuthenticated: ({ scope: granted }) => setScope(granted),
      onAuthenticationFailed: ({ reason }) => giveUp(`The collab server refused the connection (${reason}).`),
    });
    const timer = window.setTimeout(() => giveUp("The collab server did not answer in time."), CONNECT_TIMEOUT_MS);
    setSession({ doc, provider });
    return () => {
      window.clearTimeout(timer);
      provider.destroy();
      doc.destroy();
      synced.current = false;
      setScope(null);
      setSession(null);
    };
  }, [collabUrl, documentName, collabToken, onGiveUp]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const locked = isReadOnly(readOnly, scope);
  const caret = useMemo(() => ({ name: user.name, color: caretColourFor(user.id) }), [user.name, user.id]);
  if (!session) return <EditorFrame status="connecting" pinned={pinned} readOnly={locked} />;
  return <CollabSurface session={session} status={status} pinned={pinned} readOnly={locked} user={caret} />;
}

function CollabSurface({ session, status, pinned, readOnly, user }: { session: CollabSession; status: SpecEditorStatus; pinned: boolean; readOnly?: boolean; user: { name: string; color: string } }) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [
        // Yjs keeps the history; StarterKit's own undo/redo stack must stay off (Tiptap 3 collaboration docs).
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: session.doc, field: COLLAB_FIELD }),
        CollaborationCaret.configure({ provider: session.provider, user }),
      ],
      // plain-allow: the editor's accessible name; the Product tab that mounts it shows and defines "Specification".
      editorProps: { attributes: { class: "spec-editor-surface t-reading", "aria-label": "Specification block", "data-spec-editor": "collab" } },
    },
    [session, readOnly],
  );
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <EditorFrame status={status} pinned={pinned} readOnly={readOnly}>
      <EditorContent editor={editor} className="min-h-0 flex-1 overflow-auto" />
    </EditorFrame>
  );
}

/* ---------- local (no collab server) ---------- */

function LocalBlockEditor({ businessId, blockId, initialContent, pinned, readOnly, reason, onSaved, onStatusChange }: SpecEditorProps & { reason: string | null }) {
  const trpc = useTRPC();
  const [saved, setSaved] = useState<Record<string, unknown>>(initialContent);
  useEffect(() => setSaved(initialContent), [initialContent, blockId]);
  useEffect(() => {
    onStatusChange?.("local");
  }, [onStatusChange]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: [StarterKit],
      content: initialContent,
      // plain-allow: the editor's accessible name; the Product tab that mounts it shows and defines "Specification".
      editorProps: { attributes: { class: "spec-editor-surface t-reading", "aria-label": "Specification block", "data-spec-editor": "local" } },
    },
    [blockId, readOnly],
  );
  const dirty = useEditorState({ editor, selector: ({ editor: e }) => (e ? JSON.stringify(e.getJSON()) !== JSON.stringify(saved) : false) });

  const save = useMutation(
    trpc.product.spec.editBlock.mutationOptions({
      onSuccess: (_block, vars) => {
        const content = vars.patch.content as Record<string, unknown> | undefined;
        if (content) {
          setSaved(content);
          onSaved?.(content);
        }
      },
    }),
  );
  const doSave = useCallback(() => {
    if (!editor || readOnly || save.isPending) return;
    const content = editor.getJSON() as Record<string, unknown>;
    if (JSON.stringify(content) === JSON.stringify(saved)) return;
    save.mutate({ businessId, blockId, patch: { content } });
  }, [editor, readOnly, save, saved, businessId, blockId]);
  const revert = useCallback(() => {
    editor?.commands.setContent(saved);
  }, [editor, saved]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      doSave();
    } else if (e.key === "Escape" && dirty) {
      e.preventDefault();
      revert();
    }
  };

  return (
    <EditorFrame
      status="local"
      pinned={pinned}
      readOnly={readOnly}
      note={reason ?? undefined}
      actions={
        readOnly ? null : (
          <>
            <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!dirty} onClick={revert}>
              Revert
            </Button>
            <Button size="sm" variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={doSave} data-testid="spec-editor-save">
              Save
            </Button>
          </>
        )
      }
      error={save.error ? errorMessage(save.error) : undefined}
    >
      <div onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-auto" data-dirty={dirty || undefined}>
        <EditorContent editor={editor} />
      </div>
    </EditorFrame>
  );
}

/* ---------- frame ---------- */

const STATUS_TONE: Record<SpecEditorStatus, { tone: "info" | "good" | "bad" | "neutral"; word: string }> = {
  connecting: { tone: "info", word: "Connecting" },
  connected: { tone: "good", word: "Live" },
  disconnected: { tone: "bad", word: "Offline" },
  local: { tone: "neutral", word: "Editing" },
};

function EditorFrame({ status, pinned, readOnly, note, actions, error, children }: { status: SpecEditorStatus; pinned: boolean; readOnly?: boolean; note?: string; actions?: ReactNode; error?: string; children?: ReactNode }) {
  const st = STATUS_TONE[status];
  const hint = useMemo(() => {
    if (readOnly) return "Read only: you can read this document but your role cannot change it.";
    if (status === "connected") return pinned ? "Human-edited block: agents propose changes here instead of writing." : "Edits sync live; the first human edit pins the block for agents.";
    if (status === "local") return "⌘/Ctrl+S saves this block; Esc undoes your changes.";
    if (status === "disconnected") return "Connection lost; edits continue locally and sync when the server is back.";
    return "Loading the shared document…";
  }, [status, pinned, readOnly]);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-spec-editor-status={status} aria-busy={status === "connecting" || undefined}>
      <div className="flex items-center gap-2">
        <StatusPill tone={st.tone} pulse={status === "connecting"}>
          {st.word}
        </StatusPill>
        {/* Pinned is said once, by the panel's own chip and notice above the editor. */}
        <span className="min-w-0 flex-1 text-pretty text-small text-secondary">{note ?? hint}</span>
        {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
      </div>
      {error ? (
        <StatusPill tone="bad" role="alert">
          {error}
        </StatusPill>
      ) : null}
      <div className="flex min-h-64 flex-1 flex-col rounded-panel border border-subtle bg-panel-alt p-3">{children ?? <div className="h-full animate-pulse rounded-panel bg-panel" aria-hidden />}</div>
    </div>
  );
}

export type { Editor };
