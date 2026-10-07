"use client";
import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Bot,
  Building2,
  Globe,
  ListPlus,
  MapPin,
  MessageSquare,
  UserCog,
  UserRound,
  Users,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import type { EntityKind } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../foundation/ContextMenu";
import { Crest } from "../foundation/Crest";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../foundation/HoverCard";
import { Icon } from "../foundation/Icon";
import type { EntityDetails, EntityRef, EntityVerb } from "./types";

/** Kind → Lucide icon (DESIGN §5: a person, an organisation and an agent read differently at a glance). */
export const ENTITY_KIND_ICONS: Record<EntityKind, LucideIcon> = {
  person: UserRound,
  organisation: Building2,
  agent: Bot,
  team_member: UserCog,
  platform_member: Globe,
  community: Users,
  venue: MapPin,
};

export const ENTITY_KIND_LABELS: Record<EntityKind, string> = {
  person: "Person",
  organisation: "Organisation",
  agent: "Agent",
  team_member: "Team member",
  platform_member: "Member",
  community: "Community",
  venue: "Venue",
};

export const ENTITY_VERBS: readonly { verb: EntityVerb; label: string; icon: LucideIcon }[] = [
  { verb: "message", label: "Message", icon: MessageSquare },
  { verb: "assign_agent", label: "Assign agent", icon: Bot },
  { verb: "add_to_list", label: "Add to list", icon: ListPlus },
  { verb: "open_profile", label: "Open profile", icon: ExternalLink },
];

export function entityKindIcon(kind: EntityKind | undefined): LucideIcon {
  return kind ? ENTITY_KIND_ICONS[kind] : UserRound;
}

// ---------------------------------------------------------------------------------------------------------------------
// Context: how links resolve details and where clicks go, so EntityText and Markdown work without prop threading.
// ---------------------------------------------------------------------------------------------------------------------

export interface EntityLinkContextValue {
  /** Details for the hover card; return undefined when unknown (the card then shows the name only). */
  resolve?: (id: string) => EntityDetails | undefined;
  /** Default href when a node carries none (BUILD §6.2: /b/{bid}/crm/{entityId}/overview). */
  hrefFor?: (entity: EntityRef) => string | undefined;
  /** Left click. Default: follow href. */
  onOpen?: (entity: EntityRef, event: MouseEvent) => void;
  /** Right-click verbs. */
  onVerb?: (verb: EntityVerb, entity: EntityRef) => void;
  /** Verbs offered by default. */
  verbs?: EntityVerb[];
}

const EntityLinkContext = createContext<EntityLinkContextValue>({});

export function EntityLinkProvider({
  value,
  children,
}: {
  value: EntityLinkContextValue;
  children: ReactNode;
}) {
  return <EntityLinkContext.Provider value={value}>{children}</EntityLinkContext.Provider>;
}

export function useEntityLinkContext(): EntityLinkContextValue {
  return useContext(EntityLinkContext);
}

// ---------------------------------------------------------------------------------------------------------------------
// Hover card body
// ---------------------------------------------------------------------------------------------------------------------

function Portrait({ details }: { details: EntityDetails }) {
  const p = details.portrait;
  if (p?.type === "crest")
    return (
      <Crest
        seed={p.seed}
        kitPrimary={p.kitPrimary}
        kitSecondary={p.kitSecondary}
        monogram={p.monogram}
        size={48}
        title={details.name}
      />
    );
  if (p?.type === "agent")
    return (
      <Avatar
        size={48}
        name={details.name}
        agent={{ seed: p.seed, dept: p.dept }}
        status={p.status}
      />
    );
  return <Avatar size={48} name={details.name} src={p?.type === "person" ? p.src : undefined} />;
}

export interface EntityCardProps {
  details: EntityDetails;
  onOpen?: (entity: EntityRef, event: MouseEvent) => void;
  className?: string;
}

