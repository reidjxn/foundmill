"use client";
/**
 * "Ask <Chief of Staff>" on every business page (founder, Phase 3), mounted by the shell as the AppShell's `pageActions`
 * so it sits beside "Explain this page" (tab row, breadcrumb row, or a thin row of its own). The control is the design
 * system's `AskChiefOfStaff`; this host supplies the business's real Chief of Staff (`chiefOfStaff.who`, no hard-coded
 * name; the label follows the reader's naming preference), reads the answer with `chiefOfStaff.answer` (Today's own
 * facts, no model call) for the page the founder is on, and opens the agent desk for "Continue in chat" and "Ask
 * something else…". Nothing renders for a business without a Chief of Staff.
 */
import { useCallback, useMemo, useState, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AskChiefOfStaff, Avatar, usePageExplain, useAgentPersona, type AskChiefAnswer } from "@foundmill/dugout";
import type { ChiefQuestion } from "@foundmill/shared";
import { useTRPC } from "@/lib/trpc-react";
import { prefetchAgentDesk, type AgentDeskApi } from "@/components/conversation/DeskHost";
import { useBusiness } from "./business-context";
import { chiefDeskPersona, continueText, pageContextFor } from "./ask-chief";

export function AskChief({ desk }: { desk: RefObject<AgentDeskApi | null> }) {
  const { businessId, departments } = useBusiness();
  const trpc = useTRPC();
  const pathname = usePathname() ?? "";
  const persona = useAgentPersona();
  const explain = usePageExplain();
  const [question, setQuestion] = useState<ChiefQuestion | null>(null);

  const whoQ = useQuery(trpc.chiefOfStaff.who.queryOptions({ businessId }, { staleTime: 5 * 60_000, retry: false }));
  const who = whoQ.data ?? null;
  const page = useMemo(() => pageContextFor(pathname, departments, explain), [pathname, departments, explain]);
  const answerQ = useQuery(trpc.chiefOfStaff.answer.queryOptions({ businessId, question: question ?? "happening", page }, { enabled: question !== null && who !== null, staleTime: 15_000, retry: false }));
  // The people the answer names, under the reader's preference (One name everywhere): the roster Today uses.
  const roster = useMemo(() => departments.flatMap((d) => [...(d.lead ? [d.lead] : []), ...d.squad]), [departments]);

  const answer = useMemo<AskChiefAnswer | null>(() => {
    if (question === null) return null;
    if (answerQ.data && answerQ.data.question === question) return { status: "ready", text: persona.withNames(answerQ.data.text, roster) };
    if (answerQ.isError) return { status: "error" };
    return { status: "loading" };
  }, [question, answerQ.data, answerQ.isError, persona, roster]);

  const open = useCallback(
    (text: string | null) => {
      if (!who) return;
      desk.current?.open({ kind: "agent", id: who.id }, { persona: chiefDeskPersona(who, departments), text });
    },
    [who, departments, desk],
  );

  if (!who) return null;
  const name = persona.nameFor({ name: who.name, role: who.role, personaKey: who.personaKey, layer: who.layer });
  const dept = chiefDeskPersona(who, departments).dept;
  return (
    <AskChiefOfStaff
      name={name}
      renderAvatar={(size) => <Avatar size={size} name={name} agent={{ seed: who.avatarSeed || who.id, dept, personaKey: who.personaKey, layer: who.layer }} />}
      answer={answer}
      onQuestionChange={setQuestion}
      onContinue={(q) => open(continueText(q))}
      onAskElse={() => open(null)}
      onRetry={() => void answerQ.refetch()}
      onIntent={prefetchAgentDesk}
    />
  );
}
