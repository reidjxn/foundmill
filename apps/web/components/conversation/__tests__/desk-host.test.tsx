// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The sheet's heavy part, stubbed: the host's job is to load it on demand and hand it the desk.
vi.mock("../AgentConversation", () => ({
  AgentConversation: ({ subject, variant, open, personaHint, initialText }: { subject: { kind: string; id: string }; variant?: string; open?: boolean; personaHint?: { name: string } | null; initialText?: string | null }) => (
    <div data-testid="agent-desk" data-variant={variant} data-open={String(open)} data-subject={`${subject.kind}:${subject.id}`}>
      {personaHint?.name} · {initialText}
    </div>
  ),
}));

import { AgentDeskHost, useAgentDesk, type AgentDeskApi } from "../DeskHost";

function Talk({ useDesk = useAgentDesk }: { useDesk?: () => AgentDeskApi | null }) {
  const desk = useDesk();
  return (
    <>
      <button type="button" onPointerEnter={desk?.prefetch} onClick={() => desk?.open({ kind: "agent", id: "a1" }, { persona: { name: "Juno", avatarSeed: "juno" }, text: "Why is cash down?" })}>
        Talk to Juno
      </button>
      <button type="button" onClick={() => desk?.close()}>
        Close
      </button>
      <output data-testid="current">{desk?.current ? `${desk.current.kind}:${desk.current.id}` : "none"}</output>
    </>
  );
}

describe("AgentDeskHost", () => {
  it("mounts no sheet until a desk opens, then loads it with the subject, the persona and the first words", async () => {
    render(
      <AgentDeskHost>
        <Talk />
      </AgentDeskHost>,
    );
    expect(screen.queryByTestId("agent-desk")).toBeNull();
    expect(screen.getByTestId("current").textContent).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Talk to Juno" }));
    const sheet = await screen.findByTestId("agent-desk");
    expect(sheet.getAttribute("data-variant")).toBe("sheet");
    expect(sheet.getAttribute("data-open")).toBe("true");
    expect(sheet.getAttribute("data-subject")).toBe("agent:a1");
    expect(sheet.textContent).toContain("Juno · Why is cash down?");
    expect(screen.getByTestId("current").textContent).toBe("agent:a1");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("agent-desk").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("current").textContent).toBe("none");
  });

  it("opens the conversation a page already imported (the Inbox's) instead of fetching a second copy", async () => {
    vi.resetModules();
    const host = await import("../DeskHost");
    const Provided = ({ subject }: { subject: { kind: string; id: string } }) => <div data-testid="agent-desk" data-provided="true" data-subject={`${subject.kind}:${subject.id}`} />;
    host.provideAgentConversation({ AgentConversation: Provided as unknown as Parameters<typeof host.provideAgentConversation>[0]["AgentConversation"] });
    render(
      <host.AgentDeskHost>
        <Talk useDesk={host.useAgentDesk} />
      </host.AgentDeskHost>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Talk to Juno" }));
    const sheet = await screen.findByTestId("agent-desk");
    expect(sheet.getAttribute("data-provided")).toBe("true");
    expect(sheet.getAttribute("data-subject")).toBe("agent:a1");
  });

  it("keeps the conversation out of the host's own imports: every business page carries the host", () => {
    const src = readFileSync(join(__dirname, "..", "DeskHost.tsx"), "utf8");
    // Value imports only: a type-only import is erased from the bundle.
    const staticImports = [...src.matchAll(/^import\s(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
    expect(staticImports).not.toContain("./AgentConversation");
    expect(src).toContain(`import("./AgentConversation")`);
  });
});
