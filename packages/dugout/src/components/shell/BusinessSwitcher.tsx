"use client";
/**
 * Switch business (founder, 2026-10-16; audit IAE-08, WEB-13): the top bar's logo and name open a glass popover headed
 * "Switch business" with every business the founder belongs to (the current one first and checked, then A to Z, each
 * with its 24 px logo and a role and Demo chip), a filter field once there are more than a handful, then Create a new
 * business, Manage businesses, Home and Your profile. A popover with a filterable list (cmdk, as the command palette),
 * not a menu: a menu's typeahead fights a filter field. The tooltip and the controlled open follow StopAllAgents, since
 * Tooltip and Popover triggers both write `data-state`.
 */
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { Building2, Check, ChevronDown, House, Plus, UserRound } from "lucide-react";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { INPUT_HEIGHT, inputBaseClass } from "../foundation/Input";
import { menuLabelClass, menuSeparatorClass } from "../foundation/menuStyles";
import { Popover, PopoverAnchor, PopoverContent } from "../foundation/Popover";
import { Skeleton } from "../foundation/Skeleton";
import { Spinner } from "../foundation/Spinner";
import { Tooltip } from "../foundation/Tooltip";

/** One business in the switcher. */
export interface SwitcherBusiness {
  id: string;
  name: string;
  /** The business open now: listed first, with a check. */
  current?: boolean;
  /** The logo as a data URL; absent or null draws the initials mark. */
  logoSrc?: string | null;
  /** Brand primary (hex) for the initials mark. */
  primary?: string;
  /** Shown as a chip when set (not for owners): "Admin", "Member", "Viewer", "Advisor". */
  roleLabel?: string | null;
  /** A demo business: a "Demo" chip. */
  demo?: boolean;
}

/** What the top bar's business switcher lists and does. */
export interface KitBarBusinessMenu {
  businesses: readonly SwitcherBusiness[];
  onOpenBusiness: (id: string) => void;
  onNewBusiness?: () => void;
  onManageBusinesses?: () => void;
  onProfile?: () => void;
  /** Pointer over, focus on or opening the switcher: the host starts loading the list and logos. */
  onIntent?: () => void;
  /** The list is loading (the current business still shows). */
  loading?: boolean;
  /** The list did not load: what to say. */
  error?: string | null;
  onRetry?: () => void;
  /** The business being opened after a pick: the trigger is busy until the new business replaces the page. */
  pendingBusinessId?: string | null;
}

/** The filter field appears once there are this many businesses. */
export const SWITCHER_FILTER_FROM = 6;

const collator = new Intl.Collator("en-US", { sensitivity: "base", numeric: true });

/** The current business first, then A to Z (case and accents ignored); stable. */
export function orderSwitcherBusinesses<T extends Pick<SwitcherBusiness, "name" | "current">>(list: readonly T[]): T[] {
  return list
    .map((b, i) => ({ b, i }))
    .sort((x, y) => Number(Boolean(y.b.current)) - Number(Boolean(x.b.current)) || collator.compare(x.b.name, y.b.name) || x.i - y.i)
    .map(({ b }) => b);
}

/** Businesses matching `query`, case-insensitive: name prefix, then a word's prefix, then anywhere. Empty: all. */
export function filterSwitcherBusinesses<T extends Pick<SwitcherBusiness, "name">>(list: readonly T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase("en-US");
  if (!q) return [...list];
  const rank = (name: string): number => {
    const n = name.toLocaleLowerCase("en-US");
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s\-_.&/]+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return list
    .map((b, i) => ({ b, i, r: rank(b.name) }))
    .filter((x) => x.r >= 0)
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map(({ b }) => b);
}

const ROW_CLASS = "palette-row group/item flex min-h-row-comfortable cursor-default select-none items-center gap-2.5 px-2.5 py-1.5 text-body text-primary outline-none";

export interface BusinessSwitcherProps {
  businessName: string;
  menu: KitBarBusinessMenu;
  /** Picking the current business, or Home. */
  onHome?: () => void;
  /** Open on first render (stories). */
  defaultOpen?: boolean;
  /** The trigger's content: the logo and the name. */
  children: ReactNode;
}

