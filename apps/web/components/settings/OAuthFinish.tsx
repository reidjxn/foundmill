"use client";
/**
 * Back from an OAuth vendor's consent page (Google, Notion, Shopify, Stripe; app/integrations/oauth/callback): the
 * connection finishes here by itself, once (founder, Nov 18, 2026: no second press after allowing access). The api
 * exchanges the code only with the state it signed for this founder, business and connector, so a link carrying someone
 * else's code connects nothing. The code works once: whatever happens, the address loses it.
 */
import { Plug } from "lucide-react";
import { useEffect, useRef } from "react";
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

export function OAuthFinish({ businessId, connectors, onFinish }: { businessId: string; connectors: readonly { key: string; displayName: string }[]; onFinish: (connectorKey: string, input: Record<string, string>, done: () => void) => void }) {
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
