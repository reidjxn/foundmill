"use client";
/** Small building blocks shared by the settings tabs. */
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Panel, StatusPill, useToast, type GridSpan, type PanelProps } from "@foundmill/dugout";
import { errorMessage } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";

export function SettingsSection({ title, children, span = 12, ...rest }: { title: ReactNode; children: ReactNode; span?: GridSpan } & Omit<PanelProps, "title" | "span" | "children">) {
  return (
    <Panel title={title} span={span} {...rest}>
      <div className="flex max-w-[640px] flex-col gap-4">{children}</div>
    </Panel>
  );
}

export function FormRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function SaveBar({ onSave, saving, disabled, label = "Save changes", children }: { onSave: () => void; saving?: boolean; disabled?: boolean; label?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-subtle pt-3">
      {children}
      <Button variant="primary" onClick={onSave} loading={saving} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

/** Admin-only notice for viewers/members (the API refuses the mutation too). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, data } = useBusiness();
  if (isAdmin) return <>{children}</>;
  return (
    <div className="flex flex-col gap-3">
      <StatusPill tone="neutral" icon={Lock}>
        Read only
      </StatusPill>
      <p className="text-body text-secondary">Your role ({data.role}) can read these settings; an owner or admin changes them.</p>
      <div className="pointer-events-none opacity-60" aria-disabled>
        {children}
      </div>
    </div>
  );
}

export function useSettingsToast() {
  const { toast } = useToast();
  return {
    saved: (title = "Saved", description?: string) => toast({ title, description, tone: "good" }),
    failed: (err: unknown, title = "Not saved") => toast({ title, description: errorMessage(err), tone: "bad" }),
    info: (title: string, description?: string) => toast({ title, description, tone: "info" }),
  };
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-small text-secondary">{children}</p>;
}
