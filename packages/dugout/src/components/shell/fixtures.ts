/**
 * Seeded demo data for shell stories and tests: Northwind Skincare (BUILD §17.2), a DTC skincare business with
 * six departments. Deterministic; no network. Not exported from the package barrel.
 */
import { Bot, BookOpen, Compass, Globe, Home, Inbox, Medal, Megaphone, PiggyBank, Settings, Users, Users2, Wrench } from "lucide-react";
import { TERMS, type TermId } from "@foundmill/shared/terms";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import type { SwitcherBusiness } from "./BusinessSwitcher";
import type { DecisionOption } from "./DecisionBar";
import type { PaletteHelpItem, PaletteItem } from "./CommandPalette";
import type { Kit, ProcessingSegment, SidebarItem, TabItem } from "./types";

export const NORTHWIND_KIT: Kit = { primary: "#2B6CB0", secondary: "#FFFFFF" };
export const LEDGERLY_KIT: Kit = { primary: "#1F6F5F", secondary: "#E8C56B" };
export const FIXTURE_TODAY = new Date("2026-10-07T09:30:00Z");

/**
 * The founder-area sidebar (docs/DESIGN.md §8): Today, Needs you, the five areas (badges summed from their
 * departments), then a department with no modules ("Studio", its own item with its dot and letter), the LIVE block and
 * the foot.
 */
export const NORTHWIND_SIDEBAR: SidebarItem[] = [
  { id: "home", label: "Today", icon: Home, href: "/b/northwind/today", group: "main", fixed: "home" },
  { id: "inbox", label: "Needs you", icon: Inbox, href: "/b/northwind/inbox?tab=respond", group: "main", fixed: "inbox", badge: 3, badgeTone: "bad" },
  { id: "area-plan", label: "Plan", icon: Compass, href: "/b/northwind/d/product/roadmap", group: "area", area: "plan" },
  { id: "area-customers", label: "Customers", icon: Megaphone, href: "/b/northwind/d/distribution/leads", group: "area", area: "customers", badge: 2, hint: "leads, campaigns and contacts" },
  { id: "area-money", label: "Money", icon: PiggyBank, href: "/b/northwind/d/finance/overview", group: "area", area: "money" },
  { id: "area-product", label: "Product", icon: BookOpen, href: "/b/northwind/d/product/specification", group: "area", area: "product", badge: 6 },
  { id: "area-team", label: "Team", icon: Users, href: "/b/northwind/d/team/squad", group: "area", area: "team" },
  { id: "d-studio", label: "Studio", icon: Wrench, href: "/b/northwind/d/studio/notes", group: "department", dept: "dept-7", badge: 1 },
  { id: "network", label: "Network", icon: Globe, href: "/live/network", group: "live" },
  { id: "communities", label: "Communities", icon: Users2, href: "/live/communities", group: "live", badge: 2 },
  { id: "leaderboards", label: "Leaderboards", icon: Medal, href: "/live/leaderboards", group: "live" },
  { id: "settings", label: "Settings", icon: Settings, href: "/b/northwind/settings", group: "foot" },
];

export const NORTHWIND_SEGMENTS: ProcessingSegment[] = [
  { id: "d-product", label: "Product", dept: "dept-1", active: true },
  { id: "d-development", label: "Formulation Lab", dept: "dept-2", active: true, weight: 2 },
  { id: "d-distribution", label: "Distribution", dept: "dept-3", active: true },
  { id: "d-finance", label: "Finance", dept: "dept-4", active: false },
  { id: "d-team", label: "Team", dept: "dept-5", active: false },
  { id: "d-legal", label: "Legal", dept: "dept-6", active: false },
  { id: "d-operations", label: "Operations", dept: "dept-7", active: true },
];

export const DISTRIBUTION_TABS: TabItem[] = [
  { id: "formation", label: "Board", href: "#formation" },
  { id: "channels", label: "Channels", href: "#channels", subViews: [{ id: "all", label: "All channels" }, { id: "paid", label: "Paid" }, { id: "organic", label: "Organic" }, { id: "partner", label: "Partners" }] },
  { id: "leads", label: "Leads", href: "#leads", badge: 12, subViews: [{ id: "new", label: "New this week" }, { id: "warm", label: "Warm" }, { id: "all", label: "All leads" }] },
  { id: "campaigns", label: "Campaigns", href: "#campaigns" },
  { id: "creative", label: "Creative", href: "#creative" },
  { id: "attribution", label: "Customer sources", href: "#attribution" },
];

