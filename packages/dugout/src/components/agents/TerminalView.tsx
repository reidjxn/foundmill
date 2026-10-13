"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import type { Terminal as XTerminal } from "@xterm/xterm";
import type { FitAddon as XFitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { cn } from "../../lib/cn";
import type { StdoutChunk } from "./types";

export interface TerminalViewProps {
  /** Output chunks in order. New chunks are written incrementally; a shorter or different list replays from the top. */
  chunks: readonly StdoutChunk[];
  /** Accessible name, e.g. "Terminal output for Juno". */
  label: string;
  /** `xterm` (default in a browser) or `plain` (a `<pre>` for tests, SSR and very small tiles). */
  renderer?: "xterm" | "plain";
  /** Keep the viewport scrolled to the latest output. Default true. */
  follow?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Who the terminal belongs to, for the empty state ("Waiting for Juno's first output"). */
  agentName?: string;
  /** The session is running: the empty state shows a live prompt with a caret instead of an idle message. */
  live?: boolean;
  /** The task's goal in plain words: the empty state shows it, so every waiting tile says what it is about. */
  brief?: string;
  /** A small tile (the focus rail, a grid of 12 or more): the empty state keeps only its prompt line. */
  compact?: boolean;
}

/**
 * What an empty terminal shows instead of a black void: a live prompt with a blinking caret and the agent's name while
 * the session runs, or a quiet idle note, over the task's goal when it is known (so no two waiting tiles read alike).
 * CSS-only motion; reduced motion leaves a solid caret and the words.
 */
export function TerminalEmpty({ agentName, live, brief, compact }: { agentName?: string; live?: boolean; brief?: string; compact?: boolean }) {
  const who = agentName ?? "The agent";
  return (
    <div className={cn("pointer-events-none absolute inset-0 flex flex-col justify-end font-mono text-mono", compact ? "p-2" : "gap-3 p-3")} data-terminal-empty={live ? "live" : "idle"}>
      <div className="flex flex-col gap-1 text-tertiary">
        {compact ? null : <span>{live ? "session attached · streaming" : "session idle · no output yet"}</span>}
        <span>
          <span className="text-kit-lift">❯</span> <span className="text-secondary">{live ? `waiting for ${who}'s first output` : `${who} has not written anything yet`}</span>{" "}
          {live ? <span aria-hidden className="prompt-caret" /> : null}
        </span>
      </div>
      {compact ? null : brief ? (
        <p className="font-body text-small text-secondary" data-terminal-brief>
          <span className="text-tertiary">Goal · </span>
          {brief}
        </p>
      ) : (
        <p className="font-body text-small text-tertiary">{live ? "Lines stream in here as the session runs." : "Output appears here when the session starts."}</p>
      )}
    </div>
  );
}

/** Read a CSS custom property from the document root (xterm themes need resolved colours, not `var()`). */
export function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** The xterm theme built from Dugout tokens: ink background, primary text, status colours for the ANSI palette. */
export function terminalTheme(): Record<string, string> {
  const bg = readToken("--bg-ink", "#0b0e12");
  const fg = readToken("--text-primary", "#e8ecf1");
  const dim = readToken("--text-secondary", "#9aa4b2");
  const good = readToken("--status-good", "#3dd68c");
  const warn = readToken("--status-warn", "#f5b841");
  const bad = readToken("--status-bad", "#f2545b");
  const info = readToken("--status-info", "#5b8cff");
  const link = readToken("--accent-link", "#7cc4ff");
  const line = readToken("--line-subtle", "#2a313b");
  return {
    background: bg,
    foreground: fg,
    cursor: dim,
    cursorAccent: bg,
    selectionBackground: line,
    black: bg,
    red: bad,
    green: good,
    yellow: warn,
    blue: info,
    magenta: readToken("--dept-5", "#b98cff"),
    cyan: readToken("--dept-6", "#4fd1c5"),
    white: fg,
    brightBlack: dim,
    brightRed: bad,
    brightGreen: good,
    brightYellow: warn,
    brightBlue: link,
    brightMagenta: readToken("--dept-8", "#e879c8"),
    brightCyan: readToken("--dept-6", "#4fd1c5"),
    brightWhite: fg,
  };
}

/** True when the new list is not an append-only extension of what was written (replay / rewind). */
export function needsReplay(written: readonly StdoutChunk[], next: readonly StdoutChunk[]): boolean {
  if (next.length < written.length) return true;
  for (let i = 0; i < written.length; i++) {
    const a = written[i];
    const b = next[i];
    if (!b || a !== b) return a?.at !== b?.at || a?.text !== b?.text;
  }
  return false;
}

function toTerminalText(chunk: StdoutChunk): string {
  const text = chunk.text.replace(/\r?\n/g, "\r\n");
  return chunk.channel === "stderr" ? `\u001b[31m${text}\u001b[0m` : text;
}

/**
 * Terminal body of an AgentTile: xterm 6 on `bg-ink` (JetBrains Mono 12/18), fit on resize, incremental writes and
 * replay from the top when the chunk list rewinds (session scrubber). Falls back to a plain `<pre>` when asked or when
 * no DOM is available.
 */
export function TerminalView({ chunks, label, renderer, follow = true, className, style, agentName, live, brief, compact }: TerminalViewProps) {
  const useXterm = renderer ? renderer === "xterm" : typeof window !== "undefined";
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<XFitAddon | null>(null);
  const writtenRef = useRef<StdoutChunk[]>([]);
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const followRef = useRef(follow);
  followRef.current = follow;

  // Create the terminal once the host exists; dispose on unmount.
  useEffect(() => {
    if (!useXterm) return;
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let term: XTerminal | null = null;
    let fit: XFitAddon | null = null;
    let observer: ResizeObserver | null = null;
    let raf = 0;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;
      term = new Terminal({
        convertEol: true,
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: "underline",
        cursorInactiveStyle: "none",
        fontFamily: readToken("--font-mono", '"JetBrains Mono", ui-monospace, monospace'),
        fontSize: 12,
        lineHeight: 1.5,
        scrollback: 5000,
        theme: terminalTheme(),
        allowTransparency: false,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      termRef.current = term;
      fitRef.current = fit;
      try {
        fit.fit();
      } catch {
        // happy-dom and zero-size hosts have no layout to fit to.
      }
      for (const c of chunksRef.current) term.write(toTerminalText(c));
      writtenRef.current = chunksRef.current.slice();
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            try {
              fit?.fit();
            } catch {
              // ignore: fit is best effort while the tile is hidden
            }
          });
        });
        observer.observe(host);
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      term?.dispose();
      termRef.current = null;
      fitRef.current = null;
      writtenRef.current = [];
    };
  }, [useXterm]);

  // Incremental writes and replay.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const written = writtenRef.current;
    if (needsReplay(written, chunks)) {
      term.reset();
      for (const c of chunks) term.write(toTerminalText(c));
    } else {
      for (let i = written.length; i < chunks.length; i++) term.write(toTerminalText(chunks[i] as StdoutChunk));
    }
    writtenRef.current = chunks.slice();
    if (followRef.current) term.scrollToBottom();
  }, [chunks]);

  const empty = chunks.length === 0 ? <TerminalEmpty agentName={agentName} live={live} brief={brief} compact={compact} /> : null;

  if (!useXterm) {
    if (empty) {
      return (
        <div role="log" aria-label={label} aria-live="polite" data-renderer="plain" className={cn("terminal-well relative h-full min-h-0", className)} style={style}>
          {empty}
        </div>
      );
    }
    return (
      <pre
        role="log"
        aria-label={label}
        aria-live="polite"
        data-renderer="plain"
        data-scroll-region="terminal"
        className={cn("terminal-well m-0 h-full min-h-0 overflow-auto px-3 py-2 font-mono text-mono text-primary whitespace-pre-wrap", className)}
        style={style}
      >
        {chunks.map((c, i) => (
          <span key={`${c.at}-${i}`} data-channel={c.channel} className={c.channel === "stderr" ? "text-status-bad" : undefined}>
            {c.text}
          </span>
        ))}
      </pre>
    );
  }

  return (
    <div className={cn("terminal-well relative h-full min-h-0 w-full", className)} style={style} data-scroll-region="terminal">
      <div ref={hostRef} role="log" aria-label={label} data-renderer="xterm" className="dugout-terminal h-full min-h-0 w-full overflow-hidden px-2 py-1.5 [&_.xterm]:h-full [&_.xterm-viewport]:bg-ink!" />
      {empty}
    </div>
  );
}
