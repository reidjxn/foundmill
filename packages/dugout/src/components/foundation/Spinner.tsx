import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon, type IconSize } from "./Icon";

export interface SpinnerProps {
  size?: IconSize;
  className?: string;
  /** Screen-reader text. Defaults to "Loading". */
  label?: string;
}

/** A rotating Lucide loader. Under reduced motion the global rule stops the spin; the label still reads "Loading". */
export function Spinner({ size = "default", className, label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex", className)}>
      <Icon icon={LoaderCircle} size={size} className="animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
