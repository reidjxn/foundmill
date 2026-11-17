"use client";
/**
 * Product › Site › "Pay buttons" (WP-07 T7; apps/api routers/pay-link.ts): loads the project's payment links and runs
 * add and remove; the look is Dugout's `PayLinkList`. An owner or an admin adds and removes links; everyone else sees
 * the list. A simulated link (made by a mock connector) is listed as such and never reaches the site.
 */
import { useState } from "react";
import { PAY_LINK_WORDS, PayLinkList } from "@foundmill/dugout";
import { PAY_LINK_LABEL_MAX, PAY_LINK_URL_MAX } from "@foundmill/shared/pay-links";
import { useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import { errorMessage } from "./shared";

export { PAY_LINK_WORDS };

/** `payLink.list` as the panel reads it (apps/api `PayLinkView`). */
export interface PayLinkViewResponse {
  id: string;
  key: string;
  label: string;
  priceMinor: number | null;
  currency: string | null;
  url: string;
  source: "pasted" | "stripe";
  simulated: boolean;
  createdAt: string | Date;
}

export function PayLinksPanel({ canEdit }: { canEdit: boolean }) {
  const { mutate } = useWidgetData();
  const links = useWidgetQuery<PayLinkViewResponse[]>("payLink.list", {});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      await links.refetch();
    } catch (err) {
      setError(errorMessage(err as Error));
      throw err;
    } finally {
      setPending(false);
    }
  };

  return (
    <PayLinkList
      items={links.data ?? []}
      canEdit={canEdit}
      pending={pending}
      error={error}
      loading={links.isLoading}
      loadError={links.error ? links.error.message : undefined}
      onRetry={links.refetch}
      labelMax={PAY_LINK_LABEL_MAX}
      urlMax={PAY_LINK_URL_MAX}
      onAdd={(input) => run(() => mutate("payLink.add", input))}
      onRemove={(id) => void run(() => mutate("payLink.archive", { id })).catch(() => {})}
    />
  );
}
