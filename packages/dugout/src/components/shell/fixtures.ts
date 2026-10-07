/**
 * Seeded demo data for shell stories and tests: Northwind Skincare (BUILD §17.2), a DTC skincare business with
 * six departments. Deterministic; no network. Not exported from the package barrel.
 */
import { Bot, BookOpen, Code2, Globe, Home, Inbox, KeyRound, Megaphone, PiggyBank, Scale, Settings, Trophy, Users, Users2, Wrench } from "lucide-react";
import type { DecisionOption } from "./DecisionBar";
import type { PaletteItem } from "./CommandPalette";
import type { Kit, ProcessingSegment, SidebarItem, TabItem } from "./types";

export const NORTHWIND_KIT: Kit = { primary: "#2B6CB0", secondary: "#FFFFFF" };
export const LEDGERLY_KIT: Kit = { primary: "#1F6F5F", secondary: "#E8C56B" };
export const FIXTURE_TODAY = new Date("2026-10-07T09:30:00Z");

export const NORTHWIND_SIDEBAR: SidebarItem[] = [
  { id: "home", label: "Home", icon: Home, href: "/b/northwind", group: "main", fixed: "home" },
  { id: "inbox", label: "Inbox", icon: Inbox, href: "/b/northwind/inbox", group: "main", fixed: "inbox", badge: 3, badgeTone: "bad" },
  { id: "d-product", label: "Product", icon: BookOpen, href: "/b/northwind/d/product/vision", group: "department", dept: "dept-1", badge: 1 },
  { id: "d-development", label: "Formulation Lab", icon: Code2, href: "/b/northwind/d/formulation-lab/training-ground", group: "department", dept: "dept-2", badge: 4 },
  { id: "d-distribution", label: "Distribution", icon: Megaphone, href: "/b/northwind/d/distribution/formation", group: "department", dept: "dept-3", badge: 2 },
  { id: "d-finance", label: "Finance", icon: PiggyBank, href: "/b/northwind/d/finance/overview", group: "department", dept: "dept-4" },
  { id: "d-team", label: "Team", icon: Users, href: "/b/northwind/d/team/squad", group: "department", dept: "dept-5" },
  { id: "d-legal", label: "Legal", icon: Scale, href: "/b/northwind/d/legal/entity", group: "department", dept: "dept-6" },
  { id: "d-operations", label: "Operations", icon: Wrench, href: "/b/northwind/d/operations/specialists", group: "department", dept: "dept-7", badge: 1 },
  { id: "crm", label: "CRM", icon: Users2, href: "/b/northwind/crm", group: "main", fixed: "crm" },
  { id: "network", label: "Network", icon: Globe, href: "/live/network", group: "live" },
  { id: "communities", label: "Communities", icon: Users2, href: "/live/communities", group: "live", badge: 2 },
  { id: "leaderboards", label: "Leaderboards", icon: Trophy, href: "/live/leaderboards", group: "live" },
  { id: "settings", label: "Settings", icon: Settings, href: "/b/northwind/settings", group: "foot" },
  { id: "key", label: "Anthropic key", icon: KeyRound, href: "/b/northwind/settings/keys", group: "foot" },
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
  { id: "formation", label: "Formation", href: "#formation" },
  { id: "channels", label: "Channels", href: "#channels", subViews: [{ id: "all", label: "All channels" }, { id: "paid", label: "Paid" }, { id: "organic", label: "Organic" }, { id: "partner", label: "Partners" }] },
  { id: "leads", label: "Leads", href: "#leads", badge: 12, subViews: [{ id: "new", label: "New this week" }, { id: "warm", label: "Warm" }, { id: "all", label: "All leads" }] },
  { id: "campaigns", label: "Campaigns", href: "#campaigns" },
  { id: "creative", label: "Creative", href: "#creative" },
  { id: "attribution", label: "Attribution", href: "#attribution" },
];

export const PALETTE_ITEMS: PaletteItem[] = [
  { id: "cmd-continue", kind: "command", label: "Continue", description: "Advance a business cycle", shortcut: ["Space"] },
  { id: "cmd-refresh", kind: "command", label: "Refresh Inbox", description: "One new note", shortcut: ["R"] },
  { id: "cmd-stop", kind: "command", label: "Stop all agents", description: "Kill switch" },
  { id: "cmd-holiday", kind: "command", label: "Go on holiday", description: "Hand the business to the Chief of Staff" },
  { id: "cmd-edit", kind: "command", label: "Edit layout", shortcut: ["E"] },
  { id: "scr-home", kind: "screen", label: "Home", href: "/b/northwind", shortcut: ["G", "H"] },
  { id: "scr-inbox", kind: "screen", label: "Inbox", href: "/b/northwind/inbox", shortcut: ["G", "I"] },
  { id: "scr-formation", kind: "screen", label: "Formation", description: "Distribution", dept: "dept-3", href: "/b/northwind/d/distribution/formation" },
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
  { id: "a-ledger", kind: "agent", label: "Ledger", description: "Finance lead · Opus", icon: Bot },
  { id: "a-forge", kind: "agent", label: "Forge", description: "Formulation Lab · backend worker", icon: Bot },
  { id: "t-reid", kind: "team_member", label: "Reid Jackson", description: "Founder" },
  { id: "c-dtc", kind: "community", label: "DTC founders", description: "1,204 members" },
];

export const RECENT_PALETTE_ITEMS: PaletteItem[] = [PALETTE_ITEMS[13] as PaletteItem, PALETTE_ITEMS[18] as PaletteItem, PALETTE_ITEMS[7] as PaletteItem];

export const REORDER_OPTIONS: DecisionOption[] = [
  { id: "a", label: "Reorder 2,000 units", recommended: true, consequence: "Meridian Labs ships in 12 days; stock covers 9 weeks at the current run rate.", cost: { amountMinor: 1840000, currency: "EUR" }, reversible: false },
  { id: "b", label: "Reorder 1,000 units", consequence: "Covers 4 weeks; unit cost rises 8 %.", cost: { amountMinor: 994000, currency: "EUR" }, reversible: false },
  { id: "c", label: "Ask for a quote first", consequence: "Scout requests a fresh quote; decide again in 2 days.", cost: null, reversible: true },
  { id: "d", label: "Pause the serum", consequence: "Hide the product and pause its campaigns until stock is planned.", cost: null, reversible: true },
];

export const DEPARTMENTS_FOR_KEYS = NORTHWIND_SIDEBAR.filter((it) => it.group === "department").map((it) => ({ id: it.id, name: it.label }));
