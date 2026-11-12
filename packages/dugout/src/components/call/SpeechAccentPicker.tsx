"use client";
import { useId, type HTMLAttributes } from "react";
import { Volume2 } from "lucide-react";
import { SPEECH_ACCENTS, type SpeechAccent, type SpeechAccentKey } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Field } from "../foundation/Label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../foundation/Select";

export interface SpeechAccentPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "children"> {
  value: SpeechAccentKey;
  /** The accent this agent gets when the founder chooses none: marked "Default" in the list. */
  defaultKey: SpeechAccentKey;
  onChange: (key: SpeechAccentKey) => void;
  /** "Hear it": the app plays a short sample of `key` (the picker plays nothing itself). Omit it to hide the button. */
  onPreview?: (key: SpeechAccentKey) => void;
  disabled?: boolean;
  /** Why it is disabled, said under the field ("Only people who can edit the team change how it sounds."). */
  disabledReason?: string;
}

const nameOf = (a: Pick<SpeechAccent, "key">) => a.key.charAt(0).toUpperCase() + a.key.slice(1);

const GROUPS = [
  { presentation: "woman", label: "Women's" },
  { presentation: "man", label: "Men's" },
] as const;

/**
 * One agent's accent (how it sounds on calls): a select over `SPEECH_ACCENTS` grouped Women's and Men's, each with its
 * tone ("Talia · warm, soft"), the agent's own default marked "Default", and a "Hear it" button that calls
 * `onPreview`. Controlled; plays nothing itself.
 */
export function SpeechAccentPicker({ value, defaultKey, onChange, onPreview, disabled = false, disabledReason, className, ...rest }: SpeechAccentPickerProps) {
  const id = useId();
  const selectId = `${id}-accent`;
  const known = SPEECH_ACCENTS.some((a) => a.key === value);
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="speech-accent-picker" {...rest}>
      <Field htmlFor={selectId} label="Accent" hint={disabled && disabledReason ? disabledReason : "How this agent sounds on calls"}>
        <div className="flex items-center gap-2">
          <Select value={known ? value : undefined} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger id={selectId} className="min-w-48 flex-1">
              <SelectValue placeholder="Choose an accent" />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((g) => (
                <SelectGroup key={g.presentation}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {SPEECH_ACCENTS.filter((a) => a.presentation === g.presentation).map((a) => (
                    <SelectItem key={a.key} value={a.key} textValue={`${nameOf(a)} ${a.tone}`}>
                      {nameOf(a)} <span className="text-tertiary">· {a.tone}</span>
                      {a.key === defaultKey ? <span className="ml-1.5 text-micro text-secondary">Default</span> : null}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {onPreview ? (
            <Button icon={Volume2} disabled={disabled || !known} onClick={() => onPreview(value)} data-testid="speech-accent-preview">
              Hear it
            </Button>
          ) : null}
        </div>
      </Field>
    </div>
  );
}
