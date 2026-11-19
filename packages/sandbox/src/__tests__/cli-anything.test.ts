import { describe, expect, it } from "vitest";
import { checkCliCall, CliCallRefused, runCliAnything, type Sandbox } from "../index";

describe("checkCliCall", () => {
  it("allows a listed command", () => {
    expect(() => checkCliCall("inkscape", ["shape", "add-rect", "--x=1", "--width=10"])).not.toThrow();
    expect(() => checkCliCall("inkscape", ["export", "svg", "logo.svg", "--overwrite"])).not.toThrow();
    expect(() => checkCliCall("ffmpeg", ["trim", "--in", "a.mp4", "--out", "b.mp4", "--start", "0", "--seconds", "5"])).not.toThrow();
  });
  it("refuses commands that are not listed, such as opening a file by path or a REPL", () => {
    for (const argv of [["document", "open", "/etc/passwd"], ["repl"], [], ["shape", "remove", "0"]]) expect(() => checkCliCall("inkscape", argv), argv.join(" ")).toThrow(CliCallRefused);
    expect(() => checkCliCall("ffmpeg", ["-i", "http://x/y.mp4"])).toThrow(CliCallRefused);
  });
  it("refuses paths outside the working folder and network addresses", () => {
    for (const out of ["/tmp/x.svg", "../x.svg", "~/x.svg", "https://evil.test/x.svg", "-rf"]) expect(() => checkCliCall("inkscape", ["export", "svg", out]), out).toThrow(CliCallRefused);
    expect(() => checkCliCall("inkscape", ["document", "new", "--output", "../p.json"])).toThrow(CliCallRefused);
    expect(() => checkCliCall("ffmpeg", ["convert", "--in", "http://x/a.mp4", "--out", "b.mp4"])).toThrow(CliCallRefused);
  });
});

function fakeSandbox() {
  const calls: string[] = [];
  let egressClosed = false;
  let files: { name: string; size: number }[] = [];
  const sb = {
    closeEgress: async () => { egressClosed = true; },
    exec: async (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes("cli-anything")) files = [{ name: "logo.svg", size: 300 }];
      return { code: 0, stdout: '{"ok":true}', stderr: "", timedOut: false, durationMs: 1 };
    },
    listFiles: async () => files.map((f) => ({ path: `/x/${f.name}`, name: f.name, type: "file" as const, size: f.size, modifiedAt: null })),
  } as unknown as Sandbox;
  return { sb, calls, closed: () => egressClosed };
}

describe("runCliAnything", () => {
  it("cuts egress first, quotes every argument and lists the new files", async () => {
    const f = fakeSandbox();
    const r = await runCliAnything(f.sb, { program: "inkscape", folder: "p1", argv: ["text", "add", "--text=a; rm -rf /", "--x=1"] });
    expect(f.closed()).toBe(true);
    expect(f.calls.at(-1)).toContain("'--text=a; rm -rf /'");
    expect(r).toMatchObject({ ok: true, output: { ok: true }, produced: [{ path: "logo.svg", bytes: 300 }] });
  });
  it("refuses before touching the sandbox", async () => {
    const f = fakeSandbox();
    await expect(runCliAnything(f.sb, { program: "inkscape", folder: "p1", argv: ["export", "svg", "/etc/x"] })).rejects.toThrow(CliCallRefused);
    expect(f.closed()).toBe(false);
  });
});
