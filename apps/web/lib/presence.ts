"use client";
/**
 * The presence ping (retention plan, 2026-11-11): an open, visible tab of a business tells the api the founder is
 * there, on open, every five minutes and when the tab becomes visible again. The api turns the first ping after 30
 * minutes away into `founder.session_started`. A notification link carries `?via=email&n=<id>`: the first ping sends
 * them, and they are taken off the address so a reload or a shared link does not count the email twice.
 */
import { FOUNDER_RETURN_VIA, PRESENCE, type FounderReturnVia } from "@foundmill/shared/founder-return";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTRPC } from "@/lib/trpc-react";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The notification a link came from, if the address carries a valid one. */
export function readNotificationParams(search: string): { via: FounderReturnVia; notificationId: string } | null {
  const p = new URLSearchParams(search);
  const via = p.get("via");
  const n = p.get("n");
  if (!via || !n || via === "direct" || !(FOUNDER_RETURN_VIA as readonly string[]).includes(via) || !UUID.test(n)) return null;
  return { via: via as FounderReturnVia, notificationId: n };
}

/** The address without the notification parameters (everything else kept). */
export function withoutNotificationParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("via");
  url.searchParams.delete("n");
  return url.toString();
}

export function usePresencePing(businessId: string): void {
  const trpc = useTRPC();
  const { mutate } = useMutation(trpc.founder.presence.ping.mutationOptions());
  const origin = useRef<{ via: FounderReturnVia; notificationId: string } | null | undefined>(undefined);

  useEffect(() => {
    if (origin.current === undefined) {
      origin.current = readNotificationParams(window.location.search);
      if (origin.current) window.history.replaceState(window.history.state, "", withoutNotificationParams(window.location.href));
    }
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      const from = origin.current;
      origin.current = null;
      mutate(from ? { businessId, via: from.via, notificationId: from.notificationId } : { businessId });
    };
    ping();
    const timer = window.setInterval(ping, PRESENCE.pingEveryMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [businessId, mutate]);
}
