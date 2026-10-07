/**
 * Legal › Regulatory (BUILD §11.11, §15 "regulated-sector gates"): the sector gates (health, finance, legal
 * services, food, cosmetics, children's products) suggested from the business profile and confirmed by the founder,
 * each with a checklist. While a gate is open the squad does not perform the listed activities; identity-bound
 * steps are the founder's. Gate selections and ticks live in this window until the settings API carries them.
 */
import { useMemo, useState } from "react";
import { Check, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { Checkbox, Chip, KeyValueList, Label, Panel, StatusPill, Switch, cn, type StatusTone } from "@foundmill/dugout";
import { useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { SECTOR_GATES, SECTOR_KEYS, detectSectors, gateState, type GateState, type SectorKey } from "./legal-data";
import { FounderOnlyChip, InformationNotice, Screen, humanise } from "./shared";
import type { BusinessGetResponse } from "./types";

const BUSINESS_INPUT: Record<string, unknown> = {};

const GATE_PILL: Record<GateState, { tone: StatusTone; word: string }> = { open: { tone: "warn", word: "Gate open" }, clear: { tone: "good", word: "Cleared" }, not_applicable: { tone: "neutral", word: "Not applicable" } };

export function RegulatoryScreen({ businessId: _businessId }: ModuleScreenProps) {
  const business = useWidgetQuery<BusinessGetResponse>("business.get", BUSINESS_INPUT);
  const [selected, setSelected] = useState<Set<SectorKey> | null>(null);
  const [done, setDone] = useState<Set<string>>(() => new Set());

  const detected = useMemo(() => (business.data ? detectSectors({ name: business.data.business.name, archetype: business.data.business.archetype, glossary: business.data.business.glossary }) : []), [business.data]);
  const detectedKeys = useMemo(() => new Set(detected.map((d) => d.key)), [detected]);
  const chosen = selected ?? detectedKeys;
  const toggle = (key: SectorKey, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev ?? detectedKeys);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const tick = (id: string, on: boolean) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const openGates = SECTOR_KEYS.filter((k) => gateState(k, chosen, done) === "open");
  const blocked = openGates.flatMap((k) => SECTOR_GATES[k].blocked.map((b) => ({ gate: SECTOR_GATES[k].label, text: b })));

  return (
    <Screen name="legal/regulatory">
      <Panel
        title="Sector gates"
        span={4}
        loading={business.isLoading}
        error={business.error ? business.error.message : undefined}
        onRetry={business.refetch}
        actions={openGates.length ? <StatusPill tone="warn" icon={ShieldAlert}>{openGates.length} open</StatusPill> : <StatusPill tone="good" icon={ShieldCheck}>No open gates</StatusPill>}
        footer={<span>Suggested from the business name, archetype and glossary; you confirm. Acceptable-use screening ran at Commit; a gate here adds the sector's checklist on top.</span>}
      >
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
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={switchId} className="t-body-strong text-primary">
                      {gate.label}
                    </Label>
                    <StatusPill tone={GATE_PILL[state].tone}>{GATE_PILL[state].word}</StatusPill>
                    {hit ? <Chip tone="info">Suggested</Chip> : null}
                  </div>
                  <p className="t-small text-secondary">{gate.summary}</p>
                  {hit ? <p className="t-small text-secondary">Why: {hit.reasons.join("; ")}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="While a gate is open" span={8} empty={blocked.length === 0 ? { icon: ShieldCheck, children: "No regulated-sector gate is open. The squad works under the platform's standard hard gates only." } : undefined} footer={<span>The squad never performs these until the gate clears; the Chief of Staff routes them to you as decisions instead.</span>}>
        <ul aria-label="Blocked activities" className="flex flex-col gap-1">
          {blocked.map((b, i) => (
            <li key={`${b.gate}-${i}`} className="flex items-center gap-2">
              <ShieldOff size={14} aria-hidden className="text-status-warn" />
              <span className="t-body text-primary">{b.text}</span>
              <Chip tone="neutral">{b.gate}</Chip>
            </li>
          ))}
        </ul>
      </Panel>

      {SECTOR_KEYS.filter((k) => chosen.has(k)).map((key) => {
        const gate = SECTOR_GATES[key];
        const state = gateState(key, chosen, done);
        const doneCount = gate.checklist.filter((i) => done.has(`${key}:${i.id}`)).length;
        return (
          <Panel key={key} title={`${gate.label} checklist`} span={6} actions={<StatusPill tone={GATE_PILL[state].tone}>{GATE_PILL[state].word}</StatusPill>} footer={<span className="tabular-nums">{doneCount} of {gate.checklist.length} done · founder steps are yours; the squad prepares the rest</span>}>
            <ul aria-label={`${gate.label} checklist`} className="flex flex-col gap-2">
              {gate.checklist.map((item) => {
                const itemId = `${key}:${item.id}`;
                const checked = done.has(itemId);
                return (
                  <li key={item.id} className="flex items-start gap-2">
                    <Checkbox id={itemId} checked={checked} onCheckedChange={(v) => tick(itemId, v === true)} aria-label={item.title} />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={itemId} className={cn("t-body-strong", checked ? "text-secondary line-through" : "text-primary")}>
                        {item.title}
                      </Label>
                      {item.owner === "founder" ? <FounderOnlyChip className="ml-2" /> : <Chip tone="neutral" className="ml-2">Squad prepares</Chip>}
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
            { label: "Archetype", value: business.data?.business.archetype ? humanise(business.data.business.archetype) : "—" },
            { label: "Data region", value: business.data?.business.region ? business.data.business.region.toUpperCase() : "—" },
            { label: "Gates", value: `${SECTOR_KEYS.filter((k) => chosen.has(k)).length} selected · ${openGates.length} open` },
          ]}
        />
        <InformationNotice className="mt-2">regulated sectors need a licensed professional's confirmation</InformationNotice>
      </Panel>
    </Screen>
  );
}
