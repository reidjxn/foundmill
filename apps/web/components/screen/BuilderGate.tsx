"use client";
/**
 * The gated state of a Builder view screen opened by URL (a bookmark, a shared link) while the switch is off
 * (docs/DESIGN.md "Builder view"): it still opens, says what it is, and offers both ways on: "Turn on Builder view"
 * (saved inline, for every business) and "Open {the first tab the person sees}". Until the account's answer arrives it
 * is a skeleton, so the gate never flashes for someone who has Builder view on.
 */
import { ArrowRight, Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Panel, useToast } from "@foundmill/dugout";
import { errorMessage } from "@/lib/trpc";
import { builderViewSavedLine, useBuilderViewPreference } from "@/components/providers/guidance-context";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

/** The gated state's words. */
export const BUILDER_GATE_COPY = {
  title: "This is part of Builder view",
  body: "It shows how the team's work runs underneath. Turn on Builder view to see it, here and in every business.",
  turnOn: "Turn on Builder view",
} as const;

export interface BuilderGateProps {
  /** The panel's title (the department's or the agent's name). */
  title: string;
  /** Where "Open …" goes: the first tab the person sees. Omitted: only "Turn on Builder view". */
  open?: { label: string; href: string } | null;
}

export function BuilderGate({ title, open }: BuilderGateProps) {
  const router = useRouter();
  const { toast } = useToast();
  const builderView = useBuilderViewPreference();
  if (!builderView.loaded) return <ScreenSkeleton />;
  const turnOn = () =>
    void builderView.setOn(true).then(
      () => toast(builderViewSavedLine(true)),
      (err: unknown) => toast({ title: "Builder view not turned on", description: errorMessage(err), tone: "bad" }),
    );
  return (
    <div className="p-gutter">
      <Panel title={title} span={12}>
        <EmptyState
          icon={Eye}
          title={BUILDER_GATE_COPY.title}
          data-testid="builder-gate"
          action={{ label: BUILDER_GATE_COPY.turnOn, icon: Eye, variant: "primary", onClick: turnOn }}
          actions={
            open ? (
              <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => router.push(open.href)} data-testid="builder-gate-open">
                {`Open ${open.label}`}
              </Button>
            ) : undefined
          }
        >
          {BUILDER_GATE_COPY.body}
        </EmptyState>
      </Panel>
    </div>
  );
}
