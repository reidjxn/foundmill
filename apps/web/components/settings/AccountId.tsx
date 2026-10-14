"use client";
/**
 * The signed-in person's own account ID, with Copy: the ID a co-founder's owner or admin types into Settings › Members
 * to add them (team.humans.invite also accepts the email they sign in with). Shown on the founder profile
 * (/onboarding) and in Settings › Preferences, so a new co-founder can always find it.
 */
import { Copy } from "lucide-react";
import { useState } from "react";
import { Button, useToast } from "@foundmill/dugout";

export interface AccountIdProps {
  accountId: string | null | undefined;
  className?: string;
}

export function AccountId({ accountId, className }: AccountIdProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  if (!accountId) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      toast({ title: "Account ID copied", description: "Send it to the owner or an admin of the business that adds you.", tone: "good" });
    } catch {
      toast({ title: "Copy did not work", description: "Select the ID and copy it by hand.", tone: "warn" });
    }
  };
  return (
    <div className={className} data-testid="account-id">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-sm bg-surface-2 px-2 py-1 font-mono text-mono text-primary" title={accountId}>
          {accountId}
        </code>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => void copy()} data-testid="account-id-copy">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-1 text-small text-secondary">To join a co-founder's business, send them this ID or the email you sign in with; they add you from Settings › Members.</p>
    </div>
  );
}
