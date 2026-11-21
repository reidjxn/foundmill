"use client";
import { Button } from "../foundation/Button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";

export interface BetterModelsPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The entry plan's name as the product shows it (config `planName("free")`). */
  planLabel: string;
  /** Settings › Billing. */
  onSeePlans: () => void;
  /** Settings › Keys. */
  onConnectKey: () => void;
}

/**
 * What a free founder reads on choosing Opus or Sonnet (WP-13 T7): Claude models come with a paid plan, or with their own
 * Anthropic key. An offer, never a wall: "Not now" leaves the choice as it was.
 */
export function BetterModelsPrompt({ open, onOpenChange, planLabel, onSeePlans, onConnectKey }: BetterModelsPromptProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="better-models-prompt">
        <DialogHeader>
          <DialogTitle>Better models come with a plan</DialogTitle>
          <DialogDescription>On the {planLabel} plan your team runs on GLM-5.3 Flash. Claude models come with a paid plan, or you can connect your own Anthropic key and pay Anthropic directly.</DialogDescription>
        </DialogHeader>
       
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button variant="secondary" onClick={onConnectKey} data-testid="better-models-key">
            Connect your Anthropic key
          </Button>
          <Button variant="primary" onClick={onSeePlans} data-testid="better-models-plans">
            See plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
