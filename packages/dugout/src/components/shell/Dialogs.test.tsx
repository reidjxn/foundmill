import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DECISION_TYPES } from "@foundmill/shared";
import { ApplyScopeDialog, applyScopeCopy } from "./ApplyScopeDialog";
import { DEFAULT_WAKE_EVENTS, HolidayDialog, defaultAuthority, parseMajor, validateHolidaySettings, type HolidaySettings } from "./HolidayDialog";
import { KeyboardHelp, groupShortcuts } from "./KeyboardHelp";
import { shortcutList } from "./keyboard";
import { DEPARTMENTS_FOR_KEYS } from "./fixtures";
import { ProfileHeader } from "./ProfileHeader";
import { Avatar } from "../foundation/Avatar";

const today = new Date("2026-10-07T10:00:00");

describe("HolidayDialog logic", () => {
  it("defaults authority to every non-gated decision type", () => {
    const a = defaultAuthority();
    expect(a).not.toContain("sign_contracts");
    expect(a.length).toBe(DECISION_TYPES.length - 1);
  });
  it("validates until and the budget ceiling", () => {
    const base: HolidaySettings = { until: { kind: "return" }, authority: defaultAuthority(), budgetCeiling: null, wakeEvents: [...DEFAULT_WAKE_EVENTS] };
    expect(validateHolidaySettings(base, today)).toEqual({});
    expect(validateHolidaySettings({ ...base, until: { kind: "date", date: "" } }, today).until).toMatch(/Choose/);
    expect(validateHolidaySettings({ ...base, until: { kind: "date", date: "2026-10-01" } }, today).until).toMatch(/past/);
    expect(validateHolidaySettings({ ...base, until: { kind: "date", date: "2026-10-07" } }, today)).toEqual({});
    expect(validateHolidaySettings({ ...base, until: { kind: "condition", condition: "x" } }, today).until).toMatch(/condition/);
    expect(validateHolidaySettings({ ...base, budgetCeiling: { amountMinor: -1, currency: "EUR" } }, today).budget).toMatch(/zero or more/);
  });
  it("parses major units", () => {
    expect(parseMajor("")).toBeNull();
    expect(parseMajor("1,200.50")).toBe(120050);
    expect(parseMajor("abc")).toBeNull();
  });
});

describe("HolidayDialog", () => {
  it("blocks submit without a date, then submits the settings shape", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(<HolidayDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} today={today} currency="SEK" />);
    await user.click(screen.getByTestId("holiday-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/return date/);
    // Hard gates are locked.
    const sign = screen.getByRole("checkbox", { name: /Sign contracts/ });
    expect((sign as HTMLButtonElement).disabled).toBe(true);
    expect(sign.getAttribute("data-state")).toBe("unchecked");
    await user.click(screen.getByRole("checkbox", { name: "Merge to main" }));
    await user.click(screen.getByRole("checkbox", { name: "A customer is won" }));
    await user.type(screen.getByTestId("holiday-budget"), "2500");
    await user.click(screen.getByRole("radio", { name: /Until I return/ }));
    await user.click(screen.getByTestId("holiday-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const settings = onSubmit.mock.calls[0]?.[0] as HolidaySettings;
    expect(settings.until).toEqual({ kind: "return" });
    expect(settings.authority).not.toContain("merge_to_main");
    expect(settings.authority).not.toContain("sign_contracts");
    expect(settings.authority).toContain("publish_content");
    expect(settings.budgetCeiling).toEqual({ amountMinor: 250000, currency: "SEK" });
    expect(settings.wakeEvents).toEqual([...DEFAULT_WAKE_EVENTS, "customer_won"]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
  it("accepts a condition", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<HolidayDialog open onOpenChange={() => {}} onSubmit={onSubmit} today={today} currency="EUR" />);
    await user.click(screen.getByRole("radio", { name: /A condition/ }));
    await user.type(screen.getByTestId("holiday-condition"), "when the launch ships");
    await user.click(screen.getByTestId("holiday-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]?.[0].until).toEqual({ kind: "condition", condition: "when the launch ships" });
  });
});

describe("ApplyScopeDialog", () => {
  it("writes the three options with counts", () => {
    const ctx = { agentName: "Scout", agentType: "channel engine", typeCount: 4, allCount: 23 };
    expect(applyScopeCopy("agent", ctx).label).toBe("This agent only");
    expect(applyScopeCopy("type", ctx).label).toBe("Apply to all channel engine agents");
    expect(applyScopeCopy("type", ctx).description).toContain("4 agents");
    expect(applyScopeCopy("all", ctx).description).toContain("23");
  });
  it("applies the chosen scope", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onOpenChange = vi.fn();
    render(<ApplyScopeDialog open onOpenChange={onOpenChange} agentName="Scout" agentType="channel engine" typeCount={4} allCount={23} settingLabel="Model: Sonnet" onApply={onApply} />);
    expect(screen.getByRole("radio", { name: /This agent only/ }).getAttribute("data-state")).toBe("checked");
    await user.click(screen.getByRole("radio", { name: /Apply to all channel engine agents/ }));
    await user.click(screen.getByTestId("apply-scope-confirm"));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("type"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("KeyboardHelp", () => {
  it("lists every shortcut including department chords", () => {
    const groups = groupShortcuts(shortcutList(DEPARTMENTS_FOR_KEYS));
    expect(groups.map((g) => g.group)).toEqual(["Navigation", "Inbox", "Decisions", "Layout", "Help"]);
    render(<KeyboardHelp open onOpenChange={() => {}} departments={DEPARTMENTS_FOR_KEYS} />);
    const dialog = screen.getByTestId("keyboard-help");
    expect(dialog.textContent).toContain("Go to Formulation Lab");
    expect(dialog.textContent).toContain("Refresh Inbox");
    expect(dialog.querySelectorAll("kbd").length).toBeGreaterThan(20);
  });
});

describe("ProfileHeader", () => {
  it("renders name, chips, three facts at most, model chip and stars", () => {
    render(
      <ProfileHeader
        avatar={<Avatar name="Scout" size={64} agent={{ seed: "scout", dept: "dept-3" }} status="healthy" />}
        name="Scout"
        chips={[{ label: "Agent" }, { label: "Distribution lead", tone: "dept-3" }]}
        facts={[
          { label: "Rating", value: "14" },
          { label: "Tasks", value: "42" },
          { label: "Cost / month", value: "€120", provenance: "estimate" },
          { label: "Hidden", value: "no" },
        ]}
        model="claude-sonnet-5-5"
        stars={{ current: 3, potential: 4.5 }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Scout" })).toBeTruthy();
    expect(screen.getByText("Distribution lead")).toBeTruthy();
    expect(screen.getByTestId("profile-facts").querySelectorAll("dt").length).toBe(3);
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(screen.getByText("claude-sonnet-5-5")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Ability: 3 of 5, potential 4.5" })).toBeTruthy();
  });
});
