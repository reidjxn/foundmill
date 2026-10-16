import { ShellSkeleton } from "@/components/shell/ShellSkeleton";

/**
 * Wraps the business layout itself (app/b has no layout of its own): the document head and the script preloads go out
 * at once while app/b/[bid]/layout.tsx waits on the profile, the business and its departments (audit topology F5).
 * The layout's redirects and not-found still work after this point; Next sends them in the stream.
 */
export default function BusinessFrameLoading() {
  return <ShellSkeleton />;
}
