"use client";
/**
 * Monaco DiffEditor body (lazy chunk: import this file only through `React.lazy`). Uses the locally installed
 * `monaco-editor` through `loader.config({ monaco })`, never the loader's CDN default, and defines an ink theme from
 * the resolved Dugout tokens. Only the languages the Training Ground sees are registered, to keep the chunk small.
 */
import { useMemo } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/typescript/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/css/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/shell/register.js";
import "monaco-editor/languages/definitions/sql/register.js";
import "monaco-editor/languages/definitions/yaml/register.js";
import "monaco-editor/languages/definitions/dockerfile/register.js";
import { DiffEditor, loader } from "@monaco-editor/react";
import { Skeleton } from "../foundation/Skeleton";
import { readToken } from "./TerminalView";

loader.config({ monaco });

export const DUGOUT_MONACO_THEME = "dugout-ink";

function hex6(value: string, fallback: string): string {
  const v = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

/** Monaco colours must be hex; read the tokens once and append alpha for the tints. */
export function dugoutMonacoTheme(): monaco.editor.IStandaloneThemeData {
  const ink = hex6(readToken("--bg-ink", "#0b0e12"), "#0b0e12");
  const panelAlt = hex6(readToken("--bg-panel-alt", "#1d232b"), "#1d232b");
  const line = hex6(readToken("--line-subtle", "#2a313b"), "#2a313b");
  const fg = hex6(readToken("--text-primary", "#e8ecf1"), "#e8ecf1");
  const dim = hex6(readToken("--text-secondary", "#9aa4b2"), "#9aa4b2");
  const good = hex6(readToken("--status-good", "#3dd68c"), "#3dd68c");
  const bad = hex6(readToken("--status-bad", "#f2545b"), "#f2545b");
  const link = hex6(readToken("--accent-link", "#7cc4ff"), "#7cc4ff");
  const warn = hex6(readToken("--status-warn", "#f5b841"), "#f5b841");
  const violet = hex6(readToken("--dept-5", "#b98cff"), "#b98cff");
  return {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: dim.slice(1), fontStyle: "italic" },
      { token: "keyword", foreground: violet.slice(1) },
      { token: "string", foreground: good.slice(1) },
      { token: "number", foreground: warn.slice(1) },
      { token: "type", foreground: link.slice(1) },
      { token: "tag", foreground: link.slice(1) },
      { token: "attribute.name", foreground: warn.slice(1) },
    ],
    colors: {
      "editor.background": ink,
      "editor.foreground": fg,
      "editorGutter.background": ink,
      "editorLineNumber.foreground": dim,
      "editorLineNumber.activeForeground": fg,
      "editor.lineHighlightBackground": panelAlt,
      "editor.selectionBackground": line,
      "editorIndentGuide.background1": line,
      "editorWidget.background": panelAlt,
      "editorWidget.border": line,
      "scrollbarSlider.background": line,
      "scrollbarSlider.hoverBackground": dim,
      "scrollbarSlider.activeBackground": dim,
      "diffEditor.insertedTextBackground": `${good}26`,
      "diffEditor.removedTextBackground": `${bad}26`,
      "diffEditor.insertedLineBackground": `${good}1f`,
      "diffEditor.removedLineBackground": `${bad}1f`,
      "diffEditor.border": line,
      "diffEditorGutter.insertedLineBackground": `${good}1f`,
      "diffEditorGutter.removedLineBackground": `${bad}1f`,
      "diffEditorOverview.insertedForeground": good,
      "diffEditorOverview.removedForeground": bad,
      focusBorder: link,
    },
  };
}

let themeDefined = false;
function ensureTheme(m: typeof monaco) {
  if (themeDefined) return;
  m.editor.defineTheme(DUGOUT_MONACO_THEME, dugoutMonacoTheme());
  themeDefined = true;
}

export interface MonacoDiffProps {
  original: string;
  modified: string;
  language?: string;
  sideBySide?: boolean;
  height?: number | string;
  label?: string;
}

export default function MonacoDiff({ original, modified, language = "plaintext", sideBySide = false, height = "100%", label = "Diff" }: MonacoDiffProps) {
  const options = useMemo<monaco.editor.IDiffEditorConstructionOptions>(
    () => ({
      readOnly: true,
      originalEditable: false,
      renderSideBySide: sideBySide,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderOverviewRuler: false,
      lineNumbersMinChars: 3,
      folding: false,
      glyphMargin: false,
      fontFamily: readToken("--font-mono", '"JetBrains Mono", ui-monospace, monospace'),
      fontSize: 12,
      lineHeight: 18,
      renderIndicators: true,
      ignoreTrimWhitespace: false,
      diffWordWrap: "off",
      scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
      padding: { top: 4, bottom: 4 },
      ariaLabel: label,
    }),
    [sideBySide, label],
  );
  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme={DUGOUT_MONACO_THEME}
      beforeMount={(m) => ensureTheme(m as typeof monaco)}
      options={options}
      height={height}
      loading={<Skeleton className="m-2 h-3 w-1/2" />}
      wrapperProps={{ "data-monaco-diff": true, role: "region", "aria-label": label }}
    />
  );
}
