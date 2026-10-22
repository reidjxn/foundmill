"use client";
/**
 * The logo picker (BUILD §11.1 Commit screen; §11.15 Settings › Business): upload a real logo or generate marks, see
 * the result as it will be stored, and take brand colours from it.
 *
 * - Upload: PNG, JPEG, WebP or SVG up to 2 MB. Rasters are resized in the browser (`readLogoFile`); every file then
 *   goes to the server's check (`actions.prepare`), and the preview shows exactly what that check returned.
 * - Generate: four marks from the logo designer (`actions.generate`), drawn in parallel (monogram, geometric, negative
 *   space, abstract) and streamed: each slot shows its direction while it is drawn and the mark the moment the server's
 *   check passes it, so the first can be picked before the others are ready. The generate control (DIRECTION #14) is the
 *   panel's main action: "Generate logos", then "Generate again"; while a set is drawn it shows the real count
 *   ("2 of 4") with Stop beside it (the marks already drawn stay). The cost of each set is shown as an Estimate.
 * - Colours: once a logo is chosen, the two colours read from it are offered next to the current brand colours; the
 *   founder applies them with one click and can still edit them.
 *
 * Logos are only ever rendered through `<img src>` (Dugout `BusinessLogo`). Desktop only, Dugout components only.
 */
