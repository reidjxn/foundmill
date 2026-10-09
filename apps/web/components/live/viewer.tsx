"use client";
/**
 * Who is signed in, for the LIVE pages: connections and messages are between people, so a row has to say which side
 * is the viewer. The `(live)` layout reads it from the founder profile (the dev bearer carries no user id).
 */
import { createContext, useContext, type ReactNode } from "react";

export interface LiveViewer {
  userId: string;
  displayName: string | null;
}

const Ctx = createContext<LiveViewer | null>(null);

export function LiveViewerProvider({ value, children }: { value: LiveViewer; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveViewer(): LiveViewer {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLiveViewer must be used inside the LIVE layout");
  return v;
}
