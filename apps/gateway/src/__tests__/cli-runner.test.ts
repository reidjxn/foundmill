import { describe, expect, it, vi } from "vitest";
import { CLI_COMMANDS, CLI_PROGRAM_KEYS, type CliProgramName } from "@foundmill/connectors";
import { checkCliCall, type Sandbox } from "@foundmill/sandbox";
import { createCliRunner } from "../cli-runner";

const PROGRAMS = Object.keys(CLI_PROGRAM_KEYS) as CliProgramName[];
const SAMPLE = { format: "svg", output: "o.svg", type: "writer", input: "a.mp4", text: "x", title: "t", x: 1, y: 1, cx: 1, cy: 1, width: 5, height: 5, r: 5, outerRadius: 5, innerRadius: 2, color: "#aabbcc", index: 0, cell: "A1", value: "1", startSeconds: 0, seconds: 1 };

describe("cli connectors against the sandbox allow-list", () => {
  it("every tool builds argv the sandbox accepts", () => {
    for (const p of PROGRAMS) for (const c of CLI_COMMANDS[p]) {
      const schema = c.spec.input as unknown as { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
      const outputs = p === "libreoffice" ? ["o.pdf"] : p === "gimp" ? ["o.png"] : p === "ffmpeg" ? ["o.mp4", "o.mp3", "o.png"] : ["o.svg"];
      const fmts = p === "libreoffice" ? ["pdf"] : p === "gimp" ? ["png"] : ["svg"];
      const parsed = outputs.flatMap((output) => fmts.flatMap((format) => ["1,1 2,2 3,3", 5].map((points) => schema.safeParse({ ...SAMPLE, output, format, points })))).find((r) => r.success);
      expect(parsed, `${p}.${c.spec.name} parses a sample`).toBeDefined();
      expect(() => checkCliCall(p, c.argv(parsed!.data as never)), `${p}.${c.spec.name}`).not.toThrow();
    }
  });
});

describe("release", () => {
  const sandbox = (stdout: string, code = 0) => ({ exec: vi.fn(async () => ({ code, stdout, stderr: "", timedOut: false, durationMs: 1 })) }) as unknown as Sandbox;
  it("refuses anything but an SVG or PNG", async () => {
    const r = createCliRunner({ db: {} as never, sandboxFor: async () => sandbox("") });
    await expect(r.release({ businessId: "b", folder: "p", path: "deck.pdf", target: "logo" })).rejects.toThrow(/SVG or PNG/);
  });
  it("says so when the file is not in the working folder", async () => {
    const r = createCliRunner({ db: {} as never, sandboxFor: async () => sandbox("", 1) });
    await expect(r.release({ businessId: "b", folder: "p", path: "logo.svg", target: "logo" })).rejects.toThrow(/not in the working folder/);
  });
});
