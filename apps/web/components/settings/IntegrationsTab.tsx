"use client";
/**
 * Settings › Integrations (BUILD §11.15, §13): the connector catalogue with connect / disconnect / health, scopes
 * and status pills, plus the dev-only Simulate panel (BUILD §13.3). The panel calls `dev.simulate` on apps/api
 * (owner/admin only), which mints the service token and proxies to apps/ingest over the private network
 * (docs/SECURITY_REVIEW.md SEC-2); the browser never talks to ingest. The procedure exists in development only
 * (never staging: production runs APP_ENV=staging).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ExternalLink, FlaskConical, FolderGit2, KeyRound, MapPin, Plug, RefreshCw, Unplug } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, IconButton, Input, SimpleSelect, StatusPill, Term, cn, useBuilderView, useDateFormat, type StatusTone, type DateFormatPrefs } from "@foundmill/dugout";
import {
  normalizePostalAddress,
  PLATFORM_MAIL_APPROVAL_LINE,
  PLATFORM_MAIL_OWN_SENDER_LINE,
  PLATFORM_MAIL_PAUSED_LINE,
  PLATFORM_MAIL_REPLIES_LINE,
  PLATFORM_MAIL_SIMULATED_LINE,
  PLATFORM_MAIL_TITLE,
  platformMailCountLine,
  POSTAL_ADDRESS_FOUNDERS_ONLY,
  POSTAL_ADDRESS_LABEL,
  POSTAL_ADDRESS_MAX,
  POSTAL_ADDRESS_MISSING,
  POSTAL_ADDRESS_PLACEHOLDER,
  POSTAL_ADDRESS_PRIVATE,
  POSTAL_ADDRESS_WHY,
  postalAddressProblem,
  type IntegrationStatus,
} from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { ShellLinkButton } from "@/components/live/ShellLinkButton";
import { simulatePanelAvailable } from "@/lib/env";
import { formatDateTime, plainWords, plural } from "@/lib/format";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { RefreshFailedNotice, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { GitHubRepositoryPanel } from "./GitHubRepositoryPanel";
import { OAuthFinish } from "./OAuthFinish";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

export const STATUS_TONE: Record<IntegrationStatus, { tone: StatusTone; word: string }> = {
  connected: { tone: "good", word: "Connected" },
  degraded: { tone: "warn", word: "Degraded" },
  expired: { tone: "bad", word: "Expired" },
  disconnected: { tone: "neutral", word: "Not connected" },
  mock: { tone: "info", word: "Test data" },
};

/** How a connector signs in, in words (never the stored kind). */
export const AUTH_WORD: Record<string, string> = {
  oauth: "Sign in with the vendor",
  api_key: "API key",
  app: "Install the app",
  none: "No sign-in needed",
};

/**
 * Which connector rows Settings lists: one that cannot be connected here (unbuilt or mock-only, `available` false) is
 * hidden unless it is already connected, so it can still be disconnected; the custom MCP server field is Builder view's
 * (LAUNCH_EVALUATION §2, MCP 6).
 */
export function visibleConnectors<T extends { key: string; available?: boolean; integration: { status: string } | null }>(rows: readonly T[], builder: boolean): T[] {
  return rows.filter((r) => (r.available !== false || (r.integration !== null && r.integration.status !== "disconnected")) && (r.key !== "mcp_custom" || builder));
}

/** The six panel actions BUILD §13.3 names; the ingest catalogue may add more. */
export const SIMULATIONS: { name: string; label: string; description: string }[] = [
  { name: "signup.created", label: "Signup", description: "A made-up signup, as if from Stripe" },
  { name: "payment.received", label: "Payment", description: "A paid invoice: records a new paying customer, a journey and a Customer Update" },
  { name: "lead.replied", label: "Lead reply", description: "A made-up reply from a lead, as if by email" },
  { name: "bank.balance_updated", label: "Bank sync", description: "A made-up bank balance update" },
  { name: "channel.threshold_breached", label: "Customer cost spike", description: "A channel's cost to win a customer jumps past its threshold" },
  { name: "credential.expiring", label: "Credential expiry", description: "A connection whose sign-in is about to expire" },
];

