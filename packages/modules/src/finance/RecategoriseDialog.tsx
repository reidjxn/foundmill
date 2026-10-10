"use client";
/**
 * Recategorise one bank transaction (BUILD §11.8 "founder recategorisations become rules"): pick a line of the standard
 * chart of accounts, optionally apply it to every transaction of the same counterparty as a rule, save through
 * `finance.transactions.recategorise`.
 */
import { useEffect, useId, useState } from "react";
import { Tag } from "lucide-react";
import { Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, SimpleSelect } from "@foundmill/dugout";
import { PNL_CATEGORY_OPTIONS, categoryLabel, chartEntry, isUncategorised } from "./metrics";
import { InlineError, fmtSigned, useAction } from "./shared";
import type { TransactionRow } from "./types";

export interface RecategoriseDialogProps {
  transaction: TransactionRow | null;
  onClose: () => void;
  /** Called after a successful save with the number of rows the rule touched. */
  onSaved?: (result: { ruleApplied: number }) => void;
}

const UNCATEGORISED = "__none__";

export function RecategoriseDialog({ transaction, onClose, onSaved }: RecategoriseDialogProps) {
  const id = useId();
  const action = useAction();
  const [category, setCategory] = useState<string>(UNCATEGORISED);
  const [applyToCounterparty, setApply] = useState(true);
  useEffect(() => {
    if (transaction) {
      setCategory(isUncategorised(transaction.category) ? UNCATEGORISED : (chartEntry(transaction.category)?.category ?? transaction.category ?? UNCATEGORISED));
      setApply(!!transaction.counterparty);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction?.id]);

  const options = [{ value: UNCATEGORISED, label: "Uncategorised" }, ...PNL_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))];
  if (transaction?.category && !isUncategorised(transaction.category) && !PNL_CATEGORY_OPTIONS.includes(transaction.category) && !chartEntry(transaction.category)) options.push({ value: transaction.category, label: categoryLabel(transaction.category) });

  const save = async () => {
    if (!transaction) return;
    const result = await action.run<{ transaction: TransactionRow; ruleApplied: number }>("finance.transactions.recategorise", {
      transactionId: transaction.id,
      category: category === UNCATEGORISED ? null : category,
      applyToCounterparty: applyToCounterparty && !!transaction.counterparty && category !== UNCATEGORISED,
    });
    if (result !== undefined) {
      onSaved?.({ ruleApplied: result?.ruleApplied ?? 0 });
      onClose();
    }
  };

  return (
    <Dialog open={!!transaction} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" aria-describedby={`${id}-desc`}>
        <DialogHeader>
          <DialogTitle>Recategorise transaction</DialogTitle>
          <DialogDescription id={`${id}-desc`}>
            {transaction ? (
              <>
                <span className="text-primary">{transaction.counterparty ?? transaction.description ?? "Transaction"}</span> · <span className="tabular-nums">{fmtSigned(transaction.amountMinor, transaction.currency)}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-category`} label="Category" hint="A line of the standard chart of accounts. The management P&L updates immediately.">
            <SimpleSelect id={`${id}-category`} options={options} value={category} onValueChange={setCategory} aria-label="Category" />
          </Field>
          <label className="flex items-start gap-2 text-body text-primary">
            <Checkbox checked={applyToCounterparty} disabled={!transaction?.counterparty || category === UNCATEGORISED} onCheckedChange={(v) => setApply(v === true)} aria-label="Apply to every transaction of this counterparty" />
            <span>
              Apply to every transaction from <span className="text-body-strong">{transaction?.counterparty ?? "this counterparty"}</span> and keep it as a rule for new ones.
              {!transaction?.counterparty ? <span className="block text-small text-secondary">This transaction has no counterparty, so no rule can be made.</span> : null}
            </span>
          </label>
          <InlineError error={action.error} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Tag} loading={action.pending === "finance.transactions.recategorise"} onClick={() => void save()}>
            Save category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
