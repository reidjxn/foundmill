import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetterModelsPrompt } from "./BetterModelsPrompt";
import { ModelPicker } from "./ModelPicker";
import type { ModelOption } from "./types";

const money = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const options: ModelOption[] = [
  { key: "opus", label: "Opus", description: "Deep.", skillDelta: null, wageDelta: money(900), gated: true },
  { key: "haiku", label: "Haiku 5.5", description: "Cheap.", skillDelta: null, wageDelta: money(-100) },
  { key: "glm", label: "GLM-5.3 Flash", description: "Free plan.", skillDelta: null, wageDelta: money(-150) },
];

describe("ModelPicker on the free plan (WP-13 T7)", () => {
  it("a gated option is grayed but still selectable: choosing it calls onChange", async () => {
    const onChange = vi.fn();
    render(<ModelPicker options={options} value="glm" inUse="glm" onChange={onChange} />);
    const opus = screen.getByRole("radio", { name: /Opus/ });
    expect((opus as HTMLInputElement).disabled).toBe(false);
    expect(opus.closest("label")?.hasAttribute("data-gated")).toBe(true);
    await userEvent.click(opus);
    expect(onChange).toHaveBeenCalledWith("opus");
  });

  it("a stored Opus reads 'After you upgrade' and the model the team runs on reads 'In use'", () => {
    render(<ModelPicker options={options} value="opus" inUse="glm" onChange={() => undefined} />);
    expect(screen.getByText("After you upgrade")).toBeTruthy();
    expect(screen.getByText("In use")).toBeTruthy();
    expect(screen.queryByText("Current")).toBeNull();
  });

  it("the current model reads 'Current' when it is the one in use", () => {
    render(<ModelPicker options={options} value="glm" inUse="glm" onChange={() => undefined} />);
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.queryByText("In use")).toBeNull();
  });
});

describe("BetterModelsPrompt", () => {
  it("offers plans, the founder's own key, or not now", async () => {
    const onOpenChange = vi.fn();
    const onSeePlans = vi.fn();
    const onConnectKey = vi.fn();
    render(<BetterModelsPrompt open onOpenChange={onOpenChange} onSeePlans={onSeePlans} onConnectKey={onConnectKey} />);
    expect(screen.getByText("Better models come with a plan")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "See plans" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect your Anthropic key" }));
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSeePlans).toHaveBeenCalledOnce();
    expect(onConnectKey).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
