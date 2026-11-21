"use client";

/**
 * "Get a domain" (WP-08 domain plan, Path A): the founder looks a name up and sees its price for a year (OpenSRS's cost
 * plus about $3, labeled Estimate). Register opens a dialog that says plainly the founder is the domain's owner, asks
 * for their contact details (the owner contact, never Foundmill's), shows Tucows' registration agreement to accept, and
 * the price again. Only the founder's own press registers; an agent never does. Foundmill then sets every record.
 */
import { useMutation } from "@tanstack/react-query";
import { APP_NAME } from "@foundmill/config";
import { Globe, Search } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Term,
} from "@foundmill/dugout";
import { DOMAIN_REGISTRATION_AGREEMENT_URL, RegistrantContact } from "@foundmill/shared";
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { useInvalidateRouters } from "./SettingsScreen";
import { Hint, useSettingsToast } from "./shared";

type Quote = { domain: string; available: boolean; priceMinor: number | null; simulated: boolean };

const FIELDS: {
  key: keyof RegistrantContact;
  label: string;
  autoComplete: string;
  placeholder?: string;
  optional?: boolean;
}[] = [
  { key: "firstName", label: "First name", autoComplete: "given-name" },
  { key: "lastName", label: "Last name", autoComplete: "family-name" },
  { key: "email", label: "Email", autoComplete: "email" },
  { key: "phone", label: "Phone", autoComplete: "tel", placeholder: "+1.4155550123" },
  { key: "address1", label: "Street address", autoComplete: "address-line1" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "state", label: "State or region", autoComplete: "address-level1", optional: true },
  { key: "postalCode", label: "ZIP or postal code", autoComplete: "postal-code" },
  { key: "country", label: "Country (two letters)", autoComplete: "country", placeholder: "US" },
];

const price = (minor: number) => formatMoney({ amountMinor: minor, currency: "USD" });

export function GetDomainForm({ businessId }: { businessId: string }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [name, setName] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [accepted, setAccepted] = useState(false);
  const look = useMutation(
    trpc.integrations.quoteDomain.mutationOptions({
      onSuccess: (q) => setQuote(q),
      onError: (e) => t.failed(e),
    }),
  );
  const register = useMutation(
    trpc.integrations.registerDomain.mutationOptions({
      onSuccess: (r) => {
        setOpen(false);
        void invalidate(["integrations"]);
        t.saved(
          "Domain registered",
          `${r.domain?.domain ?? "Your domain"} is yours. Its records are set; email from the project goes from it once they are found.`,
        );
      },
      onError: (e) => t.failed(e),
    }),
  );
  const contact = RegistrantContact.safeParse(owner);
  return (
    <div className="flex flex-col gap-2" data-testid="get-domain">
      <Hint>
        No domain yet? Get one here. It is registered in your name, so it is yours, and {APP_NAME}{" "}
        sets it up for the project's email and site.
      </Hint>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) look.mutate({ businessId, domain: name });
        }}
      >
        <Field htmlFor="get-domain-input" label="Name to look up">
          <Input
            id="get-domain-input"
            value={name}
            placeholder="yourproject.com"
            maxLength={80}
            onChange={(e) => (setName(e.target.value), setQuote(null))}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          icon={Search}
          disabled={!name.trim()}
          loading={look.isPending}
          data-testid="get-domain-look"
        >
          Look up
        </Button>
      </form>
      {quote ? (
        quote.available && quote.priceMinor !== null ? (
          <div className="flex flex-wrap items-center gap-3" data-testid="get-domain-quote">
            <span className="font-mono text-body-strong text-primary">{quote.domain}</span>
            <span className="text-small text-secondary">
              is available · {price(quote.priceMinor)} a year (
              <Term id="estimate" always>
                Estimate
              </Term>
              )
            </span>
            <Button
              variant="primary"
              icon={Globe}
              onClick={() => setOpen(true)}
              data-testid="get-domain-register"
            >
              Register
            </Button>
          </div>
        ) : (
          <Hint>{quote.domain} is taken. Try another name.</Hint>
        )
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="get-domain-dialog">
          <DialogHeader>
            <DialogTitle>Register {quote?.domain}</DialogTitle>
            <DialogDescription>
              You will be the domain's owner: it is registered in your name, with the details below.
              You can move it to another registrar after 60 days.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map((f) => (
                <Field
                  key={f.key}
                  htmlFor={`registrant-${f.key}`}
                  label={f.optional ? `${f.label} (optional)` : f.label}
                >
                  <Input
                    id={`registrant-${f.key}`}
                    autoComplete={f.autoComplete}
                    placeholder={f.placeholder}
                    value={owner[f.key] ?? ""}
                    onChange={(e) => setOwner((o) => ({ ...o, [f.key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            {quote?.priceMinor != null ? (
              <p className="mt-3 text-body text-primary" data-testid="get-domain-price">
                {price(quote.priceMinor)} for one year (
                <Term id="estimate" always>
                  Estimate
                </Term>
                ).
                {quote.simulated ? " Simulated here: nothing is registered or charged." : ""}
              </p>
            ) : null}
            <label
              className="mt-3 flex items-start gap-2 text-small text-secondary"
              htmlFor="registrant-agree"
            >
              <Checkbox
                id="registrant-agree"
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
              />
              <span>
                I am registering this domain for myself and accept Tucows' registration agreement:{" "}
                <a
                  className="text-link underline"
                  href={DOMAIN_REGISTRATION_AGREEMENT_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  read it
                </a>
                . I will get an email asking me to confirm my details; the domain stops working if I
                do not confirm within 15 days.
              </span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!contact.success || !accepted || !quote?.priceMinor}
              loading={register.isPending}
              onClick={() =>
                quote?.priceMinor &&
                contact.success &&
                register.mutate({
                  businessId,
                  domain: quote.domain,
                  priceMinor: quote.priceMinor,
                  owner: contact.data,
                  acceptAgreement: true,
                })
              }
              data-testid="get-domain-confirm"
            >
              Register for {quote?.priceMinor ? price(quote.priceMinor) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
