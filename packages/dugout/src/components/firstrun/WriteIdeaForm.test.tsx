import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { WRITE_IDEA_WORDS, WriteIdeaForm, type WriteIdeaValues } from "./WriteIdeaForm";

function Controlled({ onSubmit, initial = { name: "", pitch: "" } }: { onSubmit: (v: WriteIdeaValues) => void; initial?: WriteIdeaValues }) {
  const [values, setValues] = useState(initial);
  return <WriteIdeaForm values={values} onChange={setValues} onSubmit={onSubmit} />;
}

describe("WriteIdeaForm (WP-04 T15)", () => {
  it("has the two fields and Shape it, and sends both trimmed", () => {
    const onSubmit = vi.fn();
    render(<Controlled onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(new RegExp(WRITE_IDEA_WORDS.name)), { target: { value: "  Plant swap " } });
    fireEvent.change(screen.getByLabelText(new RegExp(WRITE_IDEA_WORDS.pitch)), { target: { value: " Neighbors trade cuttings. " } });
    fireEvent.click(screen.getByRole("button", { name: WRITE_IDEA_WORDS.submit }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "Plant swap", pitch: "Neighbors trade cuttings." });
  });

  it("says what is missing instead of sending", () => {
    const onSubmit = vi.fn();
    render(<Controlled onSubmit={onSubmit} initial={{ name: "Plant swap", pitch: "  " }} />);
    fireEvent.click(screen.getByRole("button", { name: WRITE_IDEA_WORDS.submit }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(WRITE_IDEA_WORDS.pitchNeeded)).toBeTruthy();
    expect(screen.queryByText(WRITE_IDEA_WORDS.nameNeeded)).toBeNull();
  });
});
