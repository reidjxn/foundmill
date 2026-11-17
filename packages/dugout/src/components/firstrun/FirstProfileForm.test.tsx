// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_PROFILE_WORDS, FirstProfileForm, addTag, type FirstProfileValues } from "./FirstProfileForm";

const OPTIONS = [
  { value: "on_my_own", label: "Building on my own" },
  { value: "open_to_people", label: "Open to building with people" },
];

function Harness({ askAdult, onSubmit }: { askAdult: boolean; onSubmit: (v: FirstProfileValues & { confirmAdult: boolean }) => void }) {
  const [values, setValues] = useState<FirstProfileValues>({ name: "Maya", strengths: [], lookingFor: "on_my_own" });
  return <FirstProfileForm values={values} onChange={setValues} strengthSuggestions={["Design", "Writing"]} lookingForQuestion="What are you here for?" lookingForOptions={OPTIONS} maxTags={2} maxTagLength={30} askAdult={askAdult} onSubmit={onSubmit} />;
}

afterEach(() => cleanup());

describe("FirstProfileForm", () => {
  it("waits for the box when it is asked, then submits with confirmAdult", () => {
    const onSubmit = vi.fn();
    render(<Harness askAdult onSubmit={onSubmit} />);
    act(() => void fireEvent.click(screen.getByTestId("first-profile-submit")));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(FIRST_PROFILE_WORDS.adultNeeded)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "I am 18 or older" }));
    act(() => void fireEvent.click(screen.getByTestId("first-profile-submit")));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Maya", strengths: [], lookingFor: "on_my_own", confirmAdult: true });
  });

  it("adds tags from suggestions and typing, up to the limit, and stops offering them when full", () => {
    const onSubmit = vi.fn();
    render(<Harness askAdult={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    const field = screen.getByLabelText(FIRST_PROFILE_WORDS.strengths);
    fireEvent.change(field, { target: { value: "design" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.change(field, { target: { value: "Baking" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Design", "Baking"]);
    expect(screen.queryByRole("button", { name: "Writing" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Open to building with people" }));
    act(() => void fireEvent.click(screen.getByTestId("first-profile-submit")));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Maya", strengths: ["Design", "Baking"], lookingFor: "open_to_people", confirmAdult: false });
  });

  it("addTag trims, cuts to length, refuses duplicates and a full list", () => {
    expect(addTag([], "  Design  ", 8, 30)).toEqual(["Design"]);
    expect(addTag(["Design"], "DESIGN", 8, 30)).toEqual(["Design"]);
    expect(addTag(["a", "b"], "c", 2, 30)).toEqual(["a", "b"]);
    expect(addTag([], "x".repeat(40), 8, 30)).toEqual(["x".repeat(30)]);
    expect(addTag([], "   ", 8, 30)).toEqual([]);
  });
});
