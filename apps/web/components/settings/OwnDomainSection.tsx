"use client";

/**
 * "Send from your own domain" (WP-08 domain plan, Path B): a domain the founder already owns. The founders type it and
 * the name mail goes as there; the panel lists the DNS records to add, each with a copy button and what the last check
 * found; "Check now" asks SendGrid and DNS again. Once every sending record is found, the project's mail goes from
 * `<name>@<domain>`; replies still come back through the project's Foundmill address. The founder's own MX is never
 * touched, so mail they already receive keeps working.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Forward, Globe, RefreshCw, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { Button, Chip, Field, IconButton, Input, useDateFormat, useToast } from "@foundmill/dugout";
import { OWN_DOMAIN_DEFAULT_SENDER, type OwnDomainRecord } from "@foundmill/shared";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { GetDomainForm } from "./GetDomainForm";
import { useInvalidateRouters } from "./SettingsScreen";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

const PURPOSE_LABEL: Record<OwnDomainRecord["purpose"], string> = {
  sending: "For sending",
  site: "For your site",
  inbound: "For mail to your domain",
  dmarc: "For mail checks",
};

function recordLine(r: OwnDomainRecord): string {
  if (r.found === true) return "Found";
  if (r.found === false) return r.reason ?? "Not found yet.";
  return "Not checked yet";
}

export function OwnDomainRecords({ records }: { records: readonly OwnDomainRecord[] }) {
  const { toast } = useToast();
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: "Copied",
        description: "Paste it at the company you bought the domain from.",
        tone: "good",
      });
    } catch {
      toast({
        title: "Copy did not work",
        description: "Select the value and copy it by hand.",
        tone: "warn",
      });
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small" data-testid="own-domain-records">
        <thead className="text-left text-secondary">
          <tr>
            <th className="py-1 pr-3 font-normal">What for</th>
            <th className="py-1 pr-3 font-normal">Type</th>
            <th className="py-1 pr-3 font-normal">Name</th>
            <th className="py-1 pr-3 font-normal">Value</th>
            <th className="py-1 font-normal">Check</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={`${r.type}:${r.host}`}
              className="border-t border-subtle"
              data-testid="own-domain-record"
            >
              <td className="py-1 pr-3 text-secondary">{PURPOSE_LABEL[r.purpose]}</td>
              <td className="py-1 pr-3 font-mono">{r.type}</td>
              <td className="py-1 pr-3 font-mono">
                {r.host}{" "}
                <IconButton
                  label={`Copy the name ${r.host}`}
                  icon={Copy}
                  size="sm"
                  onClick={() => void copy(r.host)}
                />
              </td>
              <td className="py-1 pr-3 font-mono">
                {r.priority !== undefined ? `${r.priority} ` : ""}
                {r.value}{" "}
                <IconButton
                  label={`Copy the value for ${r.host}`}
                  icon={Copy}
                  size="sm"
                  onClick={() => void copy(r.value)}
                />
              </td>
              <td
                className={r.found === true ? "py-1 text-status-good" : "py-1 text-secondary"}
                data-testid="own-domain-record-check"
              >
                {recordLine(r)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OwnDomainSection({ businessId }: { businessId: string }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const own = useQuery(trpc.integrations.ownDomain.queryOptions({ businessId }));
  const [domain, setDomain] = useState("");
  const [sender, setSender] = useState(OWN_DOMAIN_DEFAULT_SENDER);
  const done = (title: string, description: string) => () => {
    void invalidate(["integrations"]);
    t.saved(title, description);
  };
  const add = useMutation(
    trpc.integrations.addOwnDomain.mutationOptions({
      onSuccess: done(
        "Domain added",
        "Add the records below where you bought the domain, then press Check now.",
      ),
      onError: (e) => t.failed(e),
    }),
  );
  const check = useMutation(
    trpc.integrations.checkOwnDomain.mutationOptions({
      onSuccess: (r) => {
        void invalidate(["integrations"]);
        if (r.domain?.status === "verified")
          t.saved(
            "Your domain is ready",
            `Email from the project now goes from ${r.domain.senderLocalPart}@${r.domain.domain}.`,
          );
        else
          t.saved(
            "Not every record is there yet",
            "DNS changes can take up to a few hours. Check again later.",
          );
      },
      onError: (e) => t.failed(e),
    }),
  );
  const remove = useMutation(
    trpc.integrations.removeOwnDomain.mutationOptions({
      onSuccess: done(
        "Domain removed",
        `Email from the project goes from its ${APP_NAME} address again.`,
      ),
      onError: (e) => t.failed(e),
    }),
  );
  const finish = useMutation(
    trpc.integrations.finishDomainSetup.mutationOptions({
      onSuccess: done("Records set", "Press Check now in a few minutes to see them found."),
      onError: (e) => t.failed(e),
    }),
  );
  const forwarding = useMutation(
    trpc.integrations.setDomainForwarding.mutationOptions({
      onSuccess: (r) => {
        void invalidate(["integrations"]);
        t.saved(
          r.domain?.forwarding ? "Forwarding is on" : "Forwarding is off",
          r.domain?.forwarding
            ? "Mail to any name at your domain is kept in the project, and a copy goes to the email you sign in with."
            : "Mail to your domain is still kept in the project.",
        );
      },
      onError: (e) => t.failed(e),
    }),
  );
  const datePrefs = useDateFormat();
  const data = own.data;
  if (!data) return null;
  const row = data.domain;
  return (
    <SettingsSection
      title="Send from your own domain"
      data-testid="own-domain"
      loading={own.isLoading}
      actions={
        row ? (
          <Chip tone={row.status === "verified" ? "good" : "info"}>
            {row.status === "verified" ? "Sending from it" : "Waiting for records"}
          </Chip>
        ) : null
      }
    >
      {row ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="font-mono text-body-strong text-primary"
              data-testid="own-domain-address"
            >
              {row.senderLocalPart}@{row.domain}
            </span>
          </div>
          {row.source === "registered" ? (
            <Hint>
              Registered in your name
              {row.expiresAt ? `, paid until ${formatDate(row.expiresAt, datePrefs)}` : ""}.{" "}
              {APP_NAME} set these records for you. Mail to any name at the domain is kept in the
              project.
            </Hint>
          ) : (
            <Hint>
              {row.status === "verified"
                ? "Email from the project goes from this address. Replies still come back to the project."
                : "Add these records where you bought the domain. Mail you already receive there keeps working: nothing here changes it."}
            </Hint>
          )}
          {row.records.length ? (
            <OwnDomainRecords records={row.records} />
          ) : (
            <Hint>The records are not set yet. Press Finish setup.</Hint>
          )}
          {data.simulated ? (
            <Hint>This check is simulated here: nothing was asked of SendGrid or DNS.</Hint>
          ) : null}
          {data.canEdit ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                icon={RefreshCw}
                loading={check.isPending}
                onClick={() => check.mutate({ businessId })}
                data-testid="own-domain-check"
              >
                Check now
              </Button>
              {row.source === "registered" ? (
                <>
                  {row.records.length ? null : (
                    <Button
                      variant="secondary"
                      icon={Wrench}
                      loading={finish.isPending}
                      onClick={() => finish.mutate({ businessId })}
                      data-testid="own-domain-finish"
                    >
                      Finish setup
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    icon={Forward}
                    loading={forwarding.isPending}
                    onClick={() => forwarding.mutate({ businessId, on: !row.forwardingMine })} data-testid="own-domain-forwarding">
                    {row.forwardingMine ? "Stop forwarding to my inbox" : row.forwarding ? "Forward to my inbox instead" : "Forward mail to my inbox"}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  loading={remove.isPending}
                  onClick={() => remove.mutate({ businessId })}
                  data-testid="own-domain-remove"
                >
                  Remove domain
                </Button>
              )}
            </div>
          ) : null}
        </>
      ) : data.canEdit ? (
        <>
          <form
            className="flex flex-col gap-2"
            data-testid="own-domain-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (domain.trim() && sender.trim())
                add.mutate({ businessId, domain, senderLocalPart: sender });
            }}
          >
            <Hint>
              Have a domain already? Email from the project can go from it, like
              hello@yourdomain.com. You add a few records where you bought it; nothing you receive
              there changes.
            </Hint>
            <div className="flex flex-wrap items-end gap-3">
              <Field htmlFor="own-domain-sender" label="Send as">
                <Input
                  id="own-domain-sender"
                  value={sender}
                  maxLength={40}
                  onChange={(e) => setSender(e.target.value)}
                />
              </Field>
              <Field htmlFor="own-domain-input" label="Your domain">
                <Input
                  id="own-domain-input"
                  value={domain}
                  placeholder="yourdomain.com"
                  maxLength={300}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant="secondary"
                icon={Globe}
                disabled={!domain.trim() || !sender.trim()}
                loading={add.isPending}
                data-testid="own-domain-add"
              >
                Add domain
              </Button>
            </div>
          </form>
          {data.canRegister ? <GetDomainForm businessId={businessId} /> : null}
        </>
      ) : (
        <Hint>The founders can send the project's email from a domain they own.</Hint>
      )}
    </SettingsSection>
  );
}
