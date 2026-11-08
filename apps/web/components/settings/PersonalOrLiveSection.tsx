"use client";
/**
 * Settings › Business › Personal or live: the game mode (Live ⇄ Personal) behind a review dialog (business.setGameMode).
 * It moved here from the old Settings › Mode (founder, 2026-11-07): whether the business is on the network is a fact
 * about the business, not about what the team may do. Going live asks the founder, once, to confirm that they are 18 or
 * older (BUILD §11.14: the network is for adults). BUILD §9.6, §11.15.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, ConsequenceLine, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, StatusPill } from "@foundmill/dugout";
import type { GameMode } from "@foundmill/shared/constants";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { SettingsSection, useSettingsToast } from "./shared";

/** What a game-mode switch changes (BUILD §7.3, §11.14); the review shows it before the switch. */
export const GAME_MODE_REVIEW: Record<GameMode, string[]> = {
  live: ["Your business profile and logo become visible on the network.", "Verified metrics can rank on leaderboards; self-reported numbers never rank.", "Connections, communities and human messages open up.", "Search also shows public profiles, labeled with the product name.", "The network is for people 18 or older: you confirm that before going live."],
  personal: ["The business leaves search and leaderboards within 15 minutes.", "Connections and communities are hidden; nothing is deleted.", "Agents keep working exactly as before."],
};

/** The consequence line under the game-mode button: what the switch to `target` does, and that it can be undone. */
export const GAME_MODE_CONSEQUENCE: Record<GameMode, { consequence: string; reversible: true }> = {
  live: { consequence: "Your profile and logo become visible on the network; switch back to Personal any time.", reversible: true },
  personal: { consequence: "The business leaves search and leaderboards within 15 minutes; nothing is deleted.", reversible: true },
};

export function PersonalOrLiveSection() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  const [reviewTarget, setReviewTarget] = useState<GameMode | null>(null);
  // Going live asks for the founder's 18+ confirmation unless it is already on record (`live.summary`, the shell's badge query).
  const [adult, setAdult] = useState(false);
  const summaryQ = useQuery(trpc.live.summary.queryOptions(undefined, { staleTime: 10_000, retry: false }));
  const needsAdult = reviewTarget === "live" && summaryQ.data?.adultConfirmed !== true;
  const closeReview = () => (setReviewTarget(null), setAdult(false));
  const setGameMode = useMutation(trpc.business.setGameMode.mutationOptions({ onSuccess: (_r, v) => (void invalidate(["business", "live"]), closeReview(), t.saved(v.gameMode === "live" ? "The business is live" : "The business is personal again")), onError: (e) => t.failed(e) }));

  return (
    <SettingsSection title="Personal or live" data-testid="personal-or-live">
      <div className="flex items-center gap-3">
        <StatusPill tone={b.gameMode === "live" ? "info" : "neutral"} icon={b.gameMode === "live" ? Globe : Lock}>
          {b.gameMode === "live" ? "Live" : "Personal"}
        </StatusPill>
        <p className="text-body text-secondary">{b.gameMode === "live" ? "Visible on the network and eligible for leaderboards." : "Private: only members of this business can see it."}</p>
      </div>
      {data.liveOpen ? (
        <div className="flex flex-col gap-1.5">
          <div>
            <Button variant="default" onClick={() => setReviewTarget(b.gameMode === "live" ? "personal" : "live")} data-testid="switch-game-mode">
              {b.gameMode === "live" ? "Switch to Personal" : "Go live"}
            </Button>
          </div>
          <ConsequenceLine {...GAME_MODE_CONSEQUENCE[b.gameMode === "live" ? "personal" : "live"]} data-testid="game-mode-consequence" />
        </div>
      ) : (
        <p className="text-body text-secondary" data-testid="live-closed-note">Live is not open yet. When it opens, you can list this business on the network from here.</p>
      )}
      <Dialog open={reviewTarget !== null} onOpenChange={(o) => !o && closeReview()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{reviewTarget === "live" ? "Review before going live" : "Review before switching to Personal"}</DialogTitle>
            <DialogDescription>This is what changes. Nothing is deleted either way.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body">{(reviewTarget ? GAME_MODE_REVIEW[reviewTarget] : []).map((line) => <li key={line}>{line}</li>)}</ul>
            {needsAdult ? (
              <div className="flex items-start gap-2" data-testid="go-live-adult">
                <Checkbox id="go-live-adult" checked={adult} onCheckedChange={(v) => setAdult(v === true)} className="mt-0.5" />
                <Label htmlFor="go-live-adult" className="normal-case tracking-normal text-body text-primary">
                  I am 18 or older. The network is for adults; you confirm this once.
                </Label>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={closeReview}>
              Cancel
            </Button>
            <Button variant="primary" disabled={needsAdult && !adult} loading={setGameMode.isPending} onClick={() => reviewTarget && setGameMode.mutate({ businessId, gameMode: reviewTarget, reason: "settings", ...(needsAdult ? { confirmAdult: true } : {}) })}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
