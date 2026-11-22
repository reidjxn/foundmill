"use client";
/**
 * "Working in <site>" on Working now (founder, Nov 22, 2026): each website session the team has open in the hosted
 * browser, with Watch, Take over, Hand back and Stop (`browser.*`). The list refreshes by polling, as other live reads
 * here do; no new stream. Absent while no session is open. `?site=<key>` (the Inbox's "Open <site>") opens that
 * session's live view on arrival.
 */
import { useEffect, useState } from "react";
import { BrowserSessionCard, type BrowserSessionView } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets/data";
import { errorMessage } from "./shared";

/** How often the open sessions are asked for again. */
export const BROWSER_SESSIONS_POLL_MS = 5_000;

interface SessionsResponse {
  canControl: boolean;
  sessions: (BrowserSessionView & { startedAt: string; siteKey: string })[];
}

type Call = "takeOver" | "handBack" | "stop";

export function BrowserSessions() {
  const { mutate } = useWidgetData();
  const q = useWidgetQuery<SessionsResponse>("browser.sessions", {}, { refetchIntervalMs: BROWSER_SESSIONS_POLL_MS });
  const [pending, setPending] = useState<{ siteKey: string; call: Call } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openSite, setOpenSite] = useState<string | null>(null);
  useEffect(() => {
    setOpenSite(new URLSearchParams(window.location.search).get("site"));
  }, []);

  const run = async (siteKey: string, call: Call) => {
    setPending({ siteKey, call });
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== siteKey)));
    try {
      await mutate(`browser.${call}`, { siteKey });
      q.refetch();
    } catch (e) {
      setErrors((all) => ({ ...all, [siteKey]: errorMessage(e instanceof Error ? e : String(e)) }));
    } finally {
      setPending(null);
    }
  };

  const sessions = q.data?.sessions ?? [];
  if (sessions.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col gap-2 p-panel-pad" data-testid="browser-sessions">
      {sessions.map((s) => (
        <BrowserSessionCard
          key={s.siteKey}
          session={s}
          canControl={q.data?.canControl ?? false}
          autoOpen={openSite === s.siteKey}
          pending={pending?.siteKey === s.siteKey ? pending.call : null}
          error={errors[s.siteKey] ?? null}
          onTakeOver={() => void run(s.siteKey, "takeOver")}
          onHandBack={() => void run(s.siteKey, "handBack")}
          onStop={() => void run(s.siteKey, "stop")}
        />
      ))}
    </div>
  );
}
