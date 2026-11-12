import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TEAM_CALL_WORDS } from "@foundmill/shared/team-call";
import { CallControls, type CallControlsProps } from "./CallControls";

function setup(over: Partial<CallControlsProps> = {}) {
  const fn = {
    onToggleMic: vi.fn(),
    onSubmitText: vi.fn(),
    onDiscussChange: vi.fn(),
    onToggleCaptions: vi.fn(),
    onToggleTranscript: vi.fn(),
    onEnd: vi.fn(),
  };
  const props: CallControlsProps = { kind: "team", micOn: true, micLevel: 0.5, captionsOn: true, transcriptOn: false, ...fn, ...over };
  render(<CallControls {...props} />);
  return fn;
}

describe("CallControls", () => {
  it("End is a danger button worded by kind", () => {
    setup();
    const end = screen.getByRole("button", { name: TEAM_CALL_WORDS.endTeamCall });
    expect(end.getAttribute("data-variant") ?? end.className).toBeTruthy();
    document.body.innerHTML = "";
    setup({ kind: "one_to_one" });
    expect(screen.getByRole("button", { name: TEAM_CALL_WORDS.endCall })).toBeTruthy();
  });

  it("pressing End, the mic, captions and transcript call back with intents", async () => {
    const user = userEvent.setup();
    const fn = setup();
    await user.click(screen.getByRole("button", { name: TEAM_CALL_WORDS.endTeamCall }));
    await user.click(screen.getByTestId("call-mic"));
    await user.click(screen.getByTestId("call-captions-toggle"));
    await user.click(screen.getByTestId("call-transcript-toggle"));
    expect(fn.onEnd).toHaveBeenCalledTimes(1);
    expect(fn.onToggleMic).toHaveBeenCalledTimes(1);
    expect(fn.onToggleCaptions).toHaveBeenCalledTimes(1);
    expect(fn.onToggleTranscript).toHaveBeenCalledTimes(1);
  });

  it("M toggles the mic; M while typing does not; Esc does not end the call", async () => {
    const user = userEvent.setup();
    const fn = setup();
    fireEvent.keyDown(document.body, { key: "m" });
    expect(fn.onToggleMic).toHaveBeenCalledTimes(1);
    const field = screen.getByLabelText(TEAM_CALL_WORDS.typeInstead);
    await user.click(field);
    await user.keyboard("mm");
    expect(fn.onToggleMic).toHaveBeenCalledTimes(1);
    expect((field as HTMLInputElement).value).toBe("mm");
    await user.keyboard("{Escape}");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(fn.onEnd).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("");
  });

  it("M with a modifier is left alone, and does nothing when the mic is unavailable", () => {
    const fn = setup({ micUnavailable: true });
    fireEvent.keyDown(document.body, { key: "m" });
    expect(fn.onToggleMic).not.toHaveBeenCalled();
  });

  it("Type instead: Enter sends the trimmed text and clears the field; empty text sends nothing", async () => {
    const user = userEvent.setup();
    const fn = setup();
    const field = screen.getByLabelText(TEAM_CALL_WORDS.typeInstead) as HTMLInputElement;
    await user.type(field, "   {Enter}");
    expect(fn.onSubmitText).not.toHaveBeenCalled();
    await user.type(field, " What about pricing? {Enter}");
    expect(fn.onSubmitText).toHaveBeenCalledWith("What about pricing?");
    expect(field.value).toBe("");
  });

  it("Let the team discuss is a switch on team calls only", async () => {
    const user = userEvent.setup();
    const fn = setup({ discussOn: false });
    const sw = screen.getByRole("switch", { name: TEAM_CALL_WORDS.discuss });
    await user.click(sw);
    expect(fn.onDiscussChange).toHaveBeenCalledWith(true);
    document.body.innerHTML = "";
    setup({ kind: "one_to_one" });
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("while ending, everything waits and End says what is happening", () => {
    setup({ ending: true });
    expect(screen.getByTestId("call-end").textContent).toContain(TEAM_CALL_WORDS.wrappingUp);
    expect((screen.getByTestId("call-end") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(TEAM_CALL_WORDS.typeInstead) as HTMLInputElement).disabled).toBe(true);
  });

  it("toggles expose their state", () => {
    setup({ captionsOn: true, transcriptOn: false });
    expect(screen.getByTestId("call-captions-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("call-transcript-toggle").getAttribute("aria-pressed")).toBe("false");
  });
});
