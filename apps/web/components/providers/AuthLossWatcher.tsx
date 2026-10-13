"use client";
/**
 * Sends the tab away when it loses its access (lib/auth/session-end.ts): the session ended (another tab signed out, or
 * the API answered UNAUTHORIZED) or the person was removed from the business on screen. Mounted once in AppProviders,
 * inside the toast and query providers; renders nothing.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useToast } from "@foundmill/dugout";
import { emitAuthLoss, handleAuthLoss, onAuthLoss, watchSignedOutElsewhere, type AuthLossDeps } from "@/lib/auth/session-end";
import { businessOfKey, routerOfKey } from "@/lib/query-keys";
import { getStreamClient } from "@/lib/stream-client";

export function AuthLossWatcher() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  // The latest router and toast, without re-subscribing every render.
  const latest = useRef({ router, toast });
  latest.current = { router, toast };

  useEffect(() => {
    const deps: AuthLossDeps = {
      queryClient,
      closeStream: () => getStreamClient().close(),
      navigate: (url) => window.location.assign(url),
      replace: (path) => latest.current.router.replace(path),
      toast: (t) => latest.current.toast(t),
      location: () => ({ pathname: window.location.pathname, search: window.location.search }),
      businessName: (businessId) => {
        for (const [, data] of queryClient.getQueriesData<{ name?: unknown }>({ predicate: (q) => routerOfKey(q.queryKey) === "business" && businessOfKey(q.queryKey) === businessId })) {
          if (typeof data?.name === "string" && data.name) return data.name;
        }
        return null;
      },
      storage: (() => {
        try {
          return window.sessionStorage;
        } catch {
          return null;
        }
      })(),
    };
    const stopApi = onAuthLoss((loss, from) => handleAuthLoss(loss, from, deps));
    const stopTabs = watchSignedOutElsewhere(() => emitAuthLoss({ kind: "signed-out" }, "tab"));
    return () => {
      stopApi();
      stopTabs();
    };
  }, [queryClient]);

  return null;
}
