"use client";
/**
 * Logo and brand colours (BUILD §11.1 Commit screen: "logo and brand colours, generated or from an uploaded logo").
 * The logo picker (upload a real logo, or generate marks; colours suggested from the chosen logo), then two colour
 * pickers with hex inputs and the text-on-primary contrast check (APCA Lc ≥ 75, DESIGN §5). Nothing is stored until
 * "Take charge": the chosen logo travels with `idea.commit`, which checks it again.
 */
import { useId, useMemo, useState } from "react";
import { Field, Input, StatusPill, cn, type Kit } from "@foundmill/dugout";
import { LogoPicker, type LogoActions } from "@/components/logo/LogoPicker";
import type { LogoDraft } from "@/lib/logo";
import { DEFAULT_KIT, kitContrast, normaliseHex } from "./naming";

export interface LogoColoursEditorProps {
  name: string;
  kit: Kit;
  onKitChange: (kit: Kit) => void;
  logo: LogoDraft | null;
  onLogoChange: (logo: LogoDraft | null) => void;
  logoActions: LogoActions;
  error?: string;
}

export function LogoColoursEditor({ name, kit, onKitChange, logo, onLogoChange, logoActions, error }: LogoColoursEditorProps) {
  const contrast = useMemo(() => kitContrast(kit), [kit]);
  const safe = { primary: normaliseHex(kit.primary) ?? DEFAULT_KIT.primary, secondary: normaliseHex(kit.secondary) ?? DEFAULT_KIT.secondary };

  return (
    <div className="flex flex-col gap-gutter" data-testid="logo-colours-editor" style={{ ["--kit-primary" as string]: safe.primary, ["--kit-secondary" as string]: safe.secondary, ["--kit-on-primary" as string]: contrast.onPrimary }}>
      <LogoPicker name={name} kit={safe} value={logo} onChange={onLogoChange} actions={logoActions} onUseColours={onKitChange} />
      <div className="flex flex-col gap-3 border-t border-subtle pt-3">
        <div className="grid grid-cols-2 gap-gutter">
          <ColourField label="Primary colour" hint="Top bar, Continue button, revenue line, the initials mark." value={kit.primary} onChange={(v) => onKitChange({ ...kit, primary: v })} testId="kit-primary" />
          <ColourField label="Secondary colour" hint="Celebrations and accents." value={kit.secondary} onChange={(v) => onKitChange({ ...kit, secondary: v })} testId="kit-secondary" />
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="kit-contrast" data-passes={contrast.passes}>
          <StatusPill tone={contrast.passes ? "good" : "warn"} title={`Contrast score ${contrast.lc} (75 or more reads well)`}>{contrast.passes ? "Text on it reads clearly" : "Text on it is hard to read"}</StatusPill>
          <StatusPill tone={contrast.distinct ? "good" : "warn"}>{contrast.distinct ? "The two colours stand apart" : "The two colours are too close"}</StatusPill>
          <span className="text-small text-secondary">Text on the primary is {contrast.onPrimary === "#FFFFFF" ? "white" : "near-black"}, chosen automatically.</span>
        </div>
        {error ? (
          <StatusPill tone="bad" role="alert">
            {error}
          </StatusPill>
        ) : null}
      </div>
    </div>
  );
}

export function ColourField({ label, hint, value, onChange, testId }: { label: string; hint: string; value: string; onChange: (v: string) => void; testId: string }) {
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