/** What `dev.simulate` answers: ingest's status and body, shown verbatim (ingest labels it "Simulated"). */
export interface SimulateResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** The `dev.simulate` input for one panel click (the API mints the token; the browser sends no credential of its own). */
export function simulateInput(businessId: string, eventName: string, connector: string): { businessId: string; eventName: string; connector?: string } {
  return { businessId, eventName, ...(connector ? { connector } : {}) };
}

/** The result pane text: `name → status` then the body (JSON pretty-printed, text verbatim). */
export function formatSimulateResult(name: string, result: SimulateResult): string {
  return `${name} → ${result.status}\n${typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2)}`;
}

/** The toast line for a refusal: the status and ingest's message. */
export function simulateRefusalMessage(result: SimulateResult): string {
  return `${result.status}: ${typeof result.body === "string" ? result.body : JSON.stringify(result.body)}`;
}

/**
 * Whether the Connectors section names its mode: always when live; in test mode only where a mock can be connected (a
 * sample project, development, test). A person's project on staging sees "Not available yet" per connector instead.
 */
export function showsModeChip(mode: string, rows: readonly { live?: boolean; available?: boolean }[]): boolean {
  return mode !== "mock" || !rows.some((r) => !r.live && r.available === false);
}

/** The connector that has its own box on Settings › Integrations, "Accept payments with Stripe". */
export const STRIPE_CONNECTOR_KEY = "stripe";

/** The connectors' mode: "Live", "Mock mode", or "Mock mode · GitHub live" when named connectors run live anyway. */
export function modeLabel(mode: string, rows: readonly { displayName: string; live?: boolean }[]): string {
  if (mode !== "mock") return "Live";
  const live = rows.filter((r) => r.live).map((r) => r.displayName);
  return live.length ? `Test mode · ${live.join(", ")} live` : "Test mode";
}

/** The toast after a connection is made: the vendor and the project it now works for (founder, Nov 18, 2026). */
export function connectedTitle(vendor: string, project: string | null | undefined): string {
  return project ? `Connected ${vendor} to ${project}` : `Connected ${vendor}`;
}

/** The vendor account under that title, unless it only repeats the project's name ("foundmill" under "… to Foundmill"). */
export function connectedAccountLine(account: string | null | undefined, project: string | null | undefined): string | undefined {
  if (!account) return undefined;
  return project && account.trim().toLowerCase() === project.trim().toLowerCase() ? undefined : account;
}

/** The toast line for a healthy check: a test connection says nothing was asked of the vendor, never the connector's own words. */
export function healthLine(health: { status?: string; message?: string | null }): string | undefined {
  return health.status === "mock" ? "Test data: nothing was checked with the vendor." : (health.message ?? undefined);
}

/** The line under a connector: its account, what agents can do with it, when it was last checked (in the person's `prefs`). */
export function connectorDetail(c: { tools: readonly unknown[] }, integ: { accountLabel?: string | null; scopes: readonly string[]; lastHealthAt?: string | Date | null } | null, prefs?: DateFormatPrefs | null): string {
  const parts: string[] = [];
  if (integ?.accountLabel) parts.push(integ.accountLabel);
  parts.push(`${plural(c.tools.length, "agent action")}`);
  if (integ?.scopes.length) parts.push(plural(integ.scopes.length, "permission"));
  if (integ?.lastHealthAt) parts.push(`checked ${formatDateTime(integ.lastHealthAt, prefs)}`);
  return parts.join(" · ");
}

/**
 * Connectors managed on another tab: the Anthropic key decides who pays for model calls (`model_billing`), pauses and
 * resumes the team and posts the Inbox note, so it is stored, rotated and revoked in Settings › Keys only (audit
 * ARB-04). Its row here shows the state and links there instead of a generic Connect or Disconnect.
 */
