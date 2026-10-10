"use client";
/**
 * One agent desk sheet for the whole business (no new screen): the agent profile's "Talk", the command palette's
 * "Ask <agent>…" and anything else that wants to talk to an agent open it with `useAgentDesk().open(...)`. The sheet
 * slides over whatever the founder was looking at and closes back to it.
 */
import { createContext, useCallback, useContext, useImperativeHandle, useMemo, useState, type ReactNode, type Ref } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { AgentConversation } from "./AgentConversation";
import type { ConversationSubject } from "./logic";

export interface OpenDeskOptions {
  /** Who the founder is talking to, so the sheet opens at once while the conversation loads. */
  persona?: { name: string; role?: string | null; avatarSeed: string; dept?: DeptColourToken | null } | null;
  /** Sent as the founder's first message once the desk is ready (the palette carries the typed question). */
  text?: string | null;
  /** The line under the band ("About: …"). */
  subjectLine?: ReactNode;
}

export interface AgentDeskApi {
  open: (subject: ConversationSubject, options?: OpenDeskOptions) => void;
  close: () => void;
  /** The subject of the open desk, if any. */
  current: ConversationSubject | null;
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
    setState((s) => ({ subject, options, seq: (s?.seq ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const api = useMemo<AgentDeskApi>(() => ({ open: openDesk, close, current: open && state ? state.subject : null }), [openDesk, close, open, state]);
  useImperativeHandle(apiRef, () => api, [api]);
  const clearText = useCallback(() => setState((s) => (s ? { ...s, options: { ...s.options, text: null } } : s)), []);
  return (
    <Ctx.Provider value={api}>
      {children}
      {state ? (
        <AgentConversation
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
