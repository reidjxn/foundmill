import { describe, expect, it } from "vitest";
import { businessFields, businessSavePayload, changedFields, initialBusinessForm, rebaseBusinessForm } from "../business-form";

const server = businessFields({ name: "Resilience Beta", slug: "resilience-beta", archetype: "b2b_saas", kitPrimary: "#1f6f5f", kitSecondary: "#e8c56b", currency: "USD" });

describe("Settings › Business form (audit RES-07, RUI-08: a color save wrote the old name back)", () => {
  it("a color-only change sends only the color, with the color it was changed from", () => {
    const state = initialBusinessForm(server);
    state.form.kitPrimary = "#3366ff";
    expect(changedFields(state)).toEqual(["kitPrimary"]);
    expect(businessSavePayload(state)).toEqual({ changes: { kitPrimary: "#3366ff" }, expected: { kitPrimary: "#1f6f5f" } });
  });

  it("untouched fields follow the server copy when it changes, and a touched one keeps the edit and its base", () => {
    let state = initialBusinessForm(server);
    state.form.kitPrimary = "#3366ff";
    // Another tab renamed the business and changed the secondary color.
    state = rebaseBusinessForm(state, { ...server, name: "Resilience Beta Renamed", kitSecondary: "#000000" });
    expect(state.form.name).toBe("Resilience Beta Renamed");
    expect(state.form.kitSecondary).toBe("#000000");
    expect(state.form.kitPrimary).toBe("#3366ff");
    // The save still sends only the primary color: the rename is never written back.
    expect(businessSavePayload(state)).toEqual({ changes: { kitPrimary: "#3366ff" }, expected: { kitPrimary: "#1f6f5f" } });
  });

  it("a touched field that someone else changed too is sent with the value the form saw, so the API can refuse it", () => {
    let state = initialBusinessForm(server);
    state.form.name = "My name";
    state = rebaseBusinessForm(state, { ...server, name: "Their name" });
    expect(state.form.name).toBe("My name");
    expect(businessSavePayload(state)).toEqual({ changes: { name: "My name" }, expected: { name: "Resilience Beta" } });
  });

  it("the name is compared and sent trimmed; nothing changed sends nothing", () => {
    const state = initialBusinessForm(server);
    state.form.name = "  Resilience Beta ";
    expect(changedFields(state)).toEqual([]);
    state.form.name = " Renamed ";
    expect(businessSavePayload(state).changes).toEqual({ name: "Renamed" });
  });
});
