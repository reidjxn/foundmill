"use client";
/**
 * Training › Skills from the library or files (founder request 2026-10-16), next to Custom skills: the skills the
 * founder added from the curated library or as a skill file, each with where it came from and whether a training run
 * has scored it yet, removable; "Add from library" and "Upload a skill file" open the same dialogs as the hire flow.
 * Adding calls no model; the skill shows on the attributes at once, untested. Its instructions reach the agent's
 * prompt after the house rules and never change its tools, autonomy or spend caps.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, ChosenSkillList, Panel, useToast } from "@foundmill/dugout";
import { MAX_ADDED_SKILLS, SkillLibraryDialog, UploadSkillDialog, type SkillChoiceInput } from "@foundmill/modules/team/skills";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import type { AgentProfile } from "./logic";

export interface AddedSkillsPanelProps {
  businessId: string;
  profile: AgentProfile;
  onChanged: () => void;
}

export function AddedSkillsPanel({ businessId, profile, onChanged }: AddedSkillsPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const agent = profile.agent;
  const released = !!agent.archivedAt;
  const addedQ = useQuery(trpc.agent.skills.added.queryOptions({ businessId, agentId: agent.id }, { staleTime: 30_000 }));
  const [dialog, setDialog] = useState<"library" | "upload" | null>(null);
  const added = useMemo(() => addedQ.data ?? [], [addedQ.data]);
  const remaining = MAX_ADDED_SKILLS - added.length;
  const unavailable = useMemo(() => Object.fromEntries(added.filter((s) => s.source === "library").map((s) => [s.skillKey.replace(/^library_/, ""), `${agent.name} already has this skill`] as const)), [added, agent.name]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("agent") as unknown[] });
    onChanged();
  };
  const add = useMutation(
    trpc.agent.skills.add.mutationOptions({
      onSuccess: (rows) => {
        toast({ title: rows.length === 1 ? `“${rows[0]!.name}” added` : `${rows.length} skills added`, description: "On the attributes now, marked Untested. Library and file skills carry no tests, so a training run reports them as No tests yet; to have one scored, add it as a custom skill.", tone: "good" });
        refresh();
      },
    }),
  );
  const remove = useMutation(
    trpc.agent.skills.remove.mutationOptions({
      onSuccess: () => {
        toast({ title: "Skill removed", description: `${agent.name} no longer carries it. You can add it again at any time.`, tone: "info" });
        refresh();
      },
    }),
  );
  const addSkills = async (skills: SkillChoiceInput[]) => {
    try {
      await add.mutateAsync({ businessId, agentId: agent.id, skills });
      return true;
    } catch {
      return false;
    }
  };
  return (
    <>
      <Panel
        title="Skills from the library or files"
        span={12}
        loading={addedQ.isLoading}
        error={addedQ.error ? errorMessage(addedQ.error) : undefined}
        onRetry={() => void addedQ.refetch()}
        actions={
          <span className="flex gap-2">
            <Button size="sm" icon={BookOpen} onClick={() => setDialog("library")} disabled={released || remaining <= 0} data-testid="add-library-skill">
              Add from library
            </Button>
            <Button size="sm" icon={Upload} onClick={() => setDialog("upload")} disabled={released || remaining <= 0} data-testid="upload-skill">
              Upload a skill file
            </Button>
          </span>
        }
        empty={!addedQ.isLoading && added.length === 0 ? { icon: BookOpen, children: `Give ${agent.name} how-to skills from the library or a skill file (SKILL.md, .md or .txt). No tests to draft: they show on its attributes at once, marked Untested, and a training run reports them as No tests yet. To have a skill scored, add it as a custom skill and review the tests it drafts.` } : undefined}
        footer="A skill adds instructions after the house rules. It never changes the agent's tools, autonomy, spend caps or approvals."
        data-testid="added-skills"
      >
        <ChosenSkillList
          items={added.map((s) => ({ id: s.skillKey, name: s.name, source: s.source, detail: s.source === "upload" && s.fileName ? `${s.fileName} · ${s.description}` : s.description, untested: s.untested }))}
          onRemove={released ? undefined : (skillKey) => remove.mutate({ businessId, agentId: agent.id, skillKey })}
          busy={remove.isPending}
        />
        {remove.error ? (
          <p role="alert" className="text-small text-status-bad">
            {errorMessage(remove.error)}
          </p>
        ) : null}
      </Panel>
      <SkillLibraryDialog
        open={dialog === "library"}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
          add.reset();
        }}
        agentName={agent.name}
        unavailable={unavailable}
        remaining={remaining}
        pending={add.isPending}
        error={add.error ? errorMessage(add.error) : null}
        onAdd={(rows) => addSkills(rows.map((r) => ({ source: "library", key: r.key })))}
      />
      <UploadSkillDialog
        open={dialog === "upload"}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
          add.reset();
        }}
        agentName={agent.name}
        pending={add.isPending}
        error={add.error ? errorMessage(add.error) : null}
        onAdd={(f) => addSkills([{ source: "upload", fileName: f.fileName, content: f.content }])}
      />
    </>
  );
}
