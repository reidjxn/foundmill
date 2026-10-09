/**
 * Shell links: one click is one navigation (the link navigates; the shell's onNavigate sees the click and does not push
 * again), and a link prefetches its route once the founder shows intent (pointer, focus or touch), not on mere sight.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const prefetchSeen: unknown[] = [];

vi.mock("next/link", () => ({
  default: ({ prefetch, href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean | null; href: string; children: ReactNode }) => {
    prefetchSeen.push(prefetch);
    return (
      <a href={href} data-prefetch={prefetch === null ? "default" : String(prefetch)} {...rest}>
        {children}
      </a>
    );
  },
}));

const { isShellLinkClick, renderNextShellLink } = await import("../NextShellLink");

describe("shell links", () => {
  it("marks the link's own click so the shell does not push the route again", () => {
    const seen: boolean[] = [];
    render(<>{renderNextShellLink({ href: "/b/x/inbox", children: "Inbox", onClick: () => seen.push(isShellLinkClick()) })}</>);
    fireEvent.click(screen.getByText("Inbox"));
    expect(seen).toEqual([true]);
    expect(isShellLinkClick()).toBe(false);
  });

  it("prefetches with Next's default once the pointer enters, focus lands or a touch starts", () => {
    for (const intent of ["mouseEnter", "focus", "touchStart"] as const) {
      const { unmount } = render(<>{renderNextShellLink({ href: `/b/x/${intent}`, children: intent })}</>);
      const link = screen.getByText(intent);
      expect(link.getAttribute("data-prefetch")).toBe("false");
      fireEvent[intent](link);
      expect(link.getAttribute("data-prefetch")).toBe("default");
      unmount();
    }
  });

  it("keeps the props Dugout passes (class, aria, keyboard handler)", () => {
    const onKeyDown = vi.fn();
    render(<>{renderNextShellLink({ href: "/b/x/crm", children: "CRM", className: "c", "aria-current": "page", tabIndex: -1, onKeyDown })}</>);
    const link = screen.getByText("CRM");
    expect(link.className).toBe("c");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(link, { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