export const PALETTE_ITEMS: PaletteItem[] = [
  { id: "cmd-continue", kind: "command", label: "Continue", description: "Let the team work until nothing is left to do", shortcut: ["Space"] },
  { id: "cmd-refresh", kind: "command", label: "Refresh Inbox", description: "Ask the team for one quick note without starting new work", shortcut: ["R"] },
  { id: "cmd-stop", kind: "command", label: "Stop all agents", description: "Pause the whole team. An owner can resume." },
  // plain-allow: the palette's Help rows (HELP_PALETTE_ITEMS, from TERMS) define Chief of Staff in the same list.
  { id: "cmd-holiday", kind: "command", label: "Go on vacation", description: "Hand the business to the Chief of Staff" },
  { id: "cmd-edit", kind: "command", label: "Edit layout", shortcut: ["E"] },
  { id: "scr-home", kind: "screen", label: "Home", href: "/b/northwind", shortcut: ["G", "H"] },
  { id: "scr-inbox", kind: "screen", label: "Inbox", href: "/b/northwind/inbox", shortcut: ["G", "I"] },
  { id: "scr-formation", kind: "screen", label: "Board", description: "Distribution", dept: "dept-3", href: "/b/northwind/d/distribution/formation" },
  // plain-allow: the palette's Help rows (HELP_PALETTE_ITEMS, from TERMS) define Runway in the same list.
  { id: "scr-runway", kind: "screen", label: "Runway", description: "Finance", dept: "dept-4", href: "/b/northwind/d/finance/runway" },
  { id: "dept-product", kind: "department", label: "Product", description: "Product", dept: "dept-1", href: "/b/northwind/d/product/vision" },
  { id: "dept-lab", kind: "department", label: "Formulation Lab", description: "Formulation Lab", dept: "dept-2", href: "/b/northwind/d/formulation-lab/training-ground", keywords: ["development"] },
  { id: "inbox-1", kind: "inbox", label: "Approve the retinol serum reorder", description: "Decision · Operations · 2 h ago" },
  { id: "inbox-2", kind: "inbox", label: "Meridian Labs replied about the bundle", description: "Update · Distribution · yesterday" },
  { id: "p-sara", kind: "person", label: "Sara Lindqvist", description: "Head of buying · Nordic Beauty AB", keywords: ["lindqvist", "nordic"] },
  { id: "p-tomas", kind: "person", label: "Tomas Berg", description: "Founder · Meridian Labs" },
  { id: "p-amara", kind: "person", label: "Amara Okafor", description: "Influencer · 42k followers", public: true },
  { id: "o-nordic", kind: "organisation", label: "Nordic Beauty AB", description: "Retailer · Stockholm", keywords: ["retailer"] },
  { id: "o-meridian", kind: "organisation", label: "Meridian Labs", description: "Contract manufacturer · Malmö" },
  { id: "a-scout", kind: "agent", label: "Scout", description: "Distribution lead · Sonnet", icon: Bot },
  // plain-allow: "Ledger" here is the Finance lead's name, not the word.
  { id: "a-ledger", kind: "agent", label: "Ledger", description: "Finance lead · Opus", icon: Bot },
  { id: "a-forge", kind: "agent", label: "Forge", description: "Formulation Lab · backend worker", icon: Bot },
  { id: "t-reid", kind: "team_member", label: "Reid Jackson", description: "Founder" },
  { id: "c-dtc", kind: "community", label: "DTC founders", description: "1,204 members" },
];

export const RECENT_PALETTE_ITEMS: PaletteItem[] = [PALETTE_ITEMS[13] as PaletteItem, PALETTE_ITEMS[18] as PaletteItem, PALETTE_ITEMS[7] as PaletteItem];

/** A few Help rows, built from `TERMS` the way the app builds them (apps/web/lib/search.ts); the keyboard shortcuts row is the shell's own. */
const HELP_HREFS = {
  runway: "/b/northwind/d/finance/runway",
  burn: "/b/northwind/d/finance/overview",
  cycle: "/b/northwind/home",
  estimate: undefined,
  chief_of_staff: "/b/northwind/d/team/squad",
} as const satisfies Partial<Record<TermId, string | undefined>>;

export const HELP_PALETTE_ITEMS: PaletteHelpItem[] = (Object.keys(HELP_HREFS) as Array<keyof typeof HELP_HREFS>).map((id) => {
  const def = TERMS[id];
  const href = HELP_HREFS[id];
  // The Estimate row has no page, so the palette shows its longer explanation in place.
  return { id: `help:${id}`, title: def.word, line: def.short, ...(href ? { href } : { long: def.long }) };
});

