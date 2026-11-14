"use client";
/**
 * Settings › Business: "Foundmill may ask to feature this project" (0105, showcase videos). On by default (one value in
 * packages/config). It only lets Foundmill ask: every founder sees the final video and nothing is posted without each
 * one's yes. A founder switches it off; switching it off withdraws an open ask at once.
 */
import { APP_NAME } from "@foundmill/config";
import { Label, Switch } from "@foundmill/dugout";
import { showcaseWords } from "@foundmill/shared/showcase";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBusiness } from "@/components/shell/business-context";
import { trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

const WORDS = showcaseWords(APP_NAME);

export function ShowcaseSection() {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useSettingsToast();
  const q = useQuery(trpc.showcase.setting.get.queryOptions({ businessId }, { retry: false }));
  const set = useMutation(
    trpc.showcase.setting.set.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpcPathPrefix("showcase") as unknown[] }),
      onError: (err) => t.failed(err),
    }),
  );
  if (!q.data) return null;
  return (
    <SettingsSection title="Showcase videos" data-testid="settings-showcase">
      <div className="flex items-center gap-3">
        <Switch id="showcase-may-ask" checked={set.isPending ? set.variables.mayAsk : q.data.mayAsk} disabled={!q.data.canChange || set.isPending} onCheckedChange={(mayAsk) => set.mutate({ businessId, mayAsk })} />
        <Label htmlFor="showcase-may-ask">{WORDS.setting}</Label>
      </div>
      <Hint>{WORDS.settingHint}</Hint>
    </SettingsSection>
  );
}
