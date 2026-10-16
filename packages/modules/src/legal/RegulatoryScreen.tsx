"use client";
/**
 * Legal › Regulatory (BUILD §11.11, §15 "regulated-sector gates"): the sector gates (health, finance, legal
 * services, food, cosmetics, children's products) suggested from the business profile and confirmed by the founder,
 * each with a checklist. Choices and ticks are stored per business (`legal.regulatory.*`); every open gate goes into
 * the team's brief each cycle, which tells the team not to do the listed activities and to bring them to the founder
 * as decisions instead. Identity-bound steps are the founder's.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { Checkbox, Chip, KeyValueList, Label, Panel, StatusPill, Switch, cn, type StatusTone } from "@foundmill/dugout";
import { useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { SECTOR_GATES, SECTOR_KEYS, detectSectors, gateState, sectorSelection, type GateState, type SectorChoice, type SectorKey } from "./legal-data";
import { FounderOnlyChip, InformationNotice, InlineError, Screen, archetypeLabel, useAction } from "./shared";
import type { BusinessGetResponse, RegulatoryGateRow } from "./types";

const BUSINESS_INPUT: Record<string, unknown> = {};
const GATES_INPUT: Record<string, unknown> = {};
const REGION_WORD: Record<string, string> = { eu: "European Union", us: "United States" };

/** The same checklist items, in any order. */
function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

const GATE_PILL: Record<GateState, { tone: StatusTone; word: string }> = { open: { tone: "warn", word: "Gate open" }, clear: { tone: "good", word: "Cleared" }, not_applicable: { tone: "neutral", word: "Not applicable" } };

