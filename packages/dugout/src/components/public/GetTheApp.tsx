/**
 * "Get the app" (WP-03 T9; CLAUDE.md "Never", small screens): up to two links to the native app's store pages. It
 * renders nothing while `links` is null, which it is until the app launches (`NEXT_PUBLIC_STORE_LINKS` unset,
 * `parseStoreLinks` in @foundmill/config), so setting or unsetting that one value adds or removes every prompt. Every
 * link is at least 44 px tall (`min-h-tap`). Presentational and server-safe.
 */
import { Smartphone } from "lucide-react";
import type { StoreLinks } from "@foundmill/config/app-links";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export const GET_THE_APP_WORDS = {
  ios: "Get the app for iPhone",
  android: "Get the app for Android",
} as const;

export interface GetTheAppProps {
  /** The parsed store links (`publicEnv().storeLinks` on the web); null renders nothing. */
  links: StoreLinks | null;
  className?: string;
}

const linkClass = "btn-secondary t-action inline-flex min-h-tap items-center justify-center gap-2 rounded-sm px-btn-md text-primary focus-ring";

export function GetTheApp({ links, className }: GetTheAppProps) {
  if (!links || (!links.ios && !links.android)) return null;
  const items = (["ios", "android"] as const).flatMap((store) => {
    const href = links[store];
    return href ? [{ store, href }] : [];
  });
  return (
    <div data-get-the-app="" className={cn("flex min-w-0 flex-col gap-2 @page-wide:flex-row @page-wide:flex-wrap", className)}>
      {items.map(({ store, href }) => (
        <a key={store} href={href} rel="noopener" className={linkClass} data-store={store}>
          <Icon icon={Smartphone} size={16} />
          {GET_THE_APP_WORDS[store]}
        </a>
      ))}
    </div>
  );
}
