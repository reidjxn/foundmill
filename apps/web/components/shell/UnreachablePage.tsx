"use client";
/** Rendered by server pages when apps/api cannot be reached: says what failed and how to fix it. */
import { ServerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@foundmill/dugout";
import { publicEnv } from "@/lib/env";
import { BrandFrame } from "./BrandFrame";
import { SignOutButton } from "./SignOutButton";

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
          <SignOutButton />
        </div>
      </div>
    </BrandFrame>
  );
}
