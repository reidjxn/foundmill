"use client";
/** Small building blocks shared by the settings tabs. */
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Panel, StatusPill, useToast, type GridSpan, type PanelProps } from "@foundmill/dugout";
import { errorMessage } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";

/** A settings panel. Forms keep the 640 px reading measure; lists and tables (`wide`) use the panel's full width. */
export function SettingsSection({ title, children, span = 12, wide, ...rest }: { title: ReactNode; children: ReactNode; span?: GridSpan; wide?: boolean } & Omit<PanelProps, "title" | "span" | "children">) {
  return (
    <Panel title={title} span={span} {...rest}>
      <div className={wide ? "flex flex-col gap-4" : "flex max-w-reading flex-col gap-4"}>{children}</div>
    </Panel>
  );
}

export function FormRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

/**
 * The Save row. Nothing to save turns the button off with aria-disabled rather than `disabled`: a save that succeeds
 * leaves the form clean while the button still has keyboard focus, and a disabled button would drop it to <body>.
 */
export function SaveBar({ onSave, saving, disabled, label = "Save changes", children }: { onSave: () => void; saving?: boolean; disabled?: boolean; label?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
      {children}
      <Button variant="primary" onClick={disabled ? undefined : onSave} loading={saving} aria-disabled={disabled || undefined} data-save-bar>
        {label}
      </Button>
    </div>
  );
}

/** Admin-only notice for viewers/members (the API refuses the mutation too). */
const ARTICLE: Record<string, string> = { owner: "an", admin: "an", advisor: "an", member: "a", viewer: "a" };

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin, data } = useBusiness();
  if (isAdmin) return <>{children}</>;
  return (
    <div className="flex flex-col gap-3">
      <StatusPill tone="neutral" icon={Lock}>
        Read only
      </StatusPill>
      <p className="text-body text-secondary">As {ARTICLE[data.role] ?? "a"} {(data.role ?? "member").toLowerCase()} you can read these settings; an owner or admin changes them.</p>
      {/* A disabled fieldset disables every control inside it for the keyboard as well as the pointer (a pointer-events
          rule alone left Tab and Enter working, audit RUI-05), and the values stay readable. */}
      <fieldset disabled className="m-0 min-w-0 border-0 p-0 opacity-60" data-testid="read-only-settings">
        {children}
      </fieldset>
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
