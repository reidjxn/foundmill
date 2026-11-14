"use client";
/**
 * The signed-in person's own account ID, with Copy: for support to find the account. Nobody is added to a project by
 * it any more: people join through an invitation they accept (Settings › People; THESIS_REVIEW 3.1). Shown on the
 * founder profile (/onboarding) and in Settings › Preferences.
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
      toast({ title: "Account ID copied", description: "Give it to support if they ask for it.", tone: "good" });
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
      <p className="mt-1 text-small text-secondary">Your account's ID, if support asks for it. To join someone's project, open the invitation link they send you.</p>
    </div>
  );
}
