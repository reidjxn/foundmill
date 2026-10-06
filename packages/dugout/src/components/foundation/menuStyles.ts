/** Shared classes for DropdownMenu and ContextMenu so both menus look identical. */
export const menuContentClass =
  "surface-overlay z-50 min-w-44 overflow-hidden p-1 text-body text-primary data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out";
export const menuItemClass =
  "relative flex h-row-compact cursor-default select-none items-center gap-2 rounded-chip px-2 text-body text-primary outline-none " +
  "data-highlighted:bg-white/4 data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=danger]:text-status-bad";
export const menuCheckItemClass = `${menuItemClass} pl-7`;
export const menuLabelClass = "t-label px-2 pb-1 pt-1.5";
export const menuSeparatorClass = "-mx-1 my-1 h-px bg-subtle";
export const menuShortcutClass = "ml-auto pl-4 font-mono text-mono text-secondary";
export const menuSubTriggerClass = `${menuItemClass} data-[state=open]:bg-white/4`;
export const menuIndicatorClass = "absolute left-2 inline-flex items-center justify-center text-link";
