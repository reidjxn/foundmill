"use client";
/**
 * The fallback spec block editor used when the host supplies no `SpecEditor` through `ModuleEnv` (the collaborative
 * editor is Tiptap 3 + Yjs + @hocuspocus/provider, which only apps/web carries; see docs/NEEDED_DEPS.md).
 *
 * Edits the block's text form (prosemirror.ts subset) and saves through `product.spec.editBlock`, which the API records
 * as a human edit and pins (AC-11.5.3). ⌘/Ctrl+S saves; Esc reverts unsaved changes.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Button, Textarea } from "@foundmill/dugout";
import type { SpecEditorProps } from "../../env";
import { pmToText, pmWordCount, textToPm } from "../prosemirror";
import { InlineError, useAction } from "../shared";

export function PlainBlockEditor({ blockId, initialContent, readOnly, onSaved, onStatusChange }: SpecEditorProps) {
  const initialText = useMemo(() => pmToText(initialContent), [initialContent]);
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const action = useAction();

  useEffect(() => {
    setText(initialText);
    setSavedText(initialText);
  }, [initialText, blockId]);
  useEffect(() => {
    onStatusChange?.("local");
  }, [onStatusChange]);

  const dirty = text !== savedText;
  const save = async () => {
    if (!dirty || readOnly) return;
    const content = textToPm(text);
    const result = await action.run<{ content?: Record<string, unknown> }>("product.spec.editBlock", { blockId, patch: { content } }, { key: "save" });
    if (result !== undefined) {
      setSavedText(text);
      onSaved?.(content);
    }
  };
  const revert = () => setText(savedText);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape" && dirty) {
      e.preventDefault();
      revert();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-plain-block-editor>
      <Textarea
        aria-label="Block text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        rows={18}
        className="min-h-64 flex-1 resize-y"
        spellCheck
      />
      <div className="flex items-center gap-2">
        <span className="text-small text-secondary tabular-nums">
          {pmWordCount(textToPm(text))} words · headings with #, lists with - or 1. · {dirty ? "unsaved changes" : "saved"}
        </span>
        <span className="flex-1" />
        <InlineError error={action.error} />
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={revert} disabled={!dirty || readOnly}>
          Revert
        </Button>
        <Button size="sm" variant="primary" icon={Save} onClick={() => void save()} disabled={!dirty || readOnly} loading={action.pending === "save"}>
          Save
        </Button>
      </div>
    </div>
  );
}
