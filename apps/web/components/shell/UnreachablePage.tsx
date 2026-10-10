"use client";
/** Rendered by server pages when apps/api cannot be reached: says what failed and how to fix it. */
import { ServerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, EmptyState } from "@foundmill/dugout";
import { publicEnv } from "@/lib/env";
import { BrandFrame } from "./BrandFrame";

export function UnreachablePage({ message }: { message: string }) {
  const router = useRouter();
  const env = publicEnv();
  return (
    <BrandFrame title="Can't reach the server" footer={<span className="font-mono text-mono">Server address {env.apiUrl}</span>}>
      <div>
        <EmptyState icon={ServerOff} title="Nothing loaded yet" action={{ label: "Try again", onClick: () => router.refresh() }}>
          {message} Check your connection, then try again. If it keeps happening, the server may be restarting.
        </EmptyState>
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" asChild>
            <a href="/auth/signout">Sign out</a>
          </Button>
        </div>
      </div>
    </BrandFrame>
  );
}