export const MANAGED_ON_KEYS_TAB: ReadonlySet<string> = new Set(["anthropic"]);

/** Days before a consent lapses that the connector offers to renew it (the Cash tab warns from the same day). */
export const CONSENT_RENEW_DAYS = 7;

/** When the vendor consent behind a connection lapses (open banking: Tink, Plaid), from what the connector reported at connect. */
export function consentExpiry(integ: { settings?: unknown } | null): Date | null {
  const raw = (integ?.settings as { expiresAt?: unknown } | undefined)?.expiresAt;
  if (typeof raw !== "string" && !(raw instanceof Date)) return null;
  const at = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Whether a connection needs the founder's consent again: it expired or degraded, or its consent lapses within
 * `CONSENT_RENEW_DAYS`. Renewing connects again in place (`integrations.connect` upserts and keeps the settings), so
 * the stored credentials are never revoked first.
 */
export function needsRenewal(integ: { status: string; settings?: unknown } | null, now: Date = new Date()): boolean {
  if (!integ || integ.status === "disconnected") return false;
  if (integ.status === "expired" || integ.status === "degraded") return true;
  const expiry = consentExpiry(integ);
  return expiry !== null && expiry.getTime() - now.getTime() <= CONSENT_RENEW_DAYS * 86_400_000;
}

/** Leaves for a vendor's consent page in this tab (a seam for tests). */
export const navigation = { assign: (url: string) => window.location.assign(url) };
const navigateTo = (url: string) => navigation.assign(url);

/** A field the founder enters to connect a connector live (its `connectFields` in the catalogue). */
export interface ConnectFieldView {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  hint?: string;
}

/** True when Connect must first ask for the founder's own key: the connector runs live and declares fields to enter. */
export function needsConnectFields(c: { live?: boolean; connectFields?: readonly ConnectFieldView[] }): boolean {
  return Boolean(c.live) && (c.connectFields?.length ?? 0) > 0;
}

/**
 * Two ways in, both offered (Stripe, founder Nov 17, 2026): signing in on the vendor's page, or the founder's own key.
 * Only when the connector runs live; a test connection connects with one click as before.
 */
export function offersSignInAndKey(c: { live?: boolean; auth: { authorizationCode?: boolean }; connectFields?: readonly ConnectFieldView[] }): boolean {
  return needsConnectFields(c) && c.auth.authorizationCode === true;
}

/** How a connector signs in, in words, for the row's second line. */
export function authWordFor(c: { displayName: string; live?: boolean; auth: { kind: string; authorizationCode?: boolean }; connectFields?: readonly ConnectFieldView[] }): string {
  if (offersSignInAndKey(c)) return `Sign in with ${c.displayName}, or an API key`;
  return AUTH_WORD[c.auth.kind] ?? plainWords(c.auth.kind);
}

/** The connection was made with a pasted key (Stripe's `config.kind` "own"), so renewing asks for a key again. */
const connectedWithKey = (integ: { settings?: unknown } | null): boolean => ((integ?.settings as { config?: { kind?: unknown } } | undefined)?.config?.kind ?? null) === "own";

/** The `connect()` input from what was typed (trimmed; empty optional fields left out), or null while a required one is empty. */
export function connectInputFrom(fields: readonly ConnectFieldView[], values: Record<string, string>): Record<string, string> | null {
  const input: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.name] ?? "").trim();
    if (!v && f.required) return null;
    if (v) input[f.name] = v;
  }
  return input;
}

/**
 * Asks for the key from the founder's own vendor account (masked, never shown again) and connects with it, so the
 * vendor bills the founder and agents act on the founder's account, never the platform's.
 */
