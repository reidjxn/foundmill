/**
 * Shared classes for DropdownMenu, ContextMenu and the Select list, so every menu looks identical (DESIGN §3, §7):
 * glass on r-lg with elev-2, scaling .98 → 1 from its trigger as it fades in; 32 px items on a 6 px radius with an 8 %
 * highlight (12 % red for danger); a chevron that moves while its menu is open (sub-menus nudge right, triggers turn).
 */
export const menuContentClass = "surface-popover overlay-motion z-50 min-w-44 overflow-hidden p-1.5 text-body text-primary";
export const menuItemClass =
  "group/item relative flex h-control-md cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 text-body text-primary outline-none " +
  "data-highlighted:bg-white/8 data-disabled:pointer-events-none data-disabled:text-disabled " +
  "data-[variant=danger]:text-status-bad data-[variant=danger]:data-highlighted:bg-status-bad/12";
export const menuCheckItemClass = `${menuItemClass} pl-8`;
export const menuLabelClass = "t-label px-2.5 pb-1 pt-2 text-tertiary";
export const menuSeparatorClass = "-mx-1.5 my-1.5 h-px bg-line";
export const menuShortcutClass = "ml-auto pl-4 t-micro text-tertiary group-data-highlighted/item:text-secondary";
export const menuSubTriggerClass = `${menuItemClass} group/sub data-[state=open]:bg-white/8`;
export const menuIndicatorClass = "absolute left-2.5 inline-flex items-center justify-center text-accent";
/** The sub-menu chevron: nudges towards its sub-menu while it is open. */
export const menuSubChevronClass =
  "ml-auto text-tertiary transition-transform duration-overlay ease-out group-data-[state=open]/sub:translate-x-0.5 group-data-[state=open]/sub:text-primary";
/**
 * A trigger's chevron that turns over while its menu or list is open: put `group/trigger` on the trigger (a Button or
 * the child of a DropdownMenuTrigger) and this on its ChevronDown. Reduced motion: it flips at once.
 */
export const triggerChevronClass = "transition-transform duration-overlay ease-out group-data-[state=open]/trigger:rotate-180";
