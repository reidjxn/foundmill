import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { Circle, CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export type ToastTone = "neutral" | "good" | "warn" | "bad" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Screen-reader alternative describing how to perform the action elsewhere (Radix requirement). */
  altText?: string;
}

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds; Infinity keeps it until dismissed. Default from the provider (5000). */
  duration?: number;
  action?: ToastAction;
  /** Foreground toasts interrupt screen readers; use for things the user asked for. */
  type?: "foreground" | "background";
  /** Reuse an id to update an existing toast in place. */
  id?: string;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  open: boolean;
}

export interface ToastApi {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  toasts: readonly ToastRecord[];
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the toaster. Throws outside a ToastProvider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const TONE: Record<ToastTone, { icon: IconComponent; className: string }> = {
  neutral: { icon: Circle, className: "text-secondary" },
  good: { icon: CircleCheck, className: "text-status-good" },
  warn: { icon: TriangleAlert, className: "text-status-warn" },
  bad: { icon: CircleX, className: "text-status-bad" },
  info: { icon: Info, className: "text-status-info" },
};

export interface ToastProviderProps {
  children: ReactNode;
  duration?: number;
  /** Where toasts stack. Default bottom-right. */
  position?: "bottom-right" | "top-right";
  /** Render the viewport here (default). Set false to place <Toaster /> yourself. */
  renderViewport?: boolean;
  /** Keep at most this many visible. */
  max?: number;
}

/** State + Radix provider. Put one at the app root; call useToast().toast({...}) anywhere below. */
export function ToastProvider({ children, duration = 5000, position = "bottom-right", renderViewport = true, max = 4 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)));
  }, []);

  const dismissAll = useCallback(() => setToasts((prev) => prev.map((t) => ({ ...t, open: false }))), []);

  const toast = useCallback(
    (opts: ToastOptions): string => {
      const id = opts.id ?? `toast-${++seq.current}`;
      setToasts((prev) => {
        const existing = prev.find((t) => t.id === id);
        const record: ToastRecord = { ...opts, id, open: true };
        if (existing) return prev.map((t) => (t.id === id ? record : t));
        const next = [...prev, record];
        // Close the oldest open toasts beyond the cap; they are removed once their exit animation ends.
        const open = next.filter((t) => t.open);
        if (open.length > max) {
          const toClose = new Set(open.slice(0, open.length - max).map((t) => t.id));
          return next.map((t) => (toClose.has(t.id) ? { ...t, open: false } : t));
        }
        return next;
      });
      return id;
    },
    [max],
  );

  const remove = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss, dismissAll, toasts }), [toast, dismiss, dismissAll, toasts]);

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider duration={duration} swipeDirection="right" label="Notification">
        {children}
        {toasts.map((t) => (
          <Toast key={t.id} record={t} onOpenChange={(open) => (open ? undefined : dismiss(t.id))} onRemoved={() => remove(t.id)} />
        ))}
        {renderViewport ? <Toaster position={position} /> : null}
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export interface ToasterProps {
  position?: "bottom-right" | "top-right";
  className?: string;
}

/** The viewport: a fixed stack, 360 px wide. F8 focuses it (Radix default hotkey). */
export function Toaster({ position = "bottom-right", className }: ToasterProps) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed z-50 flex w-90 max-w-[calc(100vw-2rem)] flex-col gap-2 p-4 outline-none",
        position === "bottom-right" ? "bottom-0 right-0" : "right-0 top-0",
        className,
      )}
    />
  );
}

interface ToastProps {
  record: ToastRecord;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

function Toast({ record, onOpenChange, onRemoved }: ToastProps) {
  const tone = TONE[record.tone ?? "neutral"];
  return (
    <ToastPrimitive.Root
      open={record.open}
      onOpenChange={onOpenChange}
      duration={record.duration}
      type={record.type ?? "foreground"}
      data-tone={record.tone ?? "neutral"}
      onAnimationEnd={() => {
        if (!record.open) onRemoved();
      }}
      className={cn(
        "surface-overlay relative flex items-start gap-2 p-3 pr-8 text-body text-primary",
        "data-[state=open]:animate-rise-in data-[state=closed]:animate-fade-out",
        "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-fade-out",
      )}
    >
      <Icon icon={tone.icon} className={cn("mt-0.5", tone.className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <ToastPrimitive.Title className="t-body-strong">{record.title}</ToastPrimitive.Title>
        {record.description ? <ToastPrimitive.Description className="text-small text-secondary">{record.description}</ToastPrimitive.Description> : null}
        {record.action ? (
          <ToastPrimitive.Action altText={record.action.altText ?? record.action.label} asChild>
            <button
              type="button"
              onClick={record.action.onClick}
              className="mt-1 self-start font-display font-semibold text-small uppercase tracking-tab text-link hover:underline"
            >
              {record.action.label}
            </button>
          </ToastPrimitive.Action>
        ) : null}
      </div>
      <ToastPrimitive.Close
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex size-5 items-center justify-center rounded-chip text-secondary hover:bg-white/6 hover:text-primary"
      >
        <Icon icon={X} size={12} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
