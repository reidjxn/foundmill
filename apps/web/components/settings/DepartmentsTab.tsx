"use client";
/**
 * Settings › Departments (BUILD §11.13): add (blank, template or from a sentence), rename, reorder, hide, merge, split,
 * per-department settings (lead, icon, color, budget, approvals), archive behind a confirmation with Undo, an Archived
 * list to restore from, and reset to the archetype's defaults. Every change goes through department.* and re-renders
 * the sidebar (AC-11.13.1, AC-11.13.2; audits MLSL-08, WEB-19, AC-06).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, GitMerge, Pencil, Plus, RotateCcw, Scissors, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, Chip, DeptChip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, IconButton, Input, Label, SimpleSelect, Switch, departmentLetters, useToast } from "@foundmill/dugout";
import { MODULE_KEYS, type ModuleKey } from "@foundmill/shared/constants";
import { MODULE_WORDS, moduleList } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { orderedVisibleDepartments } from "@/lib/sidebar";
import { useBusiness, type DepartmentRow } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AddDepartmentDialog } from "./AddDepartmentDialog";
import { DepartmentSettingsDialog } from "./DepartmentSettingsDialog";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

export function DepartmentsTab() {
  const { businessId, departments } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const after = (what: string) => () => {
    void invalidate(["department", "screen", "business"]);
    t.saved(what);
  };
  const update = useMutation(trpc.department.update.mutationOptions({ onSuccess: after("Department updated"), onError: (e) => t.failed(e) }));
  const reorder = useMutation(trpc.department.reorder.mutationOptions({ onSuccess: after("Order saved"), onError: (e) => t.failed(e) }));
  const merge = useMutation(trpc.department.merge.mutationOptions({ onSuccess: after("Departments merged"), onError: (e) => t.failed(e) }));
  const split = useMutation(trpc.department.split.mutationOptions({ onSuccess: after("Department split"), onError: (e) => t.failed(e) }));
  const { toast } = useToast();
  const restore = useMutation(trpc.department.restore.mutationOptions({ onSuccess: after("Department restored"), onError: (e) => t.failed(e) }));
  const archive = useMutation(
    trpc.department.archive.mutationOptions({
      onSuccess: (dept) => {
        void invalidate(["department", "screen", "business"]);
        // Undo clears the archive on the department and its tabs (department.restore), so a mis-click is never final.
        toast({ title: `${dept.name} archived`, description: "It left the sidebar. Restore it below or with Undo.", tone: "good", duration: 10_000, action: { label: "Undo", onClick: () => restore.mutate({ businessId, departmentId: dept.id }) } });
      },
      onError: (e) => t.failed(e),
    }),
  );
  const reset = useMutation(trpc.department.resetDefaults.mutationOptions({ onSuccess: after("Defaults restored"), onError: (e) => t.failed(e) }));

  const ordered = departments.slice().sort((a, b) => a.position - b.position);
  const letters = departmentLetters(orderedVisibleDepartments(departments).map((d) => ({ id: d.id, name: d.name })));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [mergeFrom, setMergeFrom] = useState<DepartmentRow | null>(null);
  const [mergeInto, setMergeInto] = useState<string>("");
  const [splitSource, setSplitSource] = useState<DepartmentRow | null>(null);
  const [splitName, setSplitName] = useState("");
  const [splitModules, setSplitModules] = useState<ModuleKey[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settingsOf, setSettingsOf] = useState<DepartmentRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<DepartmentRow | null>(null);
  // Archived departments are not in the shell's list (it asks for live ones); this is the way back to them.
  const archivedQ = useQuery(trpc.department.list.queryOptions({ businessId, includeHidden: true, includeArchived: true }, { staleTime: 10_000 }));
  const archived = (archivedQ.data ?? []).filter((d) => d.archivedAt).sort((a, b) => a.name.localeCompare(b.name));

  const move = (index: number, dir: -1 | 1) => {
    const ids = ordered.map((d) => d.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate({ businessId, orderedIds: ids });
  };

  return (
    <AdminOnly>
      <SettingsSection wide title="Departments" actions={
          <span className="flex items-center gap-1">
            <Button size="sm" icon={Plus} onClick={() => setAdding(true)} data-testid="add-department-open">Add department</Button>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>Reset to defaults</Button>
          </span>
        }>
        <Hint>This order is the sidebar's. Press G, then the letter beside a department, to jump to it. Hidden departments keep their agents and tabs.</Hint>
        <ul className="flex flex-col" data-testid="department-list">
          {ordered.map((d, i) => (
            <li key={d.id} className="flex min-h-row-comfortable items-center gap-2 border-b border-line-faint py-1 last:border-b-0" data-department-id={d.id}>
              <span className="flex w-12 gap-0.5">
                <IconButton label="Move up" icon={ArrowUp} size="sm" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} />
                <IconButton label="Move down" icon={ArrowDown} size="sm" disabled={i === ordered.length - 1 || reorder.isPending} onClick={() => move(i, 1)} />
              </span>
              <DeptChip dept={d.colourToken}>{letters.get(d.id) ? `G ${letters.get(d.id)}` : "—"}</DeptChip>
              {editingId === d.id ? (
                <form
                  className="flex flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draftName.trim()) update.mutate({ businessId, departmentId: d.id, patch: { name: draftName.trim() } });
                    setEditingId(null);
                  }}
                >
                  <Input aria-label="Department name" controlSize="sm" value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus maxLength={80} />
                  <IconButton label="Save name" icon={Check} size="sm" type="submit" />
                  <IconButton label="Cancel" icon={X} size="sm" onClick={() => setEditingId(null)} />
                </form>
              ) : (
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-body-strong text-primary">{d.name}</span>
                  {moduleList(d.moduleKeys).toLowerCase() !== d.name.toLowerCase() ? <span className="text-small text-tertiary">Covers {moduleList(d.moduleKeys).toLowerCase()}</span> : null}
                  {d.hidden ? <Chip tone="neutral">Hidden</Chip> : null}
                  <IconButton label={`Rename ${d.name}`} icon={Pencil} size="sm" onClick={() => (setEditingId(d.id), setDraftName(d.name))} />
                </span>
              )}
              <Label htmlFor={`hide-${d.id}`} className="text-secondary">
                Visible
              </Label>
              <Switch id={`hide-${d.id}`} size="sm" checked={!d.hidden} onCheckedChange={(v) => update.mutate({ businessId, departmentId: d.id, patch: { hidden: !v } })} />
              <IconButton label={`Merge ${d.name} into another department`} icon={GitMerge} size="sm" onClick={() => (setMergeFrom(d), setMergeInto(""))} />
              <IconButton label={`Split ${d.name}`} icon={Scissors} size="sm" disabled={d.moduleKeys.length < 2} onClick={() => (setSplitSource(d), setSplitName(""), setSplitModules([]))} />
              <IconButton label={`Settings of ${d.name}`} icon={SlidersHorizontal} size="sm" onClick={() => setSettingsOf(d)} />
              <IconButton label={`Archive ${d.name}`} icon={Trash2} size="sm" onClick={() => setArchiveTarget(d)} />
            </li>
          ))}
        </ul>
      </SettingsSection>

      {archived.length > 0 ? (
        <SettingsSection wide title="Archived">
          <Hint>Archived departments are out of the sidebar. Restoring one brings back its tabs; its agents and history were kept.</Hint>
          <ul className="flex flex-col" data-testid="archived-departments">
            {archived.map((d) => (
              <li key={d.id} className="flex min-h-row-comfortable items-center gap-2 border-b border-line-faint py-1 last:border-b-0" data-department-id={d.id}>
                <DeptChip dept={d.colourToken}>{d.name}</DeptChip>
                <span className="min-w-0 flex-1 text-small text-tertiary">Covers {moduleList(d.moduleKeys).toLowerCase()}</span>
                <Button size="sm" icon={RotateCcw} loading={restore.isPending && restore.variables?.departmentId === d.id} onClick={() => restore.mutate({ businessId, departmentId: d.id })}>
                  Restore {d.name}
                </Button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      ) : null}

      <AddDepartmentDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(name) => (void invalidate(["department", "screen", "business"]), t.saved(`${name} added`))}
        onRestored={(_id, name) => (void invalidate(["department", "screen", "business"]), t.saved(`${name} restored`))}
        onFailed={(e) => t.failed(e)}
      />

      <DepartmentSettingsDialog
        department={settingsOf}
        shortcut={settingsOf && letters.get(settingsOf.id) ? `G ${letters.get(settingsOf.id)}` : null}
        onOpenChange={(o) => !o && setSettingsOf(null)}
        onSaved={(what) => (void invalidate(["department", "screen", "business", "team"]), t.saved(what))}
        onFailed={(e) => t.failed(e)}
      />

      <Dialog open={archiveTarget !== null} onOpenChange={(o) => !o && setArchiveTarget(null)}>
        <DialogContent size="sm" data-testid="archive-department">
          <DialogHeader>
            <DialogTitle>Archive {archiveTarget?.name}?</DialogTitle>
            <DialogDescription>
              It leaves the sidebar{archiveTarget && archiveTarget.tabs.length > 0 ? `, along with its tabs: ${archiveTarget.tabs.slice().sort((a, b) => a.position - b.position).map((x) => x.title).join(", ")}` : ""}. Its agents and history are kept, and you can restore it from Archived on this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={archive.isPending} onClick={() => archiveTarget && archive.mutateAsync({ businessId, departmentId: archiveTarget.id }).then(() => setArchiveTarget(null), () => setArchiveTarget(null))}>
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mergeFrom !== null} onOpenChange={(o) => !o && setMergeFrom(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Merge {mergeFrom?.name}</DialogTitle>
            <DialogDescription>One sidebar item with both departments' tabs; agents move across.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field htmlFor="merge-into" label="Into">
              <SimpleSelect id="merge-into" value={mergeInto} onValueChange={setMergeInto} placeholder="Choose a department" options={ordered.filter((d) => d.id !== mergeFrom?.id).map((d) => ({ value: d.id, label: d.name }))} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMergeFrom(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!mergeInto} loading={merge.isPending} onClick={() => mergeFrom && merge.mutateAsync({ businessId, fromId: mergeFrom.id, intoId: mergeInto }).then(() => setMergeFrom(null))}>
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={splitSource !== null} onOpenChange={(o) => !o && setSplitSource(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Split {splitSource?.name}</DialogTitle>
            <DialogDescription>Move some of its modules into a new department.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <Field htmlFor="split-name" label="New department name" required>
                <Input id="split-name" value={splitName} onChange={(e) => setSplitName(e.target.value)} maxLength={80} />
              </Field>
              <fieldset className="flex flex-col gap-1">
                <legend className="t-label mb-1">What moves to the new department</legend>
                {MODULE_KEYS.filter((m) => splitSource?.moduleKeys.includes(m)).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-body">
                    <Checkbox checked={splitModules.includes(m)} onCheckedChange={(v) => setSplitModules((cur) => (v ? [...cur, m] : cur.filter((x) => x !== m)))} />
                    {MODULE_WORDS[m] ?? m}
                  </label>
                ))}
              </fieldset>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSplitSource(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!splitName.trim() || splitModules.length === 0} loading={split.isPending} onClick={() => splitSource && split.mutateAsync({ businessId, sourceId: splitSource.id, department: { name: splitName.trim(), moduleKeys: splitModules, colourToken: splitSource.colourToken } }).then(() => setSplitSource(null))}>
              Split
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reset departments to the archetype defaults?</DialogTitle>
            <DialogDescription>Names, icons, colors, order and modules go back to the seed, and archived default departments come back. Custom departments stay; nothing is deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutateAsync({ businessId }).then(() => setConfirmReset(false))}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminOnly>
  );
}
