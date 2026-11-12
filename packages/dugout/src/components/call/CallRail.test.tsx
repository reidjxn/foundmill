import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SPEECH_ACCENTS } from "@foundmill/shared/team-call";
import { AgentPersonaProvider } from "../foundation/AgentPersona";
import { DateFormatProvider } from "../foundation/DateFormatProvider";
import { CallCaptions } from "./CallCaptions";
import { CallLobbyPicker } from "./CallLobbyPicker";
import { CallTranscript } from "./CallTranscript";
import { SpeechAccentPicker } from "./SpeechAccentPicker";
import { AGENT_IDS, TEAM_CALL_AGENTS, TEAM_CALL_TURNS, portraitDataUrl } from "./fixtures";

const Personas = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
  <AgentPersonaProvider anthropomorphic={on} style="humans" portraitUrl={portraitDataUrl}>
    {children}
  </AgentPersonaProvider>
);

describe("CallCaptions", () => {
  it("labels the speaker with labelFor and shows the words", () => {
    render(
      <Personas on>
        <CallCaptions speaker={TEAM_CALL_AGENTS[1]!} text="The page is nearly ready." />
      </Personas>,
    );
    expect(screen.getByTestId("call-captions-speaker").textContent).toBe("Priya (Product Lead)");
    expect(screen.getByTestId("call-captions").textContent).toContain("The page is nearly ready.");
  });

  it("persona off: the stored name; the founder is You; entity markup renders as a link", () => {
    const { rerender } = render(
      <Personas on={false}>
        <CallCaptions speaker={TEAM_CALL_AGENTS[1]!} text={TEAM_CALL_TURNS[2]!.text} />
      </Personas>,
    );
    expect(screen.getByTestId("call-captions-speaker").textContent).toBe("Product Lead");
    expect(screen.getByTestId("call-captions").textContent).not.toContain("[[ent:");
    expect(screen.getByRole("link", { name: /Growth Lead/ })).toBeTruthy();
    rerender(
      <Personas on={false}>
        <CallCaptions speaker="founder" text="Hello" />
      </Personas>,
    );
    expect(screen.getByTestId("call-captions-speaker").textContent).toBe("You");
  });

  it("empty: a quiet live region", () => {
    render(<CallCaptions speaker={null} text={null} />);
    expect(screen.getByTestId("call-captions").textContent).toBe("");
    expect(screen.getByTestId("call-captions").getAttribute("aria-live")).toBe("polite");
  });
});

describe("CallTranscript", () => {
  it("lists turns with speaker labels and times in the person's format", () => {
    render(
      <DateFormatProvider value={{ date: "us", time: "24h" }}>
        <Personas on>
          <CallTranscript turns={TEAM_CALL_TURNS} participants={TEAM_CALL_AGENTS} speakingTurnId="t3" />
        </Personas>
      </DateFormatProvider>,
    );
    const speakers = screen.getAllByTestId("call-turn-speaker").map((e) => e.textContent);
    expect(speakers.slice(0, 3)).toEqual(["Malik (Chief of Staff)", "You", "Priya (Product Lead)"]);
    const times = screen.getAllByTestId("call-turn-time").map((e) => e.textContent);
    expect(times.every((t) => /^\d{2}:\d{2}$/.test(t ?? ""))).toBe(true);
    expect(screen.getAllByTestId("call-turn")[2]!.hasAttribute("data-speaking")).toBe(true);
    expect(screen.getByText("Typed")).toBeTruthy();
  });

  it("12-hour times by default, and a close button when asked", async () => {
    const onClose = vi.fn();
    render(
      <Personas on={false}>
        <CallTranscript turns={TEAM_CALL_TURNS} participants={TEAM_CALL_AGENTS} onClose={onClose} />
      </Personas>,
    );
    expect(screen.getAllByTestId("call-turn-time")[0]!.textContent).toMatch(/^\d{1,2}:\d{2}\s?[AP]M$/);
    expect(screen.getAllByTestId("call-turn-speaker")[0]!.textContent).toBe("Chief of Staff");
    await userEvent.setup().click(screen.getByRole("button", { name: "Close transcript" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CallLobbyPicker", () => {
  const reversed = [...TEAM_CALL_AGENTS].reverse();

  it("lists the Chief of Staff first, with persona names", () => {
    render(
      <Personas on>
        <CallLobbyPicker agents={reversed} selected={[]} onChange={() => {}} />
      </Personas>,
    );
    const names = screen.getAllByTestId("call-lobby-name").map((e) => e.textContent);
    expect(names[0]).toBe("Malik");
    expect(names).toHaveLength(5);
    expect(screen.getByTestId("call-lobby-count").textContent).toBe("0 of 8");
  });

  it("ticking calls back with ids in list order; the limit holds the rest", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Personas on={false}>
        <CallLobbyPicker agents={reversed} selected={[AGENT_IDS.product]} onChange={onChange} max={2} />
      </Personas>,
    );
    await user.click(screen.getByRole("checkbox", { name: /Chief of Staff/ }));
    expect(onChange).toHaveBeenCalledWith([AGENT_IDS.cos, AGENT_IDS.product]);
    rerender(
      <Personas on={false}>
        <CallLobbyPicker agents={reversed} selected={[AGENT_IDS.cos, AGENT_IDS.product]} onChange={onChange} max={2} />
      </Personas>,
    );
    expect((screen.getByRole("checkbox", { name: /Growth Lead/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("holds 2 agents");
    expect(screen.getByRole("checkbox", { name: /Chief of Staff/ }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("SpeechAccentPicker", () => {
  it("labels the field Accent with its hint and shows the chosen accent", () => {
    render(<SpeechAccentPicker value="elara" defaultKey="talia" onChange={() => {}} onPreview={() => {}} />);
    expect(screen.getByText("Accent")).toBeTruthy();
    expect(screen.getByText("How this agent sounds on calls")).toBeTruthy();
    expect(screen.getByRole("combobox").textContent).toContain("Elara");
  });

  it("Hear it previews the chosen accent", async () => {
    const onPreview = vi.fn();
    render(<SpeechAccentPicker value="baxter" defaultKey="darian" onChange={() => {}} onPreview={onPreview} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Hear it" }));
    expect(onPreview).toHaveBeenCalledWith("baxter");
  });

  it("no preview callback, no button; disabled says why", () => {
    render(<SpeechAccentPicker value="baxter" defaultKey="darian" onChange={() => {}} disabled disabledReason="Only editors change this." />);
    expect(screen.queryByRole("button", { name: "Hear it" })).toBeNull();
    expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Only editors change this.")).toBeTruthy();
  });

  it("lists every accent grouped Women's and Men's with the default marked", async () => {
    if (typeof Element.prototype.scrollIntoView !== "function") Element.prototype.scrollIntoView = () => {};
    const proto = Element.prototype as unknown as Record<string, unknown>;
    proto.hasPointerCapture ??= () => false;
    proto.releasePointerCapture ??= () => {};
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SpeechAccentPicker value="elara" defaultKey="talia" onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByText("Women's")).toBeTruthy();
    expect(screen.getByText("Men's")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(SPEECH_ACCENTS.length);
    expect(screen.getByRole("option", { name: /Talia.*Default/ })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Darian/ }));
    expect(onChange).toHaveBeenCalledWith("darian");
  });
});
