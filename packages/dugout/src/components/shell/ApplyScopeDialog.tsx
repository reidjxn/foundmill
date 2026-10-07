import { useEffect, useId, useState } from "react";
import { Bot, Layers, Users } from "lucide-react";
import { Button } from "../foundation/Button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Icon } from "../foundation/Icon";
import { RadioGroup, RadioGroupItem } from "../foundation/RadioGroup";

/** BUILD §9.6: "This agent only" / "Apply to all [type] agents" / "Apply to all agents". */
export const APPLY_SCOPES = ["agent", "type", "all"] as const;
export type ApplyScope = (typeof APPLY_SCOPES)[number];

export interface ApplyScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The agent the setting was changed on. */
  agentName: string;
  /** Its type, as a plural-ready noun: "channel engine", "specialist", "lead". */
  agentType: string;
  /** How many agents share the type / exist in the squad, for the option copy. */
  typeCount?: number;
  allCount?: number;
  /** What is being applied, e.g. "Model: Sonnet" or "Autonomy: Assisted". */
  settingLabel: string;
  /** The choice the dialog opens on (default "agent"). */
  defaultScope?: ApplyScope;
  onApply: (scope: ApplyScope) => void | Promise<void>;
}

/** Option copy for a scope. Exported for tests. */
export function applyScopeCopy(scope: ApplyScope, ctx: Pick<ApplyScopeDialogProps, "agentName" | "agentType" | "typeCount" | "allCount">): { label: string; description: string } {
  switch (scope) {
    case "agent":
      return { label: "This agent only", description: `Only ${ctx.agentName} changes.` };
    case "type":
      return {
        label: `Apply to all ${ctx.agentType} agents`,
        description: ctx.typeCount !== undefined ? `${ctx.typeCount} ${ctx.typeCount === 1 ? "agent" : "agents"} of this type, including ${ctx.agentName}.` : `Every ${ctx.agentType} agent, including ${ctx.agentName}.`,
      };
    case "all":
      return {
        label: "Apply to all agents",
        description: ctx.allCount !== undefined ? `All ${ctx.allCount} agents in the squad.` : "Every agent in the squad.",
      };
  }
}

const SCOPE_ICON = { agent: Bot, type: Layers, all: Users } as const;

/** Used by model, autonomy and negotiation settings (BUILD §5.4). Enter applies, Esc cancels. */
export function ApplyScopeDialog({ open, onOpenChange, agentName, agentType, typeCount, allCount, settingLabel, defaultScope = "agent", onApply }: ApplyScopeDialogProps) {
  const [scope, setScope] = useState<ApplyScope>(defaultScope);
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  useEffect(() => {
    if (open) setScope(defaultScope);
  }, [open, defaultScope]);

  const apply = async () => {
    setBusy(true);
    try {
      await onApply(scope);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="sm" data-testid="apply-scope-dialog">
        <DialogHeader>
          <DialogTitle>Apply where?</DialogTitle>
          <DialogDescription>{settingLabel}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as ApplyScope)} aria-label="Scope" className="gap-1">
            {APPLY_SCOPES.map((s) => {
              const copy = applyScopeCopy(s, { agentName, agentType, typeCount, allCount });
              const id = `${baseId}-${s}`;
              return (
                <label key={s} htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded-panel border border-transparent p-2 hover:bg-white/4 has-[[data-state=checked]]:border-subtle has-[[data-state=checked]]:bg-panel-alt">
                  <RadioGroupItem id={id} value={s} className="mt-0.5" />
                  <Icon icon={SCOPE_ICON[s]} className="mt-0.5 text-secondary" />
                  <span className="flex flex-col">
                    <span className="text-body text-primary">{copy.label}</span>
                    <span className="text-small text-secondary">{copy.description}</span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={apply} loading={busy} data-testid="apply-scope-confirm">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
