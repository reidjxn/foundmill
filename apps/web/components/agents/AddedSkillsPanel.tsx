"use client";
/**
 * Overview › "Skills <name> has learned" (founder request 2026-10-16; moved from Training under the Skills panel in
 * WP-10 T8): the skills the founder added from the curated library or as a skill file, each with where it came from and
 * whether a training run has scored it yet, removable. "Add a skill" opens the library; the panel's menu holds
 * "Upload a skill file" and "Write your own" (Custom skills, which stay on Training). Adding calls no model; the skill
 * shows on the attributes at once, not tested yet. Its instructions reach the agent's prompt after the house rules and
 * never change its tools, autonomy or spend caps.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, MoreHorizontal, PenLine, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, ChosenSkillList, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, IconButton, Panel, useToast } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
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
        toast({ title: rows.length === 1 ? `“${rows[0]!.name}” added` : `${rows.length} skills added`, description: rows.length === 1 ? `${agent.name} will use it from the next task. Not tested yet.` : `${agent.name} will use them from the next task. Not tested yet.`, tone: "good" });
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
        title={`Skills ${agent.name} has learned`}
        span={12}
        loading={addedQ.isLoading}
        error={addedQ.error ? errorMessage(addedQ.error) : undefined}
        onRetry={() => void addedQ.refetch()}
        actions={
          <span className="flex items-center gap-1">
            <Button size="sm" icon={BookOpen} onClick={() => setDialog("library")} disabled={released || remaining <= 0} data-testid="add-library-skill">
              Add a skill
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={MoreHorizontal} size="sm" variant="ghost" label="More ways to add a skill" disabled={released} data-testid="skills-more" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={remaining <= 0} onSelect={() => setDialog("upload")} data-testid="upload-skill">
                  <Icon icon={Upload} size="inline" /> Upload a skill file
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={routes.agent(businessId, agent.id, "training")} data-testid="write-skill">
                    <Icon icon={PenLine} size="inline" /> Write your own
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        }
        empty={!addedQ.isLoading && added.length === 0 ? { icon: BookOpen, children: `Teach ${agent.name} a kind of work: release notes, a pricing page, a first email. Add a skill to see what it says.` } : undefined}
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
        pickerFor={{ agentId: agent.id }}
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
