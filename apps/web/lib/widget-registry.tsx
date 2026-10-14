"use client";
/**
 * Adapts @foundmill/widgets definitions (key, Component, zod settings) to Dugout's WidgetGrid registry entries
 * (render(ctx), declarative settings fields). Settings fields are derived from a zod object schema when its shape is
 * simple (boolean, number, string, enum); anything else keeps the widget's own SettingsComponent or no dialog.
 */
import { createElement } from "react";
import type { WidgetRegistryEntry, WidgetSettingField } from "@foundmill/dugout";
import { listWidgets, parseWidgetSettings, type AnyWidgetDefinition, type WidgetSurface } from "@foundmill/widgets";
import { WidgetInstanceProvider } from "@foundmill/widgets/shared/pin";
import { lookupIcon } from "./icons";

interface ZodLikeField {
  _zod?: { def?: { type?: string; innerType?: ZodLikeField; entries?: Record<string, string>; defaultValue?: unknown } };
}

function unwrap(field: ZodLikeField): ZodLikeField {
  let cur = field;
  for (let i = 0; i < 4; i += 1) {
    const def = cur._zod?.def;
    if (def?.innerType && (def.type === "default" || def.type === "optional" || def.type === "nullable")) cur = def.innerType;
    else break;
  }
  return cur;
}

function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Declarative settings fields from a zod object, when every field is simple; otherwise undefined. */
export function settingsFieldsFromSchema(schema: unknown): WidgetSettingField[] | undefined {
  const shape = (schema as { shape?: Record<string, ZodLikeField> } | undefined)?.shape;
  if (!shape || typeof shape !== "object") return undefined;
  const fields: WidgetSettingField[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    const f = unwrap(raw);
    const type = f._zod?.def?.type;
    const label = humanise(key);
    if (type === "boolean") fields.push({ key, label, kind: "boolean" });
    else if (type === "number") fields.push({ key, label, kind: "number" });
    else if (type === "string") fields.push({ key, label, kind: "text" });
    else if (type === "enum") {
      const entries = f._zod?.def?.entries ?? {};
      fields.push({ key, label, kind: "select", options: Object.values(entries).map((v) => ({ value: String(v), label: humanise(String(v)) })) });
    } else return undefined;
  }
  return fields.length ? fields : undefined;
}

/**
 * `pinnable`: the widget sits away from Home (a department screen), so its frame's caret menu offers Pin to Home with
 * the settings it shows (audit #394).
 */
export function toGridEntry(def: AnyWidgetDefinition, businessId: string, opts: { pinnable?: boolean } = {}): WidgetRegistryEntry {
  const s = def.defaultSize;
  const Icon = lookupIcon(def.icon);
  return {
    key: def.key,
    title: def.title,
    description: def.description,
    icon: Icon,
    defaultSize: { w: s.w, h: s.h },
    minSize: s.minW !== undefined || s.minH !== undefined ? { w: s.minW ?? 1, h: s.minH ?? 1 } : undefined,
    maxSize: s.maxW !== undefined || s.maxH !== undefined ? { w: s.maxW ?? 12, h: s.maxH ?? 200 } : undefined,
    settings: def.SettingsComponent ? undefined : settingsFieldsFromSchema(def.settingsSchema),
    defaultSettings: (def.defaultSettings ?? undefined) as Record<string, unknown> | undefined,
    single: def.single,
    hidden: def.liveOnly,
    // Every @foundmill/widgets widget renders inside WidgetFrame, which draws the panel and its header.
    framed: true,
    render: (ctx) => {
      const settings = parseWidgetSettings(def, ctx.settings);
      const widget = createElement(def.Component, { businessId, settings, instanceId: ctx.item.i, editing: ctx.editing });
      return opts.pinnable ? createElement(WidgetInstanceProvider, { value: { key: def.key, settings } }, widget) : widget;
    },
  };
}

export function gridRegistry(surface: WidgetSurface, businessId: string, live: boolean): WidgetRegistryEntry[] {
  // Home's widgets are already on Home; everywhere else a widget can be pinned there.
  return listWidgets(surface, live).map((def) => toGridEntry(def, businessId, { pinnable: surface !== "home" }));
}