export function ConnectFieldsDialog({ connector, pending, onConnect, onClose }: { connector: { key: string; displayName: string; connectFields: readonly ConnectFieldView[] } | null; pending: boolean; onConnect: (input: Record<string, string>) => void; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  // What was typed belongs to one opening of the dialog: when it closes (a successful connect closes it from outside)
  // or opens for another connector, the key is forgotten, never offered to the next vendor or kept in memory.
  const [openFor, setOpenFor] = useState<string | null>(connector?.key ?? null);
  if ((connector?.key ?? null) !== openFor) {
    setOpenFor(connector?.key ?? null);
    setValues({});
  }
  const input = connector ? connectInputFrom(connector.connectFields, values) : null;
  const close = () => {
    setValues({});
    onClose();
  };
  return (
    <Dialog open={connector !== null} onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent size="sm" data-testid="connect-fields-dialog">
        {connector ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (input) onConnect(input);
            }}
          >
            <DialogHeader>
              <DialogTitle>Connect {connector.displayName}</DialogTitle>
              <DialogDescription>Use your own {connector.displayName} account: {connector.displayName} bills it for what agents do. The key is encrypted with the business data key and never shown again.</DialogDescription>
            </DialogHeader>
            {connector.connectFields.map((f) => (
              <Field key={f.name} htmlFor={`connect-${connector.key}-${f.name}`} label={f.label} hint={f.hint}>
                <Input
                  id={`connect-${connector.key}-${f.name}`}
                  name={f.name}
                  mono={f.secret}
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={f.placeholder}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              </Field>
            ))}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" icon={KeyRound} disabled={!input} loading={pending}>
                Connect
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** What `integrations.platformMail` answers (null when the deployment has no sending domain: no row at all). */
export interface PlatformMailView {
  address: string;
  sentToday: number;
  cap: number;
  paused: boolean;
  live: boolean;
  ownSender: boolean;
  /** The founders' postal address for marketing email (US CAN-SPAM); null when none is entered, or for a collaborator. */
  postalAddress?: string | null;
  /** The reader is a founder (owner or admin): they may enter and change the address. */
  canEditPostalAddress?: boolean;
}

/**
 * The founders' postal address for the project's marketing email (US CAN-SPAM; founder, Nov 13, 2026): why the law asks
 * for it, that a PO box is fine, and that it never reaches the public page. Until it is entered the team cannot send
 * marketing email from the project's address. Only the founders change it.
 */
export function PostalAddressField({ businessId, value, canEdit }: { businessId: string; value: string | null; canEdit: boolean }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [draft, setDraft] = useState(value ?? "");
  const [touched, setTouched] = useState(false);
  // A save elsewhere (another tab, another founder) brings the stored value back into an untouched field.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!touched) setDraft(value ?? "");
  }
  const save = useMutation(
    trpc.integrations.setPostalAddress.mutationOptions({
      onSuccess: (r) => {
        setTouched(false);
        setDraft(r.address);
        void invalidate(["integrations", "inbox", "today"]);
        t.saved("Postal address saved", "Marketing emails from the project's address show it at the bottom.");
      },
      onError: (e) => t.failed(e),
    }),
  );
  const problem = draft.trim() ? postalAddressProblem(draft) : null;
  const unchanged = value !== null && normalizePostalAddress(draft) === value;
  return (
    <form
      className="flex flex-col gap-2"
      data-testid="postal-address"
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit && draft.trim() && !problem && !unchanged) save.mutate({ businessId, address: draft });
      }}
    >
      <Field htmlFor="postal-address-input" label={POSTAL_ADDRESS_LABEL} hint={POSTAL_ADDRESS_WHY} error={touched && problem ? problem : undefined}>
        <Input
          id="postal-address-input"
          name="postalAddress"
          autoComplete="street-address"
          maxLength={POSTAL_ADDRESS_MAX * 2}
          placeholder={POSTAL_ADDRESS_PLACEHOLDER}
          value={draft}
          disabled={!canEdit}
          onChange={(e) => {
            setDraft(e.target.value);
            setTouched(true);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button type="submit" variant="secondary" icon={MapPin} disabled={!draft.trim() || Boolean(problem) || unchanged} loading={save.isPending} data-testid="postal-address-save">
            {value ? "Save address" : "Add address"}
          </Button>
        ) : null}
        {value ? null : (
          <span className="text-small text-secondary" data-testid="postal-address-missing">
            {POSTAL_ADDRESS_MISSING}
          </span>
        )}
      </div>
      <Hint>{canEdit ? POSTAL_ADDRESS_PRIVATE : `${POSTAL_ADDRESS_PRIVATE} ${POSTAL_ADDRESS_FOUNDERS_ONLY}`}</Hint>
    </form>
  );
}

