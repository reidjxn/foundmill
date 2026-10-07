/** Module screens: built-in capability packs rendered as full-screen widgets on department tabs (BUILD §6.1, §6.3). */
import type { ComponentType } from "react";
import type { ModuleKey } from "@foundmill/shared";

export type ModuleScreenProps = {
  businessId: string;
  departmentId: string;
  /** Sub-view slug when a tab has a caret dropdown (BUILD §5.3 TabBar). */
  subView?: string;
};

export type ModuleScreen = {
  moduleKey: ModuleKey;
  tabSlug: string;
  title: string;
  /** Optional sub-views shown in the tab's caret dropdown. */
  subViews?: { slug: string; title: string }[];
  Component: ComponentType<ModuleScreenProps>;
};

export type ModuleDefinition = {
  key: ModuleKey;
  screens: ModuleScreen[];
};

const modules = new Map<ModuleKey, ModuleDefinition>();

export function registerModule(def: ModuleDefinition): void {
  modules.set(def.key, def);
}
export function getModule(key: ModuleKey): ModuleDefinition | undefined {
  return modules.get(key);
}
export function getModuleScreen(moduleKey: ModuleKey, tabSlug: string): ModuleScreen | undefined {
  return modules.get(moduleKey)?.screens.find((s) => s.tabSlug === tabSlug);
}
export function listModules(): ModuleDefinition[] {
  return [...modules.values()];
}
