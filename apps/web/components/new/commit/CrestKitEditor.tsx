"use client";
/**
 * Crest and brand colours (BUILD §11.1 Commit screen: "crest and kit, generated; or extracted from uploaded logo").
 * Procedural crest preview (Dugout `Crest`, 96 px) seeded by the name, a shuffle, two colour pickers with hex inputs,
 * the text-on-primary contrast check (APCA Lc ≥ 75, DESIGN §5) and a logo upload that extracts the two dominant
 * colours in the browser (canvas → `extractPalette`). Nothing is uploaded anywhere.
 */
import { Dices, Upload } from "lucide-react";
import { useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button, Crest, Field, Input, StatusPill, cn, initials, type Kit } from "@foundmill/dugout";
import { DEFAULT_KIT, extractPalette, kitContrast, normaliseHex } from "./naming";

export interface CrestKitEditorProps {
  name: string;
  seed: string;
  kit: Kit;
  onKitChange: (kit: Kit) => void;
  onShuffle: () => void;
  error?: string;
}

export function CrestKitEditor({ name, seed, kit, onKitChange, onShuffle, error }: CrestKitEditorProps) {
  const contrast = useMemo(() => kitContrast(kit), [kit]);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const monogram = initials(name || "FM");
  const safe = { primary: normaliseHex(kit.primary) ?? DEFAULT_KIT.primary, secondary: normaliseHex(kit.secondary) ?? DEFAULT_KIT.secondary };

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadNote("Choose an image file (PNG, JPG, SVG, WebP).");
      return;
    }
    try {
      const pixels = await readPixels(file);
      const palette = pixels ? extractPalette(pixels, { sampleEvery: 2 }) : null;
      if (!palette) {
        setUploadNote("No strong colours found in that logo; pick them by hand.");
        return;
      }
      onKitChange(palette);
      setUploadNote(`Colours taken from ${file.name}.`);
    } catch {
      setUploadNote("Could not read that file.");
    }
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-gutter" data-testid="crest-kit-editor" style={{ ["--kit-primary" as string]: safe.primary, ["--kit-secondary" as string]: safe.secondary, ["--kit-on-primary" as string]: contrast.onPrimary }}>
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-32 items-center justify-center rounded-panel border border-subtle bg-ink" data-testid="crest-preview">
          <Crest seed={seed} kitPrimary={safe.primary} kitSecondary={safe.secondary} monogram={monogram} size={96} title={`${name || "Business"} logo`} />
        </div>
        <Button size="sm" variant="default" icon={Dices} onClick={onShuffle} data-testid="shuffle-crest">
          Shuffle logo
        </Button>
        <div className="flex h-10 w-32 items-center gap-2 rounded-panel bg-kit-primary px-2 text-kit-on-primary" aria-label="Brand bar preview" data-testid="kit-bar-preview">
          <Crest seed={seed} kitPrimary={safe.primary} kitSecondary={safe.secondary} monogram={monogram} size={20} title="" />
          <span className="truncate t-display-sm">{name || "Your business"}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-gutter">
          <ColourField label="Primary colour" hint="Top bar, Continue button, revenue line, logo." value={kit.primary} onChange={(v) => onKitChange({ ...kit, primary: v })} testId="kit-primary" />
          <ColourField label="Secondary colour" hint="Logo field, celebrations, accents." value={kit.secondary} onChange={(v) => onKitChange({ ...kit, secondary: v })} testId="kit-secondary" />
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="kit-contrast" data-passes={contrast.passes}>
          <StatusPill tone={contrast.passes ? "good" : "warn"}>{contrast.passes ? `Text on primary passes · Lc ${contrast.lc}` : `Text on primary is weak · Lc ${contrast.lc}`}</StatusPill>
          <StatusPill tone={contrast.distinct ? "good" : "warn"}>{contrast.distinct ? "Colours read as two" : "Colours too close"}</StatusPill>
          <span className="text-small text-secondary">Text on the primary is {contrast.onPrimary === "#FFFFFF" ? "white" : "near-black"}, chosen automatically.</span>
        </div>
        {error ? (
          <StatusPill tone="bad" role="alert">
            {error}
          </StatusPill>
        ) : null}
        <div className="flex items-center gap-3 border-t border-subtle pt-3">
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={onFile} aria-label="Upload a logo to extract colours" data-testid="logo-file" />
          <Button size="sm" variant="default" icon={Upload} onClick={() => fileRef.current?.click()}>
            Upload a logo to extract colours
          </Button>
          <span className="text-small text-secondary">{uploadNote ?? "Read in your browser; the file stays on your machine."}</span>
        </div>
      </div>
    </div>
  );
}

function ColourField({ label, hint, value, onChange, testId }: { label: string; hint: string; value: string; onChange: (v: string) => void; testId: string }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setDraft(value);
  }
  const valid = normaliseHex(draft) !== null;
  const swatch = normaliseHex(value) ?? DEFAULT_KIT.primary;
  return (
    <Field htmlFor={id} label={label} hint={hint} error={valid ? undefined : "Use a 6-digit hex colour."}>
      <div className="flex items-center gap-2">
        <label className={cn("relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-panel border border-subtle")} style={{ backgroundColor: swatch }} aria-label={`${label} picker`} data-testid={`${testId}-swatch`}>
          <input
            type="color"
            value={swatch}
            onChange={(e) => {
              const v = e.target.value.toLowerCase();
              setDraft(v);
              onChange(v);
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={`${label} picker`}
          />
        </label>
        <Input
          id={id}
          mono
          value={draft}
          invalid={!valid}
          maxLength={7}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = normaliseHex(e.target.value);
            if (n) onChange(n);
          }}
          onBlur={() => {
            const n = normaliseHex(draft);
            if (n) setDraft(n);
          }}
          data-testid={`${testId}-hex`}
        />
      </div>
    </Field>
  );
}

/** Decode an image file to RGBA pixels on a small canvas (≤ 96 px on the long side). Null when the browser cannot. */
async function readPixels(file: File): Promise<Uint8ClampedArray | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    const scale = Math.min(1, 96 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 96) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 96) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