/** The 320 px card: avatar/crest, name, kind/role chips, three facts, actions (DESIGN §8). Also usable inline. */
export function EntityCard({ details, onOpen, className }: EntityCardProps) {
  const KindIcon = ENTITY_KIND_ICONS[details.kind];
  const facts = (details.facts ?? []).slice(0, 3);
  return (
    <div className={cn("flex flex-col gap-2", className)} data-entity-card={details.id}>
      <div className="flex items-start gap-3">
        <Portrait details={details} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon icon={KindIcon} size="inline" className="text-secondary" />
            {details.href || onOpen ? (
              <a
                href={details.href ?? "#"}
                onClick={(e) => {
                  if (onOpen) {
                    e.preventDefault();
                    onOpen(details, e);
                  }
                }}
                className="t-display-sm truncate text-primary hover:text-link"
              >
                {details.name}
              </a>
            ) : (
              <span className="t-display-sm truncate text-primary">{details.name}</span>
            )}
          </div>
          {details.subtitle ? (
            <p className="truncate text-small text-secondary">{details.subtitle}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-1">
            <Chip tone="neutral">{ENTITY_KIND_LABELS[details.kind]}</Chip>
            {(details.chips ?? []).map((c) => (
              <Chip key={c.label} tone={c.tone ?? "neutral"} icon={c.icon}>
                {c.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      {facts.length > 0 ? (
        <dl className="grid grid-cols-3 gap-2 border-t border-subtle pt-2">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="t-label truncate">{f.label}</dt>
              <dd className="truncate text-body text-primary tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {details.actions && details.actions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-subtle pt-2">
          {details.actions.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant={
                a.variant === "primary" ? "primary" : a.variant === "danger" ? "danger" : "default"
              }
              icon={a.icon}
              onClick={() => a.onSelect(details)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// EntityLink
// ---------------------------------------------------------------------------------------------------------------------

export interface EntityLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "onClick" | "children" | "contextMenu"
> {
  entity: EntityRef;
  /** Hover card content. Falls back to the provider's `resolve(id)`, then to the bare name. */
  details?: EntityDetails;
  /** Text shown instead of the entity name (the display text from markup). */
  display?: ReactNode;
  onOpen?: (entity: EntityRef, event: MouseEvent) => void;
  onVerb?: (verb: EntityVerb, entity: EntityRef) => void;
  /** Turn the hover card off (dense tables where the row already is the profile). */
  hoverCard?: boolean;
  /** Turn the right-click menu off. */
  contextMenu?: boolean;
  /** Hide the 14 px kind icon. */
  hideIcon?: boolean;
  /** Mark the link as unverified (dashed underline, title). */
  unverified?: boolean;
}

/**
 * Inline entity mention (DESIGN §8): 14 px kind icon, accent-link, no underline at rest, hover card after 300 ms with
 * avatar/crest, name, chips, three facts and actions; click → `onOpen`; right-click → Message / Assign agent /
 * Add to list / Open profile. Keyboard: Tab focuses the link, Enter opens, Shift+F10 or the Menu key opens the verbs.
 */
export const EntityLink = forwardRef<HTMLAnchorElement, EntityLinkProps>(function EntityLink(
  {
    entity,
    details,
    display,
    onOpen,
    onVerb,
    hoverCard = true,
    contextMenu = true,
    hideIcon,
    unverified,
    className,
    ...rest
  },
  ref,
) {
  const ctx = useEntityLinkContext();
  const resolved = details ?? ctx.resolve?.(entity.id);
  const kind = entity.kind ?? resolved?.kind;
  const name = entity.name || resolved?.name || String(display ?? "");
  const href =
    entity.href ?? resolved?.href ?? ctx.hrefFor?.({ ...entity, kind, name }) ?? undefined;
  const ref0: EntityRef = useMemo(
    () => ({ id: entity.id, kind, name, ...(href ? { href } : {}) }),
    [entity.id, kind, name, href],
  );
  const open = onOpen ?? ctx.onOpen;
  const verbHandler = onVerb ?? ctx.onVerb;
  const verbs = resolved?.verbs ?? ctx.verbs ?? ENTITY_VERBS.map((v) => v.verb);
  const KindIcon = entityKindIcon(kind);

  const anchor = (
    <a
      ref={ref}
      href={href ?? "#"}
      data-entity-id={entity.id}
      data-entity-kind={kind}
      data-unverified={unverified || undefined}
      onClick={(e) => {
        if (open) {
          e.preventDefault();
          open(ref0, e);
        } else if (!href) {
          e.preventDefault();
        }
      }}
      title={unverified ? `${name} (unverified)` : undefined}
      className={cn(
        "inline-flex max-w-full items-baseline gap-1 rounded-chip text-link no-underline hover:underline focus-visible:outline-2",
        unverified && "underline decoration-dashed decoration-secondary/70 underline-offset-2",
        className,
      )}
      {...rest}
    >
      {hideIcon ? null : (
        <Icon icon={KindIcon} size="inline" className="relative top-0.5 self-center" />
      )}
      <span className="truncate">{display ?? name}</span>
    </a>
  );

  const hasMenu = contextMenu && !!verbHandler;
  const items = hasMenu ? ENTITY_VERBS.filter((v) => verbs.includes(v.verb)) : [];
  // Both triggers are Slots, so they merge their handlers into the one anchor element.
  const trigger = hasMenu ? <ContextMenuTrigger asChild>{anchor}</ContextMenuTrigger> : anchor;

  const withCard = hoverCard ? (
    <HoverCard>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent className="w-80">
        {resolved ? (
          <EntityCard details={{ ...resolved, href: resolved.href ?? href }} onOpen={open} />
        ) : (
          <EntityCard
            details={{ id: entity.id, kind: kind ?? "person", name, ...(href ? { href } : {}) }}
            onOpen={open}
          />
        )}
      </HoverCardContent>
    </HoverCard>
  ) : (
    trigger
  );

  if (!hasMenu) return withCard;
  return (
    <ContextMenu>
      {withCard}
      <ContextMenuContent aria-label={`${name} actions`}>
        {items.map((v, i) => (
          <span key={v.verb} className="contents">
            {v.verb === "open_profile" && i > 0 ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => verbHandler?.(v.verb, ref0)}>
              <Icon icon={v.icon} size="inline" className="text-secondary" />
              {v.label}
            </ContextMenuItem>
          </span>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
});