import { Check, Eraser, Palette, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { BusinessLogo, Button, Chip, FitText, GenerateControl, ProvenanceChip, Skeleton, StatusPill, Term, cn, type Kit } from "@foundmill/dugout";
import { nextRovingIndex, rovingTabStop } from "@/lib/roving";
import { errorMessage } from "@/lib/trpc";
import { LOGO_FILE_ACCEPT, LOGO_FILE_HINT, formatCostEstimate, readLogoFile, sameKit, suggestKit, type LogoDraft } from "@/lib/logo";

export interface GeneratedLogoOption {
  id: string;
  name: string;
  concept: string;
  dataUrl: string;
  colours: string[];
}

export interface GeneratedLogoSet {
  options: GeneratedLogoOption[];
  cost: { amountMinor: number; currency: string; label: "Estimate" };
  remaining: number;
  mode: "mock" | "live";
}

/** Progress of a set while it is drawn (`readLogoStream` turns the api's stream into these). */
export type LogoProgress =
  /** The slots of the set, one per direction, labelled while their mark is drawn. */
  | { type: "started"; slots: { index: number; label: string }[] }
  /** A mark passed the server's check: show it in its slot now. */
  | { type: "option"; index: number; option: GeneratedLogoOption }
  /** A slot ended without a usable mark. */
  | { type: "failed"; index: number; message: string };

export interface LogoActions {
  /** Server check of an upload (`idea.logo.prepare` / `business.logo.prepare`): the cleaned data URL and its colours. */
  prepare(dataUrl: string): Promise<{ dataUrl: string; colours: string[] }>;
  /**
   * A set of generated marks (`idea.logo.stream` / `business.logo.stream`). `onProgress` receives each mark as it is
   * ready; the promise resolves with the whole set. `signal` stops the set (the picker unmounted).
   */
  generate(round: number, onProgress?: (progress: LogoProgress) => void, signal?: AbortSignal): Promise<GeneratedLogoSet>;
}

/** The ids of the marks that are drawn, in order (the failed and still-drawing slots are not options). */
function optionIds(slots: readonly { option?: { id: string } | null }[] | null): string[] {
  return (slots ?? []).flatMap((slot) => (slot.option ? [slot.option.id] : []));
}

/** A slot of the set being drawn. */
export interface LogoDraftSlot {
  index: number;
  label: string;
  option: GeneratedLogoOption | null;
  failed: boolean;
}

/** The four directions the api draws in, shown before its first event arrives. */
export const DEFAULT_LOGO_SLOTS = ["Monogram", "Geometric", "Negative space", "Abstract"] as const;

const emptySlots = (): LogoDraftSlot[] => DEFAULT_LOGO_SLOTS.map((label, index) => ({ index, label, option: null, failed: false }));

/** Folds one progress event into the slots being drawn. */
export function applyLogoProgress(slots: readonly LogoDraftSlot[], progress: LogoProgress): LogoDraftSlot[] {
  if (progress.type === "started") return progress.slots.map((s) => ({ index: s.index, label: s.label, option: slots[s.index]?.option ?? null, failed: false }));
  const next = [...slots];
  const current = next[progress.index] ?? { index: progress.index, label: `Mark ${progress.index + 1}`, option: null, failed: false };
  next[progress.index] = progress.type === "option" ? { ...current, option: progress.option, failed: false } : { ...current, failed: !current.option };
  return next;
}

export interface LogoPickerProps {
  name: string;
  kit: Kit;
  /** The chosen logo, or null for the initials mark. */
  value: LogoDraft | null;
  /** A new choice (null: back to the initials mark). May return a promise (Settings saves at once). */
  onChange: (draft: LogoDraft | null) => void | Promise<void>;
  actions: LogoActions;
  /** Apply the colours read from the logo. */
  onUseColours?: (kit: Kit) => void;
  /** Disables every control (a viewer, or a save in flight). */
  disabled?: boolean;
  /** True while `onChange` is saving. */
  saving?: boolean;
  className?: string;
}

/** One line on the logo in use; a stored logo loaded from the server has no label. */
function describe(value: LogoDraft): string {
  if (value.source === "generated") return value.label ? `Generated mark: ${value.label}.` : "Using a generated mark.";
  return value.label ? `Uploaded: ${value.label}.` : "Using an uploaded logo.";
}

export function LogoPicker({ name, kit, value, onChange, actions, onUseColours, disabled, saving, className }: LogoPickerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "generate" | null>(null);
  const [note, setNote] = useState<{ tone: "info" | "bad"; text: string } | null>(null);
  const [set, setSet] = useState<GeneratedLogoSet | null>(null);
  /** Marks drawn before Stop (the set was not finished, so it has no cost line). */
  const [stopped, setStopped] = useState<GeneratedLogoOption[] | null>(null);
  const [slots, setSlots] = useState<LogoDraftSlot[] | null>(null);
  const [round, setRound] = useState(0);
  const [suggestion, setSuggestion] = useState<Kit | null>(null);
  const locked = disabled || saving || busy !== null;
  // A mark can be picked as soon as it arrives, while the rest of the set is still being drawn.
  const choosing = disabled || saving || busy === "upload";
  const abortRef = useRef<AbortController | null>(null);
  // The marks are one Tab stop: the arrow keys move between them (ARIA radio pattern; audit A11Y-20).
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedOption, setFocusedOption] = useState<string | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Colours read from the chosen logo (SVG fills from the server, or the raster's pixels). Keyed by content, not by the
  // draft object, so a parent that rebuilds the draft on render does not re-read it.
  const valueUrl = value?.dataUrl ?? null;
  const valueColours = value?.colours.join(",") ?? "";
  useEffect(() => {
    let live = true;
    if (!valueUrl) {
      setSuggestion(null);
      return;
    }
    void suggestKit({ dataUrl: valueUrl, colours: valueColours ? valueColours.split(",") : [] }).then((k) => {
      if (live) setSuggestion(k);
    });
    return () => {
      live = false;
    };
  }, [valueUrl, valueColours]);

  async function choose(draft: LogoDraft | null) {
    try {
      await onChange(draft);
    } catch (err) {
      setNote({ tone: "bad", text: errorMessage(err) });
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    setNote(null);
    try {
      const raw = await readLogoFile(file);
      const checked = await actions.prepare(raw);
      await choose({ source: "upload", dataUrl: checked.dataUrl, colours: checked.colours, label: file.name });
      setNote({ tone: "info", text: `Using ${file.name}.` });
    } catch (err) {
      setNote({ tone: "bad", text: errorMessage(err, "That file could not be used.") });
    } finally {
      setBusy(null);
    }
  }

  /** Stop the set being drawn: the marks already drawn stay and can be picked. */
  function stop() {
    const controller = abortRef.current;
    if (!controller) return;
    abortRef.current = null;
    controller.abort();
    const drawn = (slots ?? []).flatMap((sl) => (sl.option ? [sl.option] : []));
    setStopped(drawn.length ? drawn : null);
    setSlots(null);
    setBusy(null);
    setNote({ tone: "info", text: drawn.length ? `Stopped. ${drawn.length === 1 ? "The mark already drawn stays" : `The ${drawn.length} marks already drawn stay`} here.` : "Stopped before a mark was drawn." });
  }

  async function generate(next: number) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy("generate");
    setNote(null);
    setStopped(null);
    setSlots(emptySlots());
    try {
      const result = await actions.generate(next, (progress) => {
        if (!controller.signal.aborted) setSlots((current) => applyLogoProgress(current ?? emptySlots(), progress));
      }, controller.signal);
      if (controller.signal.aborted) return;
      setSet(result);
      setRound(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      setNote({ tone: "bad", text: errorMessage(err, "The logo designer is not available right now.") });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSlots(null);
        setBusy(null);
      }
    }
  }

  const drafting = slots !== null;
  const ready = slots?.filter((sl) => sl.option).length ?? 0;
  // While a set is drawn its slots show (marks as they arrive); otherwise the last finished set.
  const finished = stopped ?? set?.options ?? null;
  const shown: LogoDraftSlot[] | null = slots ?? (finished ? finished.map((option, index) => ({ index, label: option.name, option, failed: false })) : null);
  const selectedOption = shown?.find((slot) => slot.option && value?.source === "generated" && value.dataUrl === slot.option.dataUrl)?.option?.id ?? null;
  const tabStop = rovingTabStop(optionIds(shown), focusedOption, selectedOption);
  const total = slots?.length ?? DEFAULT_LOGO_SLOTS.length;

  const showSuggestion = suggestion !== null && !sameKit(suggestion, kit);

  return (
    <div className={cn("grid grid-cols-[auto_1fr] gap-gutter", className)} data-testid="logo-picker" data-logo-source={value?.source ?? "initials"}>
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-32 items-center justify-center rounded-panel border border-subtle bg-ink" data-testid="logo-preview">
          <BusinessLogo src={value?.dataUrl} name={name || "Your business"} primary={kit.primary} size={96} />
        </div>
        {/* The name as the top bar sets it: as wide as it needs (up to 156 px), then two lines, then a smaller size. */}
        <div className="flex min-h-10 w-max min-w-32 max-w-48 items-center gap-2 rounded-panel bg-kit-primary px-2 py-1 text-kit-on-primary" aria-label="Top bar preview" data-testid="kit-bar-preview">
          <BusinessLogo src={value?.dataUrl} name={name || "Your business"} primary={kit.primary} size={20} title="" />
          <FitText minPx={11} lines={2} className="min-w-0 t-display-sm leading-tight">
            {name || "Your business"}
          </FitText>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept={LOGO_FILE_ACCEPT} className="sr-only" onChange={onFile} aria-label="Upload a logo" data-testid="logo-file" disabled={locked} tabIndex={-1} />
          {/* The panel's main action: the generate control, with the real count and Stop while a set is drawn. */}
          <GenerateControl
            size={set ? "md" : "lg"}
            label={set || stopped ? "Generate again" : "Generate logos"}
            runningLabel="Drawing logos"
            running={busy === "generate"}
            count={busy === "generate" ? `${ready} of ${total}` : undefined}
            progress={busy === "generate" ? ready / total : undefined}
            onGenerate={() => void generate(set || stopped ? round + 1 : 0)}
            onStop={stop}
            disabled={locked && busy !== "generate"}
            data-testid={set ? "logo-regenerate" : "logo-generate"}
          />
          <Button size="sm" icon={Upload} loading={busy === "upload"} disabled={locked} onClick={() => fileRef.current?.click()} data-testid="logo-upload">
            Upload a logo
          </Button>
          {value ? (
            <Button size="sm" variant="ghost" icon={Eraser} disabled={choosing} onClick={() => void choose(null)} data-testid="logo-clear">
              Use initials instead
            </Button>
          ) : null}
        </div>
        {note ? (
          note.tone === "bad" ? (
            <StatusPill tone="bad" role="alert" className="self-start" data-testid="logo-error">
              {note.text}
            </StatusPill>
          ) : (
            <p className="text-small text-secondary" role="status">
              {note.text}
            </p>
          )
        ) : drafting ? (
          <p className="text-small text-secondary" role="status" aria-live="polite" data-testid="logo-drafting">
            {ready === 0 ? "The logo designer is drawing four marks at once; each appears here as soon as it is ready." : `${ready} of ${slots!.length} ready. Pick one now or wait for the rest.`}
          </p>
        ) : (
          <p className="text-small text-secondary">{value ? describe(value) : `No logo yet: the initials mark stands in. ${LOGO_FILE_HINT}`}</p>
        )}

        {shown ? (
          <div className="flex flex-col gap-2" data-testid="logo-options" data-drafting={drafting || undefined}>
            <div
              role="radiogroup"
              aria-label="Generated logos"
              aria-busy={drafting || undefined}
              className="grid grid-cols-4 gap-2"
              onKeyDown={(e) => {
                // Arrows only move focus; Space or Enter chooses, so a key press never saves a logo by itself.
                const ids = optionIds(shown);
                const at = ids.findIndex((id) => optionRefs.current.get(id) === e.target);
                const to = at < 0 ? null : nextRovingIndex(e.key, at, ids.length);
                if (to === null) return;
                e.preventDefault();
                optionRefs.current.get(ids[to]!)?.focus();
              }}
            >
              {shown.map((slot) => {
                const o = slot.option;
                if (!o) {
                  return (
                    <div key={`slot-${slot.index}`} className="flex flex-col items-center gap-1.5 rounded-panel border border-subtle bg-panel-alt p-2" data-testid="logo-slot" data-state={slot.failed ? "failed" : "drawing"}>
                      {slot.failed ? <div className="flex size-16 items-center justify-center rounded-panel border border-dashed border-subtle text-small text-secondary">Not usable</div> : <Skeleton className="size-16 rounded-panel" />}
                      <span className="max-w-full truncate text-small text-secondary">{slot.label}</span>
                    </div>
                  );
                }
                const selected = value?.source === "generated" && value.dataUrl === o.dataUrl;
                return (
                  <button
                    key={o.id}
                    ref={(el) => {
                      if (el) optionRefs.current.set(o.id, el);
                      else optionRefs.current.delete(o.id);
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={o.id === tabStop ? 0 : -1}
                    onFocus={() => setFocusedOption(o.id)}
                    aria-label={`${o.name}: ${o.concept}`}
                    title={o.concept}
                    disabled={choosing}
                    onClick={() => void choose({ source: "generated", dataUrl: o.dataUrl, colours: o.colours, label: o.name })}
                    data-testid="logo-option"
                    data-selected={selected || undefined}
                    className={cn(
                      "relative flex flex-col items-center gap-1.5 rounded-panel border border-subtle bg-panel-alt p-2 text-left transition-colors duration-micro ease-dugout hover:border-secondary/60 focus-visible:outline-2 focus-visible:outline-link disabled:opacity-60",
                      selected && "border-link",
                    )}
                  >
                    <BusinessLogo src={o.dataUrl} name={o.name} primary={kit.primary} size={64} title="" />
                    <span className="flex max-w-full items-center gap-1 truncate text-small text-primary">
                      {selected ? <Check size={12} aria-hidden className="shrink-0 text-link" /> : null}
                      <span className="truncate">{o.name}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {set && !drafting && !stopped ? (
              <div className="flex flex-wrap items-center gap-2 text-small text-secondary">
                <Chip mono>Opus</Chip>
                {/* The first cost a founder meets says where it comes from (A13): included credits, never a card. */}
                <span data-testid="logo-cost" className="inline-flex flex-wrap items-center gap-1.5">
                  This set: {formatCostEstimate(set.cost)} <ProvenanceChip kind="estimate" /> from your included <Term id="credits">credits</Term>
                </span>
                <span>· {set.remaining} more {set.remaining === 1 ? "set" : "sets"} this hour</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {showSuggestion && onUseColours ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3" data-testid="logo-colour-suggestion">
            <Palette size={14} aria-hidden className="text-secondary" />
            <span className="text-small text-secondary">Colors from the logo:</span>
            {[suggestion!.primary, suggestion!.secondary].map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1 font-mono text-mono text-primary" data-colour={c}>
                <span aria-hidden className="inline-block size-4 rounded-chip border border-subtle" style={{ backgroundColor: c }} />
                {c}
              </span>
            ))}
            <Button size="sm" disabled={choosing} onClick={() => onUseColours(suggestion!)} data-testid="logo-use-colours">
              Use these colors
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
