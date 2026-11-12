"use client";
/**
 * Opt-in browser notifications (retention plan, 2026-11-11): a desktop notification when a customer is won or a
 * goal is reached while Foundmill is open in a background tab. Only after the founder turned them on in Settings ›
 * Preferences › Email and the browser granted permission; never while the tab is in front (the app says it already).
 */
const supported = () => typeof window !== "undefined" && "Notification" in window;

export function browserNotificationsSupported(): boolean {
  return supported();
}

/** Asks the browser once; true when notifications may be shown. */
export async function requestBrowserNotifications(): Promise<boolean> {
  if (!supported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export interface WinNotice {
  title: string;
  body: string;
  /** Where a click on the notification goes (a business path). */
  href: string;
  tag: string;
}

/** The notice for a stream event worth a desktop notification, or null. */
export function winNoticeFor(event: { type: string; payload?: Record<string, unknown> }, business: { id: string; name: string }): WinNotice | null {
  if (event.type === "customer.converted" && event.payload?.kind === "payment") {
    return { title: `${business.name} won a customer`, body: "Open the Customer Update to see who was involved.", href: `/b/${business.id}/inbox`, tag: `win:${String(event.payload.conversionId ?? "")}` };
  }
  if (event.type === "goal.achieved") {
    return { title: `${business.name} reached its goal`, body: "Your team hit the goal you approved.", href: `/b/${business.id}/milestones`, tag: `goal:${String(event.payload?.goalId ?? "")}` };
  }
  return null;
}

/** Shows the notice when the tab is hidden and permission was granted; a click focuses the tab and opens the page. */
export function showWinNotice(notice: WinNotice, navigate: (href: string) => void): void {
  if (!supported() || Notification.permission !== "granted" || document.visibilityState === "visible") return;
  const n = new Notification(notice.title, { body: notice.body, tag: notice.tag, icon: "/icon.svg" });
  n.onclick = () => {
    window.focus();
    navigate(notice.href);
    n.close();
  };
}