/**
 * "Email from your project" (package 1.5): the project's Foundmill sending address, today's count against its cap, the
 * line about outside contact, and the founders' postal address for marketing email. Nothing to connect: the cap is
 * raised by Foundmill.
 */
export function PlatformMailSection({ data, businessId }: { data: PlatformMailView | null | undefined; businessId?: string }) {
  if (!data) return null;
  return (
    <SettingsSection title={PLATFORM_MAIL_TITLE} data-testid="platform-mail" actions={data.live ? null : <Chip tone="info">Test mode</Chip>}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-body-strong text-primary" data-testid="platform-mail-address">
          {data.address}
        </span>
        <span className="text-small text-secondary" data-testid="platform-mail-count">
          {platformMailCountLine(data.sentToday, data.cap)}
        </span>
      </div>
      <Hint>{PLATFORM_MAIL_APPROVAL_LINE}</Hint>
      <Hint>{PLATFORM_MAIL_REPLIES_LINE}</Hint>
      {data.paused ? <Hint>{PLATFORM_MAIL_PAUSED_LINE}</Hint> : null}
      {data.ownSender ? <Hint>{PLATFORM_MAIL_OWN_SENDER_LINE}</Hint> : null}
      {data.live ? null : <Hint>{PLATFORM_MAIL_SIMULATED_LINE}</Hint>}
      {businessId ? <PostalAddressField businessId={businessId} value={data.postalAddress ?? null} canEdit={data.canEditPostalAddress === true} /> : null}
    </SettingsSection>
  );
}

