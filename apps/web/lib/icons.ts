/** Lucide icon lookup by the kebab-case name stored on department rows (`departments.icon`, default "folder"). */
import { Folder, icons, type LucideIcon } from "lucide-react";

export function pascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

export function iconByName(name: string | null | undefined, fallback: LucideIcon = Folder): LucideIcon {
  if (!name) return fallback;
  const key = pascalCase(name) as keyof typeof icons;
  return (icons[key] as LucideIcon | undefined) ?? fallback;
}
