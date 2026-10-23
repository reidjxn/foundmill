"use client";
/**
 * One agent desk sheet for the whole business (no new screen): the agent profile's "Talk", the command palette's
 * "Ask <agent>…" and anything else that wants to talk to an agent open it with `useAgentDesk().open(...)`. The sheet
 * slides over whatever the founder was looking at and closes back to it.
 *
 * The host is on every business page, so it stays small: the sheet itself (the conversation, its Markdown and the plan
 * confirmation) is its own chunk. It is fetched when the browser is idle after the page has loaded, earlier when the
 * founder points at or focuses a Talk / Ask control (`prefetch`), and at the latest when the first desk opens. The
 * Inbox's inline desk imports the conversation directly (the note's own desk is there on first paint), and that copy is
 * the one the sheet uses there (`provideAgentConversation`).
 */
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useState, type ReactNode, type Ref } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import type { AgentConversation } from "./AgentConversation";
import type { ConversationSubject } from "./logic";

export interface OpenDeskOptions {
  /** Who the founder is talking to, so the sheet opens at once while the conversation loads. */
  persona?: { name: string; role?: string | null; avatarSeed: string; personaKey?: string | null; dept?: DeptColourToken | null } | null;
  /** Sent as the founder's first message once the desk is ready (the palette carries the typed question). */
  text?: string | null;
  /** The line under the band ("About: …"). */
  subjectLine?: ReactNode;
}

export interface AgentDeskApi {
  open: (subject: ConversationSubject, options?: OpenDeskOptions) => void;
  close: () => void;
  /** Fetch the sheet's code ahead of `open` (pointer over or focus on a Talk / Ask control). Safe to call often. */
  prefetch: () => void;
  /** The subject of the open desk, if any. */
  current: ConversationSubject | null;
}

/** The sheet's chunk, one fetch for the prefetch and the sheet; a failed fetch is tried again on the next call. */
type SheetModule = { AgentConversation: typeof AgentConversation };
let sheetChunk: Promise<SheetModule> | null = null;
function loadSheet(): Promise<SheetModule> {
  sheetChunk ??= import("./AgentConversation").catch((err: unknown) => {
    sheetChunk = null;
    throw err;
  });
  return sheetChunk;
}

/**
 * A page that imports the conversation itself (the Inbox's inline desk) hands the module over, so the sheet and the
 * idle prefetch never fetch a second copy of what the page already has.
 */
export function provideAgentConversation(mod: SheetModule): void {
  sheetChunk ??= Promise.resolve(mod);
}

/** Start fetching the sheet's code (a Talk / Ask control pointed at or focused, the palette opened). Safe to call often. */
export function prefetchAgentDesk(): void {
  void loadSheet().catch(() => undefined);
}

/** Client only: the sheet renders after an `open`, never on the server. */
const AgentConversationSheet = dynamic(() => loadSheet().then((m) => m.AgentConversation), { ssr: false });

/** After the page has loaded, when the browser has nothing else to do (at the latest after `IDLE_TIMEOUT_MS`). */
const IDLE_TIMEOUT_MS = 4_000;
function whenIdleAfterLoad(run: () => void): () => void {
  let idle: number | undefined;
  let timer: number | undefined;
  const schedule = () => {
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else timer = window.setTimeout(run, 1_000);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
  return () => {
    window.removeEventListener("load", schedule);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

const Ctx = createContext<AgentDeskApi | null>(null);

/** The open desk, or null outside a business (callers then hide their Talk / Ask actions). */
export function useAgentDesk(): AgentDeskApi | null {
  return useContext(Ctx);
}

/** `apiRef` lets the component that renders the host (the shell, for the command palette's Ask rows) open desks too. */
export function AgentDeskHost({ children, apiRef }: { children: ReactNode; apiRef?: Ref<AgentDeskApi> }) {
  const [state, setState] = useState<{ subject: ConversationSubject; options: OpenDeskOptions; seq: number } | null>(null);
  const [open, setOpen] = useState(false);
  const openDesk = useCallback((subject: ConversationSubject, options: OpenDeskOptions = {}) => {
    prefetchAgentDesk();
    setState((s) => ({ subject, options, seq: (s?.seq ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const api = useMemo<AgentDeskApi>(() => ({ open: openDesk, close, prefetch: prefetchAgentDesk, current: open && state ? state.subject : null }), [openDesk, close, open, state]);
  useImperativeHandle(apiRef, () => api, [api]);
  useEffect(() => whenIdleAfterLoad(prefetchAgentDesk), []);
  const clearText = useCallback(() => setState((s) => (s ? { ...s, options: { ...s.options, text: null } } : s)), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {state ? (
        <AgentConversationSheet
          // A new subject (or a new question) is a new desk: its own thread, its own first message.
          key={`${state.subject.kind}:${state.subject.id}:${state.seq}`}
          subject={state.subject}
          variant="sheet"
          open={open}
          onOpenChange={setOpen}
          personaHint={state.options.persona ?? null}
          initialText={state.options.text ?? null}
          onInitialTextSent={clearText}
          subjectLine={state.options.subjectLine}
        />
      ) : null}
    </Ctx.Provider>
  );
}
