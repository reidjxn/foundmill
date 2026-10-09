"use client";
import { useState } from "react";
import { Camera, Globe, MonitorPlay } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatRelative } from "../../lib/format";
import { Button } from "../foundation/Button";
import { EmptyState } from "../foundation/EmptyState";
import type { PreviewState } from "./types";

export interface PreviewViewProps {
  preview: PreviewState;
  /** Agent name for the frame title. */
  agentName: string;
  now?: Date;
  className?: string;
}

/** Preview body: the branch's preview deployment in a sandboxed iframe, or the latest Playwright screenshot. */
export function PreviewView({ preview, agentName, now = new Date(), className }: PreviewViewProps) {
  const hasUrl = !!preview.url;
  const hasShot = !!preview.screenshotUrl;
  const [mode, setMode] = useState<"live" | "screenshot">(hasUrl ? "live" : "screenshot");
  const showLive = mode === "live" && hasUrl;
  if (!hasUrl && !hasShot) {
    return (
      <div className={cn("flex h-full items-center justify-center bg-base", className)}>
        <EmptyState icon={MonitorPlay}>A preview appears after the first successful build; screenshots arrive with each Playwright run.</EmptyState>
      </div>
    );
  }
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-base", className)} data-preview-mode={showLive ? "live" : "screenshot"}>
      {hasUrl && hasShot ? (
        <div role="radiogroup" aria-label="Preview source" className="flex h-panel-header shrink-0 items-center gap-1 bg-surface-1 px-2.5 rule-fade">
          <Button size="sm" variant={showLive ? "default" : "ghost"} icon={Globe} role="radio" aria-checked={showLive} onClick={() => setMode("live")} className="px-1.5">
            Live
          </Button>
          <Button size="sm" variant={!showLive ? "default" : "ghost"} icon={Camera} role="radio" aria-checked={!showLive} onClick={() => setMode("screenshot")} className="px-1.5">
            Screenshot
          </Button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {showLive ? (
          <iframe title={`Preview for ${agentName}`} src={preview.url ?? undefined} sandbox="allow-scripts allow-forms allow-same-origin allow-popups" className="size-full border-0 bg-white" />
        ) : (
          <figure className="m-0 flex h-full flex-col">
            <img src={preview.screenshotUrl ?? undefined} alt={`Latest screenshot from ${agentName}`} className="max-w-full object-contain" />
            <figcaption className="mt-auto flex h-control-sm items-center gap-1.5 px-2.5 text-small text-tertiary">
              Captured {preview.capturedAt ? formatRelative(preview.capturedAt, now) : "recently"}
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
