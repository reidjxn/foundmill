"use client";
/** `/email/pause?t=<token>`: "Pause every email" from a founder email's footer. One button; Settings turns them back on. */
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, BellOff } from "lucide-react";
import { Button, EmptyState } from "@foundmill/dugout";
import { BrandFrame } from "@/components/shell/BrandFrame";
import { useTRPC } from "@/lib/trpc-react";

export function EmailPause({ token }: { token: string | null }) {
  const trpc = useTRPC();
  const pause = useMutation(trpc.email.pause.mutationOptions());
  const done = pause.data?.paused === true;
  const refused = pause.data?.paused === false || !token;
  return (
    <BrandFrame title="Founder emails">
      <div data-testid="email-pause" data-state={done ? "paused" : refused ? "refused" : "ready"}>
        <EmptyState
          icon={BellOff}
          title={done ? "Emails paused" : refused ? "This link no longer works" : "Pause every email?"}
          actions={
            done || refused ? (
              <Button asChild size="sm" variant="secondary" iconRight={ArrowRight}>
                <a href="/">Go to your business</a>
              </Button>
            ) : (
              <Button size="sm" variant="primary" icon={BellOff} loading={pause.isPending} onClick={() => token && pause.mutate({ token })}>
                Pause every email
              </Button>
            )
          }
        >
          {done
            ? "You will get no more emails from your team. Turn them back on in Settings › Preferences › Email."
            : refused
              ? "Pause links work for 60 days. Choose which emails you get in Settings › Preferences › Email."
              : "Your team keeps working; it just stops emailing you. You can turn emails back on in Settings › Preferences › Email."}
        </EmptyState>
      </div>
    </BrandFrame>
  );
}
