import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon, type IconSize } from "./Icon";

export interface SpinnerProps {
  size?: IconSize;
  className?: string;
  /** Screen-reader text. Defaults to "Loading". */
  label?: string;
  /** Inside a control that already says what is happening ("Saving…", aria-busy): draw the glyph only, no status. */
  decorative?: boolean;
}

/**
 * A turning Lucide loader for **buttons and inline controls only** (a busy Save, a refresh). Panels, lists and cards
 * load with Skeleton, never a spinner (DESIGN §7). Under reduced motion it stops; the label still reads "Loading".
 */
export function Spinner({ size = "default", className, label = "Loading", decorative }: SpinnerProps) {
  if (decorative) return <Icon icon={LoaderCircle} size={size} className={cn("animate-spin", className)} />;
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex", className)}>
      <Icon icon={LoaderCircle} size={size} className="animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