/** The top bar's logo and name as the business switcher (a chevron after the name, the tooltip "Switch business"). */
export function BusinessSwitcher({ businessName, menu, onHome, defaultOpen = false, children }: BusinessSwitcherProps) {
  const [open, setOpenState] = useState(defaultOpen);
  const [tip, setTip] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const dialogId = useId();

  const setOpen = (next: boolean) => {
    if (next) menu.onIntent?.();
    else setQuery("");
    setOpenState(next);
  };
  const showFilter = menu.businesses.length >= SWITCHER_FILTER_FROM;
  const rows = useMemo(() => filterSwitcherBusinesses(orderSwitcherBusinesses(menu.businesses), showFilter ? query : ""), [menu.businesses, query, showFilter]);
  const pending = menu.pendingBusinessId ? (menu.businesses.find((b) => b.id === menu.pendingBusinessId) ?? null) : null;

  const pick = (fn: (() => void) | undefined) => {
    setOpen(false);
    fn?.();
  };
  const pickBusiness = (b: SwitcherBusiness) => pick(b.current ? onHome : () => menu.onOpenBusiness(b.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span className="flex min-w-0">
          <Tooltip content="Switch business" side="bottom" align="start" open={tip && !open} onOpenChange={setTip}>
            <button
              ref={triggerRef}
              type="button"
              data-testid="kitbar-business-menu"
              aria-label={`Switch business: ${businessName}`}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? dialogId : undefined}
              aria-busy={pending ? true : undefined}
              onClick={() => setOpen(!open)}
              onPointerEnter={menu.onIntent}
              onFocus={menu.onIntent}
              className={cn("-mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-black/20 hover:no-underline focus-visible:shadow-ring", open && "bg-black/20")}
            >
              {children}
              {pending ? (
                <Spinner size="inline" decorative className="shrink-0" />
              ) : (
                <Icon icon={ChevronDown} size="inline" className={cn("shrink-0 opacity-80 transition-transform duration-overlay ease-out", open && "rotate-180")} />
              )}
            </button>
          </Tooltip>
          {pending ? (
            <span className="sr-only" role="status">
              Opening {pending.name}…
            </span>
          ) : null}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        id={dialogId}
        className="w-80 p-1.5"
        aria-labelledby={headingId}
        data-testid="business-switcher"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (inputRef.current ?? rootRef.current)?.focus();
        }}
        onInteractOutside={(e) => {
          // A click on the trigger toggles it itself: closing here first would reopen it at once.
          if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <Command ref={rootRef} tabIndex={-1} label="Find a business" shouldFilter={false} loop className="flex flex-col outline-none">
          <h2 id={headingId} className={menuLabelClass}>
            Switch business
          </h2>
          {/* cmdk names its field after the root's `label`: "Find a business". */}
          {showFilter ? (
            <Command.Input ref={inputRef} value={query} onValueChange={setQuery} placeholder="Find a business…" className={cn(inputBaseClass, INPUT_HEIGHT.md, "mx-1 mb-1 w-auto px-2.5")} />
          ) : null}
          <Command.List label="Your businesses" className="max-h-96 overflow-y-auto">
            {rows.map((b) => (
              <Command.Item key={b.id} value={`business:${b.id}`} onSelect={() => pickBusiness(b)} data-business-id={b.id} data-current={b.current || undefined} className={ROW_CLASS}>
                <BusinessLogo src={b.logoSrc} name={b.name} primary={b.primary ?? "#1b4fd8"} size={24} title="" />
                <span className="line-clamp-2 min-w-0 flex-1 break-words">{b.name}</span>
                {b.demo ? <Chip>Demo</Chip> : null}
                {b.roleLabel ? <Chip>{b.roleLabel}</Chip> : null}
                {b.current ? (
                  <>
                    <Icon icon={Check} size="inline" className="shrink-0 text-accent" aria-hidden />
                    <span className="sr-only">Current business</span>
                  </>
                ) : null}
              </Command.Item>
            ))}
            {menu.loading ? (
              <div aria-busy className="flex flex-col gap-2 p-2">
                <span className="sr-only">Loading your businesses</span>
                <Skeleton className="w-2/3" />
                <Skeleton className="w-1/2" />
              </div>
            ) : null}
            {menu.error ? (
              <div role="status" className="flex items-center gap-2 px-2.5 py-1.5 text-small text-secondary">
                <span className="min-w-0 flex-1">{menu.error}</span>
                {menu.onRetry ? (
                  <Button size="sm" variant="ghost" onClick={menu.onRetry}>
                    Try again
                  </Button>
                ) : null}
              </div>
            ) : null}
            {showFilter && query.trim() && rows.length === 0 ? (
              <p role="status" className="px-2.5 py-2 text-small text-secondary">
                No business found for “{query.trim()}”.
              </p>
            ) : null}
            {menu.onNewBusiness || menu.onManageBusinesses ? <div className={menuSeparatorClass} role="separator" /> : null}
            {menu.onNewBusiness ? (
              <Command.Item value="action:new" onSelect={() => pick(menu.onNewBusiness)} data-testid="switcher-new-business" className={ROW_CLASS}>
                <Icon icon={Plus} size="inline" className="shrink-0" /> Create a new business
              </Command.Item>
            ) : null}
            {menu.onManageBusinesses ? (
              <Command.Item value="action:manage" onSelect={() => pick(menu.onManageBusinesses)} data-testid="switcher-manage-businesses" className={ROW_CLASS}>
                <Icon icon={Building2} size="inline" className="shrink-0" /> Manage businesses
              </Command.Item>
            ) : null}
            {onHome || menu.onProfile ? <div className={menuSeparatorClass} role="separator" /> : null}
            {onHome ? (
              <Command.Item value="action:home" onSelect={() => pick(onHome)} className={ROW_CLASS}>
                <Icon icon={House} size="inline" className="shrink-0" /> Home
              </Command.Item>
            ) : null}
            {menu.onProfile ? (
              <Command.Item value="action:profile" onSelect={() => pick(menu.onProfile)} className={ROW_CLASS}>
                <Icon icon={UserRound} size="inline" className="shrink-0" /> Your profile
              </Command.Item>
            ) : null}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
