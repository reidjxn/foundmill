/**
 * Inbox preview widget (BUILD §11.2, DESIGN §9 Inbox rows): the latest rows at a glance; a row opens the item.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Inbox } from "lucide-react";
import type { DeptColourToken } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { Avatar, Button, formatRelative } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import type { InboxListResponse } from "../shared/types";

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
  useBusinessEvents(() => inbox.refetch(), ["inbox.item_created", "decision.made", "cycle.completed"]);

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
      empty={inbox.data && items.length === 0 ? { icon: Inbox, text: "Notes from your squad land here after each cycle. Press Continue to start one.", action: { label: "Open inbox", onClick: () => navigate(routes.inbox(businessId)) } } : null}
      actions={
        <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => navigate(routes.inbox(businessId))}>
          Open
        </Button>
      }
      footer={blocking > 0 ? <span className="text-status-bad">Respond · {blocking}</span> : <span>Latest {items.length}</span>}
    >
      <ul className="flex flex-col" aria-label="Latest inbox items">
        {items.map((item) => {
          const agent = item.fromAgentId ? agentMeta.get(item.fromAgentId) : undefined;
          const won = item.type === "customer_won";
          return (
            <li key={item.id} className="border-b hairline-50 last:border-b-0">
              <button
                type="button"
                onClick={() => navigate(routes.inbox(businessId, item.id))}
                data-inbox-row={item.id}
                data-type={item.type}
                className={`flex h-14 w-full items-center gap-3 px-panel-pad text-left outline-none transition-colors duration-micro ease-dugout hover:bg-white/4 focus-visible:outline-2 focus-visible:outline-link ${won ? "border-l-[3px] border-l-gold" : "border-l-[3px] border-l-transparent"}`}
                aria-label={`${item.subject}${item.blocksContinue ? ", needs an answer" : ""}${won ? ", customer won" : ""}`}
              >
                {agent ? <Avatar size={24} name={agent.name} agent={{ seed: agent.seed, dept: agent.dept }} /> : <Avatar size={24} name={item.fromUserId ? "You" : APP_NAME} />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-body-strong ${item.state === "unread" ? "text-primary" : "text-secondary"}`}>{item.subject}</span>
                  <span className="truncate text-small text-secondary">{previewLine(item.bodyMd)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-small text-secondary tabular-nums">
                  {item.blocksContinue ? <span aria-hidden className="inline-block size-1.5 rounded-full bg-status-bad" /> : null}
                  {formatRelative(item.createdAt)}
                </span>
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
  description: "The latest notes from your squad; click a row to open it.",
  icon: "inbox",
  surfaces: ["home", "department"],
  defaultSize: { w: 4, h: 12, minW: 3, minH: 8 },
  settingsSchema: InboxPreviewSettings,
  defaultSettings: InboxPreviewSettings.parse({}),
  Component: InboxPreviewWidget,
});
