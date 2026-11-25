"use client";
/**
 * Back from an OAuth vendor's consent page (Google, Notion, Shopify, Stripe; app/integrations/oauth/callback): the
 * connection finishes here by itself, once (founder, Nov 18, 2026: no second press after allowing access). The api
 * exchanges the code only with the state it signed for this founder, business and connector, so a link carrying someone
 * else's code connects nothing. The code works once: whatever happens, the address loses it.
 */
import { Plug } from "lucide-react";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@foundmill/dugout";
import { Hint, SettingsSection } from "./shared";

/** What the callback left in the address: the connector, and either the code and state or the vendor's refusal. */
export interface OAuthReturn {
  connectorKey: string;
  code: string | null;
  state: string | null;
  shop: string | null;
  error: string | null;
}

export function oauthReturnFrom(search: URLSearchParams | null): OAuthReturn | null {
  const connectorKey = search?.get("oauth_connector") ?? "";
  if (!/^[a-z0-9_]{1,60}$/.test(connectorKey)) return null;
  return { connectorKey, code: search?.get("oauth_code") ?? null, state: search?.get("oauth_state") ?? null, shop: search?.get("oauth_shop") ?? null, error: search?.get("oauth_error") ?? null };
}

/** The `integrations.connect` input that finishes the consent. */
export function oauthFinishInput(r: OAuthReturn): Record<string, string> | null {
  if (!r.code || !r.state) return null;
  return { code: r.code, state: r.state, ...(r.shop ? { shop: r.shop } : {}) };
}

/** Why there is nothing to finish, in words. */
export function oauthRefusal(name: string, error: string | null): string {
  if (error === "access_denied") return `You did not allow access on ${name}'s page, so nothing was connected. Use Connect below to try again.`;
  return `${name} did not send back an authorization, so nothing was connected. Use Connect below to try again.`;
}

export const LOVABLE_KEY = "lovable_mcp";
/** Set once a refused Lovable sign-in was retried with fewer permissions in this tab, so it is retried only once. */
const LOVABLE_RETRIED = "fm_lovable_retried";

/** Lovable's refusal in plain words, by its OAuth error code (founder, Nov 25, 2026): never a dead end. */
export function lovableRefusal(error: string | null): string {
  if (error === "access_denied") return "You did not allow access on Lovable's page, so Lovable was not connected.";
  if (error === "invalid_scope") return "Lovable did not allow the access we asked for, which can happen below its Business plan, so it was not connected.";
  return `Lovable did not connect${error ? ` (${error.replace(/_/g, " ")})` : ""}.`;
}

/** The way in that works for every Lovable account: Lovable opens with this project's plan as the first message, and you press send there. */
export function LovableWayIn({ businessId, reason }: { businessId: string; reason: string }) {
  const trpc = useTRPC();
  const link = useQuery(trpc.integrations.lovableBuildLink.queryOptions({ businessId }));
  return (
    <div className="flex flex-col gap-2" data-testid="lovable-way-in">
      <Hint>
        {reason} You can still build it with Lovable: open Lovable with your plan, in your own Lovable account, and press send there.
      </Hint>
      {link.data ? (
        <a className="text-link underline" href={link.data.url} target="_blank" rel="noreferrer" data-testid="lovable-build-link">
          Open Lovable with your plan
        </a>
      ) : null}
    </div>
  );
}

export function OAuthFinish({ businessId, connectors, onFinish, onRetryScopes }: { businessId: string; connectors: readonly { key: string; displayName: string }[]; onFinish: (connectorKey: string, input: Record<string, string>, done: () => void) => void; onRetryScopes?: (connectorKey: string) => void }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const back = oauthReturnFrom(search);
  const input = back ? oauthFinishInput(back) : null;
  const clear = () => router.replace(pathname ?? `/b/${businessId}/settings/integrations`);
  // One attempt per code: a re-render, or React running the effect twice in development, does not send it again.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!back || !input || sent.current === input.code) return;
    sent.current = input.code!;
    onFinish(back.connectorKey, input, clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the code: the callbacks change every render.
  }, [input?.code]);
  // Lovable refused the access asked for (invalid_scope, below its Business plan): asked once more with fewer permissions.
  const retry = back?.connectorKey === LOVABLE_KEY && back.error === "invalid_scope" && !!onRetryScopes && !alreadyRetried();
  useEffect(() => {
    if (!retry) return;
    markRetried();
    onRetryScopes!(LOVABLE_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per refusal.
  }, [retry]);
  if (!back) return null;
  const name = connectors.find((c) => c.key === back.connectorKey)?.displayName ?? back.connectorKey;
  return (
    <SettingsSection title={`Finish connecting ${name}`}>
      <div className="flex items-center gap-3" data-testid="oauth-finish">
        {input ? (
          <>
            <Hint>You allowed access on {name}&apos;s page. Connecting it to this business so agents can use it. Its token is encrypted with the business data key and never shown again.</Hint>
            <Button variant="primary" icon={Plug} loading disabled>
              Connecting {name}
            </Button>
          </>
        ) : back.connectorKey === LOVABLE_KEY ? (
          retry ? (
            <Hint>Lovable did not allow every permission we asked for. Asking once more with fewer.</Hint>
          ) : (
            <>
              <LovableWayIn businessId={businessId} reason={lovableRefusal(back.error)} />
              <Button variant="ghost" onClick={clear}>
                Dismiss
              </Button>
            </>
          )
        ) : (
          <>
            <Hint>{oauthRefusal(name, back.error)}</Hint>
            <Button variant="ghost" onClick={clear}>
              Dismiss
            </Button>
          </>
        )}
      </div>
    </SettingsSection>
  );
}

function alreadyRetried(): boolean {
  try {
    return window.sessionStorage.getItem(LOVABLE_RETRIED) === "1";
  } catch {
    return true;
  }
}

function markRetried(): void {
  try {
    window.sessionStorage.setItem(LOVABLE_RETRIED, "1");
  } catch {
    /* no storage: alreadyRetried() reads true, so nothing loops */
  }
}