export const REORDER_OPTIONS: DecisionOption[] = [
  { id: "a", label: "Reorder 2,000 units", recommended: true, consequence: "Meridian Labs ships in 12 days; stock covers 9 weeks at the current run rate.", cost: { amountMinor: 1840000, currency: "EUR" }, reversible: false },
  { id: "b", label: "Reorder 1,000 units", consequence: "Covers 4 weeks; unit cost rises 8%.", cost: { amountMinor: 994000, currency: "EUR" }, reversible: false },
  { id: "c", label: "Ask for a quote first", consequence: "Scout requests a fresh quote; decide again in 2 days.", cost: null, reversible: true },
  { id: "d", label: "Pause the serum", consequence: "Hide the product and pause its campaigns until stock is planned.", cost: null, reversible: true },
];

/** Northwind's departments by name, for the letter rule (stored department letters; the shell gives letters only to module-less ones). */
export const DEPARTMENTS_FOR_KEYS = [
  { id: "d-product", name: "Product" },
  { id: "d-development", name: "Formulation Lab" },
  { id: "d-distribution", name: "Distribution" },
  { id: "d-finance", name: "Finance" },
  { id: "d-team", name: "Team" },
  { id: "d-legal", name: "Legal" },
  { id: "d-operations", name: "Operations" },
];

/** The areas Northwind's sidebar shows, in order. */
export const AREAS_FOR_KEYS = ["plan", "customers", "money", "product", "team"] as const;

/**
 * Northwind's Product area tab bar (docs/DESIGN.md §9): Product's and the two development departments' tabs, three
 * inline and the rest behind "More detail"; Formulation Lab's first tab is promoted so the department shows.
 */
export const PRODUCT_AREA_TABS: TabItem[] = [
  { id: "product/vision", label: "Vision", href: "#vision", tier: "detail" },
  { id: "product/specification", label: "Specification", href: "#specification" },
  { id: "product/changes", label: "Changes", href: "#changes", tier: "detail" },
  { id: "product/sources", label: "Sources", href: "#sources", tier: "detail" },
  { id: "product/research", label: "Research", href: "#research", tier: "detail" },
  { id: "development/training-ground", label: "Working now", href: "#working-now", tier: "detail" },
  { id: "development/plan", label: "Work list · Development", href: "#work-list", tier: "detail" },
  { id: "development/pull-requests", label: "What changed", href: "#what-changed", badge: 2 },
  { id: "development/environments", label: "Live product", href: "#live-product" },
  { id: "development/specialists", label: "Specialists · Development", href: "#specialists-dev", tier: "detail" },
  { id: "operations/specialists", label: "Specialists · Formulation Lab", href: "#specialists-lab" },
  { id: "operations/plan", label: "Work list · Formulation Lab", href: "#work-list-lab", tier: "detail" },
];

/** The founder's businesses in the top bar's Switch business: Northwind is open (logo), Ledgerly a demo, Tutorlane as an admin. */
export const SWITCHER_BUSINESSES: SwitcherBusiness[] = [
  { id: "nw", name: "Northwind Skincare", current: true, logoSrc: SAMPLE_LOGOS.stack, primary: NORTHWIND_KIT.primary },
  { id: "lg", name: "Ledgerly", logoSrc: SAMPLE_LOGOS.orbit, primary: LEDGERLY_KIT.primary, demo: true },
  { id: "tl", name: "Tutorlane", primary: "#7A3B8F", roleLabel: "Admin" },
];

/** Enough businesses for the filter field ("Find a business…"). */
export const MANY_SWITCHER_BUSINESSES: SwitcherBusiness[] = [
  ...SWITCHER_BUSINESSES,
  { id: "ac", name: "Aurora Candles", primary: "#F5B841" },
  { id: "bk", name: "Brightkeel Labs", primary: "#1F6F5F", roleLabel: "Member" },
  { id: "fm", name: "Fieldmouse Farms", logoSrc: SAMPLE_LOGOS.fold, primary: "#7A3B8F" },
  { id: "ob", name: "Orbit Bikes", primary: "#2B6CB0", roleLabel: "Viewer" },
  { id: "pq", name: "Pequod Coffee", primary: "#8C5A2B" },
  { id: "sw", name: "Swiftledger Payroll", primary: "#0F1318", roleLabel: "Advisor" },
];
