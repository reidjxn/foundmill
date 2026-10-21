"use client";
/**
 * Coach-mark targets outside the shell (a widget on Home, the Inbox panes, a module screen's explainer and table) do
 * not carry `data-coachmark` themselves yet: a tour stamps the attribute on the first element its selector finds, as
 * the Inbox's reading pane does for the first-decision callout, and takes it off again when the tour unmounts. The
 * stamping follows the DOM (a MutationObserver, one pass per animation frame), so a widget that loads after the tour
 * mounted, or a table that renders once its data is in, is found as soon as it appears; the Coachmark's own observer
 * then sees the attribute and starts or moves on. An element that already carries another id, or a target that exists
 * natively somewhere else on the page, is left alone.
 */
import { useEffect } from "react";
import { findCoachmarkTarget } from "@foundmill/dugout";
import type { TourStamp } from "./definitions";

const ATTR = "data-coachmark";

/**
 * One pass: every stamp whose target is not on the page gets its attribute on the first element its selector finds.
 * `stamped` remembers what this pass set (by target id), so a later pass skips a stamp that still holds and forgets
 * one whose element left the page. Exported for tests.
 */
export function applyCoachmarkStamps(stamps: readonly TourStamp[], stamped: Map<string, HTMLElement>, root: ParentNode = document): void {
  for (const { targetId, selector } of stamps) {
    const held = stamped.get(targetId);
    if (held) {
      if (held.isConnected && held.getAttribute(ATTR) === targetId) continue;
      stamped.delete(targetId);
    }
    // The package carries it natively (or another stamp already placed it): nothing to add.
    if (findCoachmarkTarget(targetId)) continue;
    const el = root.querySelector<HTMLElement>(selector);
    if (!el || el.hasAttribute(ATTR)) continue;
    el.setAttribute(ATTR, targetId);
    stamped.set(targetId, el);
  }
}

/** Takes off every attribute a pass set (never one the element carried on its own). Exported for tests. */
export function removeCoachmarkStamps(stamped: Map<string, HTMLElement>): void {
  for (const [targetId, el] of stamped) if (el.getAttribute(ATTR) === targetId) el.removeAttribute(ATTR);
  stamped.clear();
}

/** Stamps the tour's targets while the component is mounted, following the DOM as it changes. */
export function useCoachmarkStamps(stamps: readonly TourStamp[]): void {
  useEffect(() => {
    if (typeof document === "undefined" || stamps.length === 0) return;
    const stamped = new Map<string, HTMLElement>();
    applyCoachmarkStamps(stamps, stamped);
    if (typeof MutationObserver === "undefined") return () => removeCoachmarkStamps(stamped);
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        applyCoachmarkStamps(stamps, stamped);
      });
    });
    // Only mounts and unmounts: the stamps themselves are attribute writes, which would otherwise wake this again.
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      removeCoachmarkStamps(stamped);
    };
  }, [stamps]);
}
