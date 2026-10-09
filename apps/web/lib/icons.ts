/**
 * Lucide icons looked up by the kebab-case name stored in data: department rows (`departments.icon`, default "folder",
 * seeded from the archetype defaults in packages/agents/src/archetypes.ts) and widget definitions (`icon` in
 * packages/widgets/src/widgets/*.tsx).
 *
 * This is a curated map on purpose. Lucide's `icons` object holds every icon (~1,600, about 180 KB gzipped) and put
 * all of them in every business page's bundle. A name missing here renders the fallback, so when new data names an
 * icon, add it below. Keys are the PascalCase of the stored name; "code-2" and "filter" are Lucide's old names for
 * CodeXml and Funnel (Lucide still exports `Code2` and `Filter` as aliases of those).
 */
import {
  Activity,
  Award,
  CodeXml,
  Factory,
  Folder,
  Funnel,
  Gauge,
  Inbox,
  Landmark,
  LayoutGrid,
  Lightbulb,
  ListOrdered,
  MapIcon,
  Megaphone,
  Radio,
  Route,
  Scale,
  Sigma,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICONS: Readonly<Record<string, LucideIcon>> = {
  // Departments (archetype defaults) and the column default.
  Folder,
  Lightbulb,
  Code2: CodeXml,
  Megaphone,
  Landmark,
  Users,
  Scale,
  Factory,
  // Widgets.
  Activity,
  Award,
  Filter: Funnel,
  Gauge,
  Inbox,
  LayoutGrid,
  ListOrdered,
  Map: MapIcon,
  Radio,
  Route,
  Sigma,
  TrendingUp,
  Trophy,
};

export function pascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

/** The curated icon for a stored name, or undefined when the name is empty or not in the map. */
export function lookupIcon(name: string | null | undefined): LucideIcon | undefined {
  if (!name) return undefined;
  const key = pascalCase(name);
  return Object.prototype.hasOwnProperty.call(ICONS, key) ? ICONS[key] : undefined;
}

export function iconByName(name: string | null | undefined, fallback: LucideIcon = Folder): LucideIcon {
  return lookupIcon(name) ?? fallback;
}
