/** Custom metric: sentence → compile → preview → "Use this metric" (BUILD §11.2); rendering stays read-only. */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WidgetDataProvider } from "../data";
import { getWidget, parseWidgetSettings } from "../registry";
import { createFakeSource } from "../testing";
import "../widgets";
import { CustomMetricSettingsEditor, formatMetric, metricQueryInput, type CustomMetricSettings } from "../widgets/custom-metric";
import { BID, customMetric } from "./fixtures";

/** A figure (dugout `Figure`) splits its currency, digits and decimals into spans; match the whole figure's text. */
function byFigure(text: string) {
  return screen.getByText((_, el) => !!el && el.hasAttribute("data-figure") && el.textContent === text);
}


const def = getWidget("custom_metric")!;
const base = parseWidgetSettings(def, {}) as CustomMetricSettings;

describe("custom metric settings editor", () => {
  it("compiles a sentence, previews the number and the SQL, and saves the compiled query on accept", async () => {
    const compiled = { queryId: null, sql: "select count(*) from v_customers where channel = 'seo'", label: "SEO customers", format: "integer" as const, provenance: "v_customers", estimate: null, preview: { value: 42, format: "integer" as const } };
    const onMutate = vi.fn(async () => compiled);
    const fake = createFakeSource({ businessId: BID, onMutate });
    const onChange = vi.fn();
    render(
      <WidgetDataProvider source={fake.source}>
        <CustomMetricSettingsEditor businessId={BID} value={{ ...base, mode: "sentence" }} onChange={onChange} />
      </WidgetDataProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paying customers who signed up/), { target: { value: "Paying customers from SEO" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Compile and preview/ }));
    });
    expect(fake.mutations).toEqual([{ path: "dashboard.compileMetric", input: { sentence: "Paying customers from SEO" } }]);
    expect(screen.getByLabelText("Compiled query").textContent).toContain("select count(*)");
    expect(screen.getByText("42")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this metric" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const saved = onChange.mock.calls[0]![0] as CustomMetricSettings;
    expect(saved.compiled).toEqual({ queryId: null, sql: compiled.sql, label: "SEO customers", format: "integer", provenance: "v_customers", estimate: null });
    expect(saved.sentence).toBe("Paying customers from SEO");
    expect(saved.label).toBe("SEO customers");
  });

  it("shows the server's rejection (non-SELECT, cross-tenant) instead of saving", async () => {
    const fake = createFakeSource({
      businessId: BID,
      onMutate: async () => {
        throw new Error("Only SELECT statements over business-scoped views are allowed");
      },
    });
    const onChange = vi.fn();
    render(
      <WidgetDataProvider source={fake.source}>
        <CustomMetricSettingsEditor businessId={BID} value={{ ...base, mode: "sentence" }} onChange={onChange} />
      </WidgetDataProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paying customers who signed up/), { target: { value: "delete everything" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Compile and preview/ }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Only SELECT");
    expect(screen.queryByRole("button", { name: "Use this metric" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews a named query through the read procedure", () => {
    const fake = createFakeSource({ businessId: BID, responses: { "dashboard.customMetric.get": customMetric } });
    const onChange = vi.fn();
    render(
      <WidgetDataProvider source={fake.source}>
        <CustomMetricSettingsEditor businessId={BID} value={{ ...base, mode: "query", queryId: "mrr" }} onChange={onChange} />
      </WidgetDataProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(fake.queried.get("dashboard.customMetric.get")).toEqual({ queryId: "mrr" });
    expect(byFigure("€1,250.00")).toBeTruthy();
  });
});

describe("custom metric widget", () => {
  it("sends the named query id or the compiled SQL, never the sentence", () => {
    expect(metricQueryInput({ ...base, mode: "query", queryId: "mrr" })).toEqual({ queryId: "mrr" });
    expect(metricQueryInput({ ...base, mode: "query" })).toBeNull();
    expect(metricQueryInput({ ...base, mode: "sentence", sentence: "x" })).toBeNull();
    expect(metricQueryInput({ ...base, mode: "sentence", sentence: "x", compiled: { queryId: null, sql: "select 1", label: "One", format: "integer" } })).toEqual({ sql: "select 1", queryId: undefined });
  });
  it("formats by the declared format", () => {
    expect(formatMetric(1234567, "compact", "USD")).toBe("1.2M");
    expect(formatMetric(0.1234, "percent", "USD")).toBe("12.3%");
    expect(formatMetric(12.5, "integer", "USD")).toBe("13");
    expect(formatMetric(4900, "money", "EUR")).toEqual({ amountMinor: 4900, currency: "EUR" });
    expect(formatMetric(null, "money", "USD")).toBe("—");
  });
  it("renders the compiled metric read-only with its estimate chip", () => {
    const fake = createFakeSource({ businessId: BID, responses: { "dashboard.customMetric.get": { ...customMetric, estimate: "estimate" } } });
    const Component = def.Component;
    render(
      <WidgetDataProvider source={fake.source}>
        <Component businessId={BID} instanceId="custom_metric-1" settings={{ ...base, mode: "sentence", sentence: "MRR", compiled: { queryId: null, sql: "select mrr from v_finance", label: "MRR", format: "money" } }} />
      </WidgetDataProvider>,
    );
    expect(fake.queried.get("dashboard.customMetric.get")).toEqual({ sql: "select mrr from v_finance", queryId: undefined });
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(byFigure("€1,250.00")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
