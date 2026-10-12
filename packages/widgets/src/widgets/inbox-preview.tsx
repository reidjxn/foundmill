"use client";
/**
 * Inbox preview widget (BUILD §11.2, DESIGN §9 Inbox rows): the latest rows at a glance; a row opens the item.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Inbox } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { Avatar, Button, Chip, cn, formatRelative } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import { NOTE_TAG_ICONS, noteRowTag } from "../shared/note-tags";
import type { FounderProfileResponse, InboxListResponse } from "../shared/types";

export const InboxPreviewSettings = z.object({
  rows: z.number().int().min(2).max(10).default(4),
  /** Only items that need an answer. */
  requiredOnly: z.boolean().default(false),
});
export type InboxPreviewSettings = z.infer<typeof InboxPreviewSettings>;

/** First sentence of the note as the preview line (markup stripped). */
export function previewLine(bodyMd: string): string {
  const plain = bodyMd
    .replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = plain.search(/[.!?](\s|$)/);
  return end > 0 ? plain.slice(0, end + 1) : plain.slice(0, 120);
}

function InboxPreviewWidget({ settings }: WidgetProps<InboxPreviewSettings>) {
  const { businessId, navigate } = useWidgetData();
  const inbox = useWidgetQuery<InboxListResponse>("inbox.list", { tab: "all", state: ["unread", "read"], limit: settings.rows, ...(settings.requiredOnly ? { blocking: true } : {}) });
  const departments = useDepartments();
  // The founder's own notes carry the founder's initials, as in the Inbox list.
  const founder = useWidgetQuery<FounderProfileResponse>("founder.profile.get", undefined);
  const founderName = founder.data?.profile?.displayName?.trim() || undefined;
  // An item archived or a plan confirmed by another member (`inbox.item_updated`) leaves or changes the list too.
  useBusinessEvents(() => inbox.refetch(), ["inbox.item_created", "inbox.item_updated", "decision.made", "cycle.completed"]);

  const agentMeta = useMemo(() => {
    const map = new Map<string, { name: string; seed: string; dept: DeptColourToken }>();
    for (const d of departments.data ?? []) for (const a of d.squad) if (!map.has(a.id)) map.set(a.id, { name: a.name, seed: a.avatarSeed || a.id, dept: d.colourToken });
    return map;
  }, [departments.data]);

  const items = inbox.data?.items ?? [];
  const blocking = inbox.data?.blocking ?? 0;
  return (
    <WidgetFrame
      title="Inbox"
      data-widget="inbox_preview"
      queries={[inbox]}
      flush
      empty={inbox.data && items.length === 0 ? { icon: Inbox, text: "Notes from your team land here after each cycle. Press Continue to start one.", action: { label: "Open inbox", onClick: () => navigate(routes.inbox(businessId)) } } : null}
      actions={
        <Button size="sm" variant="ghost" className="px-1.5" onClick={() => navigate(routes.inbox(businessId))}>
          Open
        </Button>
      }
      footer={blocking > 0 ? <span className="text-status-bad">{blocking === 1 ? "1 note needs you" : `${blocking} notes need you`}</span> : <span>Latest {items.length}</span>}
    >
      {/* Rows never clip (DESIGN §9 Inbox rows): the subject wraps to two lines, the preview is one line that may end in
          an ellipsis (a list convention), and the state is a word with an icon, never a dot alone. */}
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="Latest inbox items">
        {items.map((item) => {
          const agent = item.fromAgentId ? agentMeta.get(item.fromAgentId) : undefined;
          const won = item.type === "customer_won";
          const tag = noteRowTag(item);
          return (
            <li key={item.id} className="border-b border-line-faint last:border-b-0">
              <button
                type="button"
                onClick={() => navigate(routes.inbox(businessId, item.id))}
                data-inbox-row={item.id}
                data-type={item.type}
                className={cn(
                  "flex w-full items-start gap-3 px-panel-pad py-2.5 text-left outline-none transition-colors duration-hover ease-out hover:bg-white/4 focus-visible:shadow-ring",
                  won && "row-edge-gold",
                )}
                aria-label={`${item.subject}${item.blocksContinue ? ", needs an answer" : ""}${won ? ", customer won" : ""}`}
              >
                {agent ? <Avatar size={24} name={agent.name} agent={{ seed: agent.seed, dept: agent.dept }} /> : <Avatar size={24} name={item.fromUserId ? (founderName ?? "You") : APP_NAME} />}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={cn("line-clamp-2 break-words text-body-strong", item.state === "unread" ? "text-primary" : "text-secondary")}>{item.subject}</span>
                  {/* The same tag as the Inbox list (icon + word, one vocabulary), then the one-line preview. */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Chip tone={tag.tone} icon={NOTE_TAG_ICONS[tag.icon]} className="h-badge shrink-0" data-row-tag={tag.word}>
                      {tag.word}
                    </Chip>
                    <span className="line-clamp-1 min-w-0 flex-1 break-all text-small text-secondary">{previewLine(item.bodyMd)}</span>
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 font-mono text-mono whitespace-nowrap text-tertiary">{formatRelative(item.createdAt, new Date(), { style: "short" })}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </WidgetFrame>
  );
}

export const inboxPreviewWidget = registerWidget<InboxPreviewSettings>({
  key: "inbox_preview",
  title: "Inbox preview",
  description: "The latest notes from your team; click a row to open it.",
  icon: "inbox",
  surfaces: ["home", "department"],
  // Sized to its rows: a stored taller cell (the seeded Founder's view keeps h 32) is clamped instead of drawn empty.
  defaultSize: { w: 4, h: 12, minW: 3, minH: 8, maxH: 16 },
  settingsSchema: InboxPreviewSettings,
  defaultSettings: InboxPreviewSettings.parse({}),
  Component: InboxPreviewWidget,
});