export function RegulatoryScreen({ businessId: _businessId }: ModuleScreenProps) {
  const business = useWidgetQuery<BusinessGetResponse>("business.get", BUSINESS_INPUT);
  const stored = useWidgetQuery<RegulatoryGateRow[]>("legal.regulatory.list", GATES_INPUT);
  const action = useAction();
  // What the founder just changed, shown at once while the save and the reload catch up.
  const [local, setLocal] = useState<Partial<Record<SectorKey, { applies?: boolean; done?: string[] }>>>({});

  const detected = useMemo(() => (business.data ? detectSectors({ name: business.data.business.name, archetype: business.data.business.archetype, glossary: business.data.business.glossary }) : []), [business.data]);
  const detectedKeys = useMemo(() => detected.map((d) => d.key), [detected]);
  // A sector without a stored choice follows the suggestion; the store wins, and this window's unsaved change wins over both.
  const choices = useMemo<SectorChoice[]>(() => {
    const byKey = new Map<string, SectorChoice>((stored.data ?? []).map((c) => [c.sector, { sector: c.sector, applies: c.applies, done: c.done }]));
    for (const [key, change] of Object.entries(local)) {
      const base = byKey.get(key);
      byKey.set(key, { sector: key, applies: change.applies ?? base?.applies ?? detectedKeys.includes(key as SectorKey), done: change.done ?? base?.done ?? [] });
    }
    return [...byKey.values()];
  }, [stored.data, local, detectedKeys]);
  const { selected: chosen, done } = useMemo(() => sectorSelection(choices, detectedKeys), [choices, detectedKeys]);

  // A change stays shown until the store's copy shows it: the save answers before the reload behind it lands.
  useEffect(() => {
    const rows = stored.data;
    if (!rows) return;
    setLocal((l) => {
      const shown = Object.keys(l).filter((key) => {
        const row = rows.find((c) => c.sector === key);
        const change = l[key as SectorKey]!;
        return row && (change.applies === undefined || change.applies === row.applies) && (change.done === undefined || sameItems(change.done, row.done));
      });
      if (!shown.length) return l;
      const rest = { ...l };
      for (const key of shown) delete rest[key as SectorKey];
      return rest;
    });
  }, [stored.data]);

  const save = async (key: SectorKey, change: { applies?: boolean; done?: string[] }) => {
    setLocal((l) => ({ ...l, [key]: { ...l[key], ...change } }));
    await action.run("legal.regulatory.set", { sector: key, ...change }, { key, then: () => stored.refetch() });
  };
  const toggle = (key: SectorKey, on: boolean) => void save(key, { applies: on, done: [...(choices.find((c) => c.sector === key)?.done ?? [])] });
  const tick = (key: SectorKey, itemId: string, on: boolean) => {
    const current = new Set(choices.find((c) => c.sector === key)?.done ?? []);
    if (on) current.add(itemId);
    else current.delete(itemId);
    void save(key, { applies: chosen.has(key), done: [...current] });
  };

  const openGates = SECTOR_KEYS.filter((k) => gateState(k, chosen, done) === "open");
  const blocked = openGates.flatMap((k) => SECTOR_GATES[k].blocked.map((b) => ({ gate: SECTOR_GATES[k].label, text: b })));

  return (
    <Screen name="legal/regulatory">
      <Panel
        title="Sector gates"
        span={4}
        loading={business.isLoading || stored.isLoading}
        error={business.error ? business.error.message : stored.error ? stored.error.message : undefined}
        onRetry={business.error ? business.refetch : stored.refetch}
        actions={openGates.length ? <StatusPill tone="warn" icon={ShieldAlert}>{openGates.length} open</StatusPill> : <StatusPill tone="good" icon={ShieldCheck}>No open gates</StatusPill>}
        footer={<span>Suggested from the business name, archetype and glossary; you confirm. Acceptable-use screening ran at Commit; a gate here adds the sector's checklist on top.</span>}
      >
        <InlineError error={action.error} className="mb-2" />
        <ul aria-label="Sectors" className="flex flex-col gap-2">
          {SECTOR_KEYS.map((key) => {
            const gate = SECTOR_GATES[key];
            const on = chosen.has(key);
            const hit = detected.find((d) => d.key === key);
            const state = gateState(key, chosen, done);
            const switchId = `sector-${key}`;
            return (
              <li key={key} className={cn("flex items-start gap-3 rounded-panel border p-2", on ? "border-subtle bg-panel-alt" : "border-subtle")}>
                <Switch id={switchId} checked={on} onCheckedChange={(v) => toggle(key, v === true)} aria-label={gate.label} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/* The switch says whether the sector applies; a gate that is on carries its state beside the name. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={switchId} className={cn("t-body-strong", on ? "text-primary" : "text-secondary")}>
                      {gate.label}
                    </Label>
                    {on ? (
                      <StatusPill tone={GATE_PILL[state].tone} icon={state === "clear" ? ShieldCheck : ShieldAlert} className="whitespace-nowrap">
                        {GATE_PILL[state].word}
                      </StatusPill>
                    ) : null}
                  </div>
                  <p className="t-small text-secondary">{gate.summary}</p>
                  {hit ? (
                    <p className="t-small text-secondary">
                      <Chip tone="info" className="mr-1.5 whitespace-nowrap">
                        Suggested
                      </Chip>
                      Why: {hit.reasons.join("; ")}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="While a gate is open" span={8} empty={blocked.length === 0 ? { icon: ShieldCheck, children: "No regulated-sector gate is open. The team works under the platform's standard hard gates only." } : undefined} footer={<span>Every open gate goes into the team's brief each cycle: the team is told not to do these and to bring them to you as decisions instead. Your choices here are saved for the business.</span>}>
        <ul aria-label="Blocked activities" className="flex flex-col gap-1">
          {blocked.map((b, i) => (
            <li key={`${b.gate}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ShieldOff size={14} aria-hidden className="shrink-0 text-status-warn" />
              <span className="min-w-0 t-body text-primary">{b.text}</span>
              <Chip tone="neutral" className="whitespace-nowrap">
                {b.gate}
              </Chip>
            </li>
          ))}
        </ul>
      </Panel>

      {SECTOR_KEYS.filter((k) => chosen.has(k)).map((key) => {
        const gate = SECTOR_GATES[key];
        const state = gateState(key, chosen, done);
        const doneCount = gate.checklist.filter((i) => done.has(`${key}:${i.id}`)).length;
        return (
          <Panel key={key} title={`${gate.label} checklist`} meta={`${doneCount} of ${gate.checklist.length} done`} span={6} actions={<StatusPill tone={GATE_PILL[state].tone} icon={state === "clear" ? ShieldCheck : ShieldAlert} className="whitespace-nowrap">{GATE_PILL[state].word}</StatusPill>} footer={<span>Founder steps are yours; the team prepares the rest.</span>}>
            <ul aria-label={`${gate.label} checklist`} className="flex flex-col gap-2">
              {gate.checklist.map((item) => {
                const itemId = `${key}:${item.id}`;
                const checked = done.has(itemId);
                return (
                  <li key={item.id} className="flex items-start gap-2">
                    <Checkbox id={itemId} checked={checked} onCheckedChange={(v) => tick(key, item.id, v === true)} aria-label={item.title} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Label htmlFor={itemId} className={cn("t-body-strong", checked ? "text-secondary line-through" : "text-primary")}>
                          {item.title}
                        </Label>
                        {item.owner === "founder" ? <FounderOnlyChip /> : <Chip tone="neutral" className="whitespace-nowrap">Team prepares</Chip>}
                      </div>
                      <p className="t-small text-secondary">{item.detail}</p>
                    </div>
                    {checked ? <Check size={14} aria-hidden className="text-status-good" /> : null}
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}

      <Panel title="Business profile" span={12} loading={business.isLoading}>
        <KeyValueList
          aria-label="Profile facts"
          dense
          layout="grid"
          items={[
            { label: "Business", value: business.data?.business.name ?? "—" },
            { label: "Archetype", value: business.data?.business.archetype ? archetypeLabel(business.data.business.archetype) : "—" },
            { label: "Data region", value: business.data?.business.region ? (REGION_WORD[business.data.business.region] ?? business.data.business.region.toUpperCase()) : "—" },
            { label: "Gates", value: `${SECTOR_KEYS.filter((k) => chosen.has(k)).length} selected · ${openGates.length} open` },
          ]}
        />
        <InformationNotice className="mt-2">regulated sectors need a licensed professional's confirmation</InformationNotice>
      </Panel>
    </Screen>
  );
}
