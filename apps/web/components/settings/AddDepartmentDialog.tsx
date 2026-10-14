"use client";
/**
 * "Add department" (BUILD §11.13 structure: create blank, from a template or from a sentence; audit MLSL-08). Every
 * route ends in the same editable form (name, modules, icon, color) before `department.create` runs, so nothing is made
 * from a guess. A template whose department is archived offers Restore instead of a second copy. No agents are hired.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, Chip, DeptChip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Icon, Input, SegmentedControl, SimpleSelect, Textarea } from "@foundmill/dugout";
import { DEPT_COLOUR_TOKENS, MODULE_KEYS, type DeptColourToken, type ModuleKey } from "@foundmill/shared/constants";
import { DEPARTMENT_ICON_NAMES, iconByName } from "@/lib/icons";
import { MODULE_WORDS, moduleList, plainWords } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { draftDepartment, type DepartmentDraft } from "./department-draft";
import { Hint } from "./shared";

type Route = "blank" | "template" | "sentence";

export interface AddDepartmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (name: string) => void;
  onRestored: (departmentId: string, name: string) => void;
  onFailed: (err: unknown) => void;
}

const BLANK: DepartmentDraft = { name: "", moduleKeys: [], icon: "folder", colourToken: "dept-7" };

export function AddDepartmentDialog({ open, onOpenChange, onCreated, onRestored, onFailed }: AddDepartmentDialogProps) {
  const { businessId, departments } = useBusiness();
  const trpc = useTRPC();
  const [route, setRoute] = useState<Route>("blank");
  const [draft, setDraft] = useState<DepartmentDraft>(BLANK);
  const [sentence, setSentence] = useState("");
  const [drafted, setDrafted] = useState(false);
  const templatesQ = useQuery(trpc.department.templates.queryOptions({ businessId }, { enabled: open && route === "template", staleTime: 10_000 }));
  const create = useMutation(trpc.department.create.mutationOptions());
  const restore = useMutation(trpc.department.restore.mutationOptions());

  useEffect(() => {
    if (!open) return;
    setRoute("blank");
    setDraft(BLANK);
    setSentence("");
    setDrafted(false);
  }, [open]);

  const taken = departments.map((d) => d.colourToken);
  const set = (patch: Partial<DepartmentDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const showForm = route === "blank" || drafted;
  const ready = draft.name.trim().length > 0 && draft.moduleKeys.length > 0;

  const submit = async () => {
    try {
      await create.mutateAsync({ businessId, name: draft.name.trim(), icon: draft.icon, colourToken: draft.colourToken, moduleKeys: draft.moduleKeys });
      onCreated(draft.name.trim());
      onOpenChange(false);
    } catch (err) {
      onFailed(err);
    }
  };
  const restoreArchived = async (departmentId: string, name: string) => {
    try {
      await restore.mutateAsync({ businessId, departmentId });
      onRestored(departmentId, name);
      onOpenChange(false);
    } catch (err) {
      onFailed(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="add-department">
        <DialogHeader>
          <DialogTitle>Add a department</DialogTitle>
          <DialogDescription>A department is a sidebar item over one or more modules, with their tabs. No agents are hired; give it a lead in its settings or hire into it from Team › Recruitment.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <SegmentedControl<Route>
              aria-label="Start from"
              size="md"
              value={route}
              onValueChange={(r) => {
                setRoute(r);
                setDrafted(false);
                if (r === "blank") setDraft(BLANK);
              }}
              options={[
                { value: "blank", label: "Blank" },
                { value: "template", label: "Template" },
                { value: "sentence", label: "From a sentence" },
              ]}
            />

            {route === "template" && !drafted ? (
              <ul className="flex flex-col" data-testid="department-templates">
                {(templatesQ.data ?? []).map((t) => (
                  <li key={t.key} className="flex min-h-row-comfortable items-center gap-2 border-b border-line-faint py-1 last:border-b-0" data-template={t.key}>
                    <Icon icon={iconByName(t.icon)} size="default" className="text-secondary" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body-strong text-primary">{t.name}</span>
                      <span className="text-small text-secondary">Covers {moduleList(t.moduleKeys).toLowerCase()}</span>
                    </span>
                    {t.inUse ? <Chip tone="neutral">In your sidebar</Chip> : null}
                    {t.archivedId ? (
                      <Button size="sm" icon={RotateCcw} loading={restore.isPending} onClick={() => void restoreArchived(t.archivedId!, t.name)}>
                        Restore
                      </Button>
                    ) : (
                      <Button size="sm" variant={t.inUse ? "ghost" : "default"} onClick={() => (setDraft({ name: t.name, moduleKeys: [...t.moduleKeys] as ModuleKey[], icon: t.icon, colourToken: t.colourToken as DeptColourToken }), setDrafted(true))}>
                        Use
                      </Button>
                    )}
                  </li>
                ))}
                {templatesQ.isLoading ? <li className="py-2 text-small text-secondary">Loading templates…</li> : null}
              </ul>
            ) : null}

            {route === "sentence" ? (
              <div className="flex flex-col gap-2">
                <Field htmlFor="department-sentence" label="Describe the department" hint="For example: “A customer support desk that handles refunds and the privacy policy.” It is read here, on this page; nothing is created until you press Add.">
                  <Textarea id="department-sentence" rows={2} value={sentence} onChange={(e) => setSentence(e.target.value)} maxLength={400} />
                </Field>
                <Button size="sm" icon={Sparkles} className="self-start" disabled={!sentence.trim()} onClick={() => (setDraft(draftDepartment(sentence, taken)), setDrafted(true))}>
                  Draft it
                </Button>
              </div>
            ) : null}

            {showForm ? (
              <div className="flex flex-col gap-3" data-testid="department-draft">
                <div className="grid grid-cols-3 gap-3">
                  <Field htmlFor="new-dept-name" label="Name" required>
                    <Input id="new-dept-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
                  </Field>
                  <Field htmlFor="new-dept-icon" label="Icon">
                    <SimpleSelect
                      id="new-dept-icon"
                      value={draft.icon}
                      onValueChange={(icon) => set({ icon })}
                      options={[...new Set<string>([...DEPARTMENT_ICON_NAMES, draft.icon])].map((name) => ({
                        value: name,
                        textValue: plainWords(name),
                        label: (
                          <span className="inline-flex items-center gap-2">
                            <Icon icon={iconByName(name)} size="inline" className="text-secondary" />
                            {plainWords(name.replace(/-\d+$/, ""))}
                          </span>
                        ),
                      }))}
                    />
                  </Field>
                  <Field htmlFor="new-dept-color" label="Color">
                    <SimpleSelect id="new-dept-color" value={draft.colourToken} onValueChange={(v) => set({ colourToken: v as DeptColourToken })} options={DEPT_COLOUR_TOKENS.map((token, i) => ({ value: token, textValue: `Color ${i + 1}`, label: <DeptChip dept={token}>Color {i + 1}</DeptChip> }))} />
                  </Field>
                </div>
                <fieldset className="flex flex-col gap-1">
                  <legend className="t-label mb-1">Modules it covers</legend>
                  <div className="grid grid-cols-3 gap-1">
                    {MODULE_KEYS.map((m) => (
                      <label key={m} className="flex items-center gap-2 text-body">
                        <Checkbox checked={draft.moduleKeys.includes(m)} onCheckedChange={(v) => set({ moduleKeys: v ? MODULE_KEYS.filter((k) => k === m || draft.moduleKeys.includes(k)) : draft.moduleKeys.filter((k) => k !== m) })} />
                        {MODULE_WORDS[m] ?? m}
                      </label>
                    ))}
                  </div>
                  {draft.moduleKeys.length === 0 ? <Hint>Pick at least one module: its tabs become the department's screens.</Hint> : null}
                </fieldset>
              </div>
            ) : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {showForm ? (
            <Button variant="primary" disabled={!ready} loading={create.isPending} onClick={() => void submit()} data-testid="add-department-submit">
              Add
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
