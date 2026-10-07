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
    <BrandFrame footer={<span className="font-mono">API {env.apiUrl}</span>}>
      <div className="flex h-8 items-center border-b border-subtle bg-panel-alt px-3">
        <span className="t-label">The API is not answering</span>
      </div>
      <div className="p-5">
        <EmptyState icon={ServerOff} title="Nothing loaded" action={{ label: "Try again", onClick: () => router.refresh() }}>
          {message} Start apps/api (pnpm dev) or check NEXT_PUBLIC_API_URL, then try again.
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
