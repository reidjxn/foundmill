"use client";
/**
 * The panel's ghost "…" trigger. The menu behind it (Radix and its positioning) is its own chunk, fetched only once a
 * panel with a menu is on screen: pages whose panels have none (sign-in, the brand pages) never carry it. Until it
 * arrives the trigger is the same button, plain; a press then opens the menu as soon as it is in, and a focused
 * trigger keeps the focus when the menu's own button takes its place.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Ellipsis } from "lucide-react";
import { Icon } from "../foundation/Icon";
import type { PanelMenu } from "./Panel";
import type { PanelMenuDropdown as PanelMenuDropdownComponent } from "./PanelMenuDropdown";

let Dropdown: typeof PanelMenuDropdownComponent | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Fetch the menu's code (once; a failed fetch is tried again on the next call). Resolves when menus can open. */
export function preloadPanelMenu(): Promise<void> {
  loading ??= import("./PanelMenuDropdown").then(
    (m) => {
      Dropdown = m.PanelMenuDropdown;
      for (const l of listeners) l();
    },
    () => {
      loading = null;
    },
  );
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const loadedDropdown = () => Dropdown;
/** Server render and hydration: always the plain button, so both sides agree. */
const noDropdown = () => null;

const TRIGGER_CLASS =
  "inline-flex size-control-sm shrink-0 items-center justify-center rounded-sm text-tertiary outline-none transition-colors duration-hover ease-out hover:bg-white/5 hover:text-primary focus-visible:shadow-ring data-[state=open]:bg-white/8 data-[state=open]:text-primary";

export function PanelMenuButton({ menu }: { menu: PanelMenu }) {
  const Menu = useSyncExternalStore(subscribe, loadedDropdown, noDropdown);
  const [pressed, setPressed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    void preloadPanelMenu();
  }, []);
  useEffect(() => {
    // The plain button left the page while focused (removing it moved the focus to the body): hand it on.
    if (Menu && focused.current && (document.activeElement === null || document.activeElement === document.body)) button.current?.focus();
  }, [Menu]);

  if (!Menu) {
    return (
      <button
        ref={button}
        type="button"
        aria-label="Panel menu"
        aria-haspopup="menu"
        aria-expanded={false}
        className={TRIGGER_CLASS}
        onClick={() => {
          setPressed(true);
          void preloadPanelMenu();
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={(e) => {
          // A blur from the button being replaced (no longer in the page) is not the founder moving on.
          if (e.currentTarget.isConnected) focused.current = false;
        }}
      >
        <Icon icon={Ellipsis} />
      </button>
    );
  }
  return (
    <Menu
      menu={menu}
      defaultOpen={pressed}
      trigger={
        <button ref={button} type="button" aria-label="Panel menu" className={TRIGGER_CLASS}>
          <Icon icon={Ellipsis} />
        </button>
      }
    />
  );
}
