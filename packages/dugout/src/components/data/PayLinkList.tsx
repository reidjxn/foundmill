"use client";
/**
 * The Site tab's "Pay buttons" panel (WP-07 T7): a project's payment links, each with the button address the team uses
 * (`/_fm/pay/<key>`), a simulated link marked as never shown on the site, and, for someone who may edit, "Add a payment
 * link" (a name and a Stripe payment link) and "Remove". Presentational: the caller loads the list and runs add and
 * remove (packages/modules `PayLinksPanel`).
 */
import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button } from "../foundation/Button";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { StatusPill } from "../foundation/StatusPill";
import { Panel } from "../shell/Panel";

export interface PayLinkListItem {
  id: string;
  key: string;
  label: string;
  source: "pasted" | "stripe";
  /** A mock connector's link: never shown on the site. */
  simulated: boolean;
}

export const PAY_LINK_WORDS = {
  title: "Pay buttons",
  help: `Create a payment link in your own Stripe account and paste it here. Payments go straight to you; ${APP_NAME} never holds the money.`,
  empty: "No payment links yet.",
  add: "Add a payment link",
  label: "Button name",
  labelHint: "What it pays for, such as “Starter kit”.",
  url: "Payment link",
  urlHint: "Starts with https://buy.stripe.com/",
  save: "Add link",
  cancel: "Cancel",
  remove: "Remove",
  simulated: "Simulated link: not shown on your site",
  fromTeam: "Made by your team",
  button: (key: string) => `Button address /_fm/pay/${key}`,
  readOnly: "Only an owner or an admin can add or remove payment links.",
} as const;

export interface PayLinkListProps {
  items: readonly PayLinkListItem[];
  canEdit: boolean;
  /** A save or a removal is running: the buttons wait. */
  pending?: boolean;
  /** The last action's error, in plain words. */
  error?: string | null;
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
  /** Resolves when the link was added (the form then closes); rejects to keep it open. */
  onAdd(input: { label: string; url: string }): Promise<void>;
  onRemove(id: string): void;
  labelMax?: number;
  urlMax?: number;
}

export function PayLinkList({ items, canEdit, pending = false, error, loading, loadError, onRetry, onAdd, onRemove, labelMax = 80, urlMax = 500 }: PayLinkListProps) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const add = async () => {
    try {
      await onAdd({ label, url });
      setLabel("");
      setUrl("");
      setAdding(false);
    } catch {
      // The caller shows the error; the form stays open with what was typed.
    }
  };
  return (
    <Panel title={PAY_LINK_WORDS.title} span={12} loading={loading} error={loadError} onRetry={onRetry} data-testid="pay-links">
      <p className="t-small text-secondary mb-3">{PAY_LINK_WORDS.help}</p>
      {items.length === 0 && !loading ? <p className="t-body text-secondary mb-3">{PAY_LINK_WORDS.empty}</p> : null}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-3 mb-3">
          {items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 border-b border-subtle pb-3" data-testid={`pay-link-${l.key}`}>
              <span className="t-body font-semibold">{l.label}</span>
              <span className="t-small text-secondary mono">{PAY_LINK_WORDS.button(l.key)}</span>
              {l.simulated ? <StatusPill tone="warn">{PAY_LINK_WORDS.simulated}</StatusPill> : null}
              {l.source === "stripe" && !l.simulated ? <span className="t-small text-secondary">{PAY_LINK_WORDS.fromTeam}</span> : null}
              {canEdit ? (
                <span className="ml-auto">
                  <Button variant="secondary" size="sm" onClick={() => onRemove(l.id)} disabled={pending} data-testid="pay-link-remove">
                    <Trash2 aria-hidden size={14} /> {PAY_LINK_WORDS.remove}
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!canEdit ? <p className="t-small text-secondary">{PAY_LINK_WORDS.readOnly}</p> : null}
      {canEdit && !adding ? (
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)} data-testid="pay-link-add">
          <Plus aria-hidden size={14} /> {PAY_LINK_WORDS.add}
        </Button>
      ) : null}
      {canEdit && adding ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Field htmlFor={`${id}-label`} label={PAY_LINK_WORDS.label} hint={PAY_LINK_WORDS.labelHint}>
            <Input id={`${id}-label`} value={label} maxLength={labelMax} onChange={(e) => setLabel(e.target.value)} required />
          </Field>
          <Field htmlFor={`${id}-url`} label={PAY_LINK_WORDS.url} hint={PAY_LINK_WORDS.urlHint}>
            <Input id={`${id}-url`} value={url} maxLength={urlMax} placeholder="https://buy.stripe.com/" mono onChange={(e) => setUrl(e.target.value)} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !label.trim() || !url.trim()} data-testid="pay-link-save">
              {PAY_LINK_WORDS.save}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(false)}>
              {PAY_LINK_WORDS.cancel}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="t-body text-status-bad mt-3" role="alert">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