export function IntegrationsTab() {
  const datePrefs = useDateFormat();
  const { businessId, data: businessData } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const list = useQuery(trpc.integrations.list.queryOptions({ businessId }));
  const vendorName = (key: string) => list.data?.catalogue.find((c) => c.key === key)?.displayName ?? plainWords(key);
  const platformMail = useQuery(trpc.integrations.platformMail.queryOptions({ businessId }));
  /** The connector whose key dialog is open (Connect on a live API-key connector). */
  const [keyForKey, setKeyForKey] = useState<string | null>(null);
  const connect = useMutation(
    trpc.integrations.connect.mutationOptions({
      onSuccess: (r, vars) => {
        void invalidate(["integrations"]);
        if (r.consentUrl) {
          // The vendor's page opens in this tab: a new tab opened after the request returns is a pop-up browsers block
          // (Safari always). The vendor sends the founder back here to finish (GitHub: /integrations/github/callback;
          // Google, Notion, Shopify: /integrations/oauth/callback, finished in OAuthFinish).
          t.info("Your consent is needed", "Opening the vendor's page; the connection completes when you accept and come back here.");
          navigateTo(r.consentUrl);
        } else t.saved(connectedTitle(vendorName(vars.connectorKey), businessData?.business.name), connectedAccountLine(r.record.accountLabel, businessData?.business.name));
      },
      onError: (e) => t.failed(e, "Could not connect"),
    }),
  );
  const disconnect = useMutation(trpc.integrations.disconnect.mutationOptions({ onSuccess: () => (void invalidate(["integrations"]), t.saved("Disconnected", "Credentials revoked.")), onError: (e) => t.failed(e) }));
  const health = useMutation(
    trpc.integrations.health.mutationOptions({
      onSuccess: (r) => (void invalidate(["integrations"]), r.health.ok ? t.saved("Healthy", healthLine(r.health)) : t.failed(new Error(r.health.message ?? "health check failed"), "Unhealthy")),
      onError: (e) => t.failed(e, "Health check failed"),
    }),
  );

  // Back from installing the GitHub App (app/integrations/github/callback): the founder confirms the installation here.
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // A deep link from another screen (Finance › Cash "Renew consent" → ?connector=tink) brings that connector's row into view.
  const focusKey = search?.get("connector") ?? null;
  useEffect(() => {
    if (!focusKey || !list.data) return;
    document.querySelector(`[data-connector="${CSS.escape(focusKey)}"]`)?.scrollIntoView?.({ block: "center" });
  }, [focusKey, list.data]);
  const pendingInstallation = /^\d{1,20}$/.test(search?.get("github_installation") ?? "") ? search!.get("github_installation")! : null;
  const installCode = search?.get("github_code") ?? null;
  const installState = search?.get("github_state") ?? null;
  // The code works once: whatever happens, the address loses it.
  const confirmInstallation = () =>
    pendingInstallation &&
    installCode &&
    installState &&
    connect.mutate({ businessId, connectorKey: "github", input: { installationId: Number(pendingInstallation), code: installCode, state: installState } }, { onSettled: () => router.replace(pathname ?? `/b/${businessId}/settings/integrations`) });

  const builder = useBuilderView();
  if (loadFailed(list)) return <ErrorPanel title="Integrations" message={errorMessage(list.error)} onRetry={() => void list.refetch()} />;
  const rows = list.data?.catalogue ?? [];
  // One row per connector, the same wherever it appears (Stripe's own box above the list, and the list).
  const renderRow = (c: (typeof rows)[number]) => {
    const integ = c.integration;
    const status = STATUS_TONE[(integ?.status ?? "disconnected") as IntegrationStatus] ?? STATUS_TONE.disconnected;
    const connected = integ !== null && integ.status !== "disconnected";
    const renew = connected && needsRenewal(integ);
    const expiry = consentExpiry(integ);
    const both = offersSignInAndKey(c);
    const renewWithKey = both ? connectedWithKey(integ) : needsConnectFields(c);
    const renewWord = both ? (renewWithKey ? "Reconnect" : `Sign in with ${c.displayName} again`) : c.auth.kind === "oauth" ? "Renew consent" : "Reconnect";
    const pending = connect.isPending && connect.variables?.connectorKey === c.key;
    const signIn = () => connect.mutate({ businessId, connectorKey: c.key, input: {} });
    return (
      <li key={c.key} className={cn("flex min-h-row-comfortable items-start gap-3 border-b border-line-faint py-2.5 last:border-b-0", focusKey === c.key && "rounded-panel bg-panel-alt outline outline-2 -outline-offset-2 outline-link")} data-connector={c.key} aria-current={focusKey === c.key ? "true" : undefined}>
        <span className="flex w-40 shrink-0 flex-col">
          <span className="text-body-strong text-primary">{c.displayName}</span>
          <span className="text-small text-tertiary">{authWordFor(c)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={status.tone}>{status.word}</StatusPill>
            {list.data?.mode === "mock" && c.live ? <Chip tone="good">Live</Chip> : null}
          </span>
          <span className="break-words text-small text-secondary" title={integ?.scopes.length ? `Permissions: ${integ.scopes.join(", ")}` : undefined}>
            {connectorDetail(c, integ, datePrefs)}
          </span>
          {connected && expiry ? <span className={cn("text-small", renew ? "text-status-warn" : "text-tertiary")}>Consent until {formatDateTime(expiry, datePrefs)}</span> : null}
          {integ?.lastError ? <span className="break-words text-small text-status-bad">{integ.lastError}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 pt-0.5">
          {MANAGED_ON_KEYS_TAB.has(c.key) ? (
            <ShellLinkButton size="sm" icon={KeyRound} href={routes.settings(businessId, "keys")} data-testid="manage-in-keys">
              Manage in Keys
            </ShellLinkButton>
          ) : connected ? (
            <>
              {renew ? (
                <Button size="sm" icon={renewWithKey ? KeyRound : c.auth.kind === "oauth" ? ExternalLink : RefreshCw} loading={pending} onClick={() => (renewWithKey ? setKeyFor(c) : signIn())}>
                  {renewWord}
                </Button>
              ) : null}
              {c.key === "gmail" ? (
                // Reading asks Google for a second, stricter permission, so it is the founder's choice, made by signing in again.
                <Button size="sm" variant="ghost" icon={ExternalLink} loading={pending} onClick={() => connect.mutate({ businessId, connectorKey: c.key, input: { readMail: !(integ?.scopes ?? []).some((x) => x.endsWith("/gmail.readonly")) } })} data-testid="gmail-reading-toggle">
                  {(integ?.scopes ?? []).some((x) => x.endsWith("/gmail.readonly")) ? "Turn off reading" : "Turn on reading"}
                </Button>
              ) : null}
              <IconButton label={`Check ${c.displayName} health`} icon={Activity} size="sm" disabled={health.isPending} onClick={() => integ && health.mutate({ businessId, integrationId: integ.id })} />
              <IconButton label={`Disconnect ${c.displayName}`} icon={Unplug} size="sm" disabled={disconnect.isPending} onClick={() => integ && disconnect.mutate({ businessId, integrationId: integ.id })} />
            </>
          ) : c.available === false ? (
            <Chip tone="neutral" data-testid="connector-not-available">
              Not available yet
            </Chip>
          ) : both ? (
            <>
              <Button size="sm" variant="primary" icon={ExternalLink} loading={pending} onClick={signIn} data-testid="sign-in-with-vendor">
                Sign in with {c.displayName}
              </Button>
              <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setKeyFor(c)} data-testid="use-an-api-key">
                Use an API key
              </Button>
            </>
          ) : (
            <Button size="sm" icon={needsConnectFields(c) ? KeyRound : c.auth.kind === "oauth" ? ExternalLink : Plug} loading={pending} onClick={() => (needsConnectFields(c) ? setKeyFor(c) : signIn())}>
              Connect
            </Button>
          )}
        </span>
      </li>
    );
  };
  // Stripe has its own box above the other connectors (founder, Nov 18, 2026), so it is listed once.
  const stripeRow = rows.find((r) => r.key === STRIPE_CONNECTOR_KEY) ?? null;
  const listed = visibleConnectors(rows.filter((r) => r.key !== STRIPE_CONNECTOR_KEY), builder);
  const keyFor = rows.find((r) => r.key === keyForKey) ?? null;
  const setKeyFor = (c: { key: string } | null) => setKeyForKey(c?.key ?? null);

  return (
    <AdminOnly>
      {refreshFailed(list) ? <RefreshFailedNotice query={list} className="flex items-center gap-2" /> : null}
      {pendingInstallation ? (
        <SettingsSection title="Finish connecting GitHub">
          <div className="flex items-center gap-3" data-testid="github-installation">
            {installCode && installState ? (
              <>
                <Hint>
                  GitHub installation {pendingInstallation} is ready. Connect it to this business so agents can push their code to their own <Term id="branch">branches</Term>. GitHub confirms you can manage it first. Then choose the <Term id="repository">repository</Term> below.
                </Hint>
                <Button variant="primary" icon={FolderGit2} loading={connect.isPending} onClick={confirmInstallation}>
                  Connect installation
                </Button>
              </>
            ) : (
              <Hint>GitHub did not confirm who installed installation {pendingInstallation}, so it cannot be connected from this link. Use Connect on GitHub below to install it again.</Hint>
            )}
          </div>
        </SettingsSection>
      ) : null}
      <PlatformMailSection data={platformMail.data} businessId={businessId} />
      <OAuthFinish businessId={businessId} connectors={rows} onFinish={(connectorKey, input, done) => connect.mutate({ businessId, connectorKey, input }, { onSettled: done })} />
      {stripeRow ? (
        <SettingsSection wide title="Accept payments with Stripe" data-testid="stripe-payments" loading={list.isLoading}>
          <Hint>Take payments on your own Stripe account. Sign in with Stripe, or use a restricted key from your Stripe dashboard. Stripe's fees stay on your account.</Hint>
          <ul className="flex flex-col">{renderRow(stripeRow)}</ul>
        </SettingsSection>
      ) : null}
      <SettingsSection wide title="Connectors" meta={list.data ? plural(listed.filter((r) => r.integration && r.integration.status !== "disconnected").length, "connected", "connected") : undefined} actions={list.data && showsModeChip(list.data.mode, rows) ? <Chip tone={list.data.mode === "mock" ? "info" : "good"}>{modeLabel(list.data.mode, rows)}</Chip> : undefined} loading={list.isLoading}>
        <Hint>Consents and API keys are yours to grant: a connector that needs one opens the vendor's page and waits for you. Secrets are stored encrypted and never shown again.</Hint>
        <ul className="flex flex-col" data-testid="connector-list">
          {listed.map(renderRow)}
        </ul>
      </SettingsSection>
      {rows.some((r) => r.key === "github" && r.integration && r.integration.status !== "disconnected") ? <GitHubRepositoryPanel /> : null}
      <ConnectFieldsDialog
        connector={keyFor}
        pending={connect.isPending}
        onClose={() => setKeyFor(null)}
        onConnect={(input) => keyFor && connect.mutate({ businessId, connectorKey: keyFor.key, input }, { onSuccess: () => setKeyFor(null) })}
      />
      {simulatePanelAvailable() ? <SimulatePanel businessId={businessId} connectors={rows.filter((c) => c.simulations.length > 0).map((c) => ({ key: c.key, label: c.displayName, simulations: c.simulations }))} /> : null}
    </AdminOnly>
  );
}

export function SimulatePanel({ businessId, connectors }: { businessId: string; connectors: { key: string; label: string; simulations: readonly string[] }[] }) {
  const trpc = useTRPC();
  const t = useSettingsToast();
  const invalidate = useInvalidateRouters();
  const [connector, setConnector] = useState<string>("");
  const [last, setLast] = useState<{ name: string; result: SimulateResult } | null>(null);
  const fire = useMutation(
    trpc.dev.simulate.mutationOptions({
      onSuccess: (result, vars) => {
        setLast({ name: vars.eventName, result });
        if (result.ok) {
          t.saved("Simulated", `${vars.eventName} went through the same path as a real event.`);
          void invalidate(["inbox", "journey", "finance", "integrations", "distribution"]);
        } else t.failed(new Error(simulateRefusalMessage(result)), "Simulation refused");
      },
      onError: (e) => t.failed(e, "Simulation failed"),
    }),
  );
  return (
    <SettingsSection title="Simulate" actions={<Chip tone="warn" icon={FlaskConical}>Development only</Chip>} data-testid="simulate-panel">
      <Hint>Makes up an event as if the vendor had sent it. It is labeled “Simulated”, costs nothing and never leaves this computer. Owners and admins only.</Hint>
      <div className="flex items-center gap-3">
        <span className="t-label">Connector</span>
        <SimpleSelect aria-label="Connector" controlSize="sm" value={connector} onValueChange={setConnector} placeholder="Default per event" options={[{ value: "", label: "Default per event" }, ...connectors.map((c) => ({ value: c.key, label: c.label }))]} className="w-56" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SIMULATIONS.map((s) => (
          <Button key={s.name} size="sm" variant="default" loading={fire.isPending && fire.variables?.eventName === s.name} onClick={() => fire.mutate(simulateInput(businessId, s.name, connector))} title={s.description} data-simulate={s.name}>
            {s.label}
          </Button>
        ))}
      </div>
      {last ? (
        <pre className="max-h-48 overflow-auto rounded-panel bg-ink p-2 font-mono text-mono text-secondary" data-testid="simulate-result">
          {formatSimulateResult(last.name, last.result)}
        </pre>
      ) : null}
    </SettingsSection>
  );
}
