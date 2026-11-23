/**
 * CLI-Anything logo eval (LAUNCH_EVALUATION.md Session 4b). A Design agent makes a logo file from the project's brand
 * colors with the Inkscape tools, and `release_output` puts it on the page with no approval (founder, Nov 23, 2026). It
 * passes when
 *   1. the agent's template holds the Inkscape tools, and neither making a file nor `release_output` asks anybody;
 *   2. every shape and text color the agent used is one of the two brand colors;
 *   3. the file is staged: after `export` the business has no logo, and the result says it is not on the page;
 *   4. after `release_output` (run by the gateway's runner) the business logo is that file, it passed the
 *      logo check, and it still holds the brand color.
 * The program itself is a small stand-in for `cli-anything-inkscape` (no Inkscape in the unit suite): it draws the
 * commands it is given into an SVG, so the check reads a real file's bytes. The live run, in the E2B template, is the
 * same script against the real program.
 */
import { createCliConnector, type CliRunner } from "@foundmill/connectors";
import { checkCliCall, type Sandbox } from "@foundmill/sandbox";
import { repos, type Db } from "@foundmill/db";
import { createCliRunner } from "@foundmill/gateway/cli-runner";

export interface LogoBrandBrief { businessId: string; name: string; primary: string; secondary: string }

/** A stand-in Inkscape: the sandbox's `exec` and `listFiles` for one working folder. */
export function standInInkscape(): { sandbox: Sandbox; files: Map<string, string>; commands: string[][] } {
  const files = new Map<string, string>();
  const commands: string[][] = [];
  let shapes: string[] = [];
  let size = 512;
  const sandbox = {
    closeEgress: async () => {},
    listFiles: async () => [...files].map(([name, text]) => ({ path: `/w/${name}`, name, type: "file" as const, size: text.length, modifiedAt: null })),
    exec: async (line: string) => {
      const base64 = /base64 -w0 \S*?([^/\s']+)'?$/.exec(line);
      if (base64) {
        const f = files.get(base64[1]!);
        return { code: f ? 0 : 1, stdout: f ? Buffer.from(f).toString("base64") : "", stderr: "", timedOut: false, durationMs: 1 };
      }
      if (!line.startsWith("cli-anything-inkscape")) return { code: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      const argv = (line.match(/'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^'|'$/g, ""));
      const rest = argv.slice(argv.indexOf("--json") + 1).filter((a) => a !== "-s" && a !== "--project" && a !== "project.json");
      commands.push(rest);
      const opt = (k: string) => rest.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
      const [group, command] = rest;
      if (group === "document") { size = Number(opt("--width") ?? 512); shapes = [`<rect width="${size}" height="${size}" fill="${opt("--background")}"/>`]; }
      if (command === "add-rect") shapes.push(`<rect x="${opt("--x")}" y="${opt("--y")}" width="${opt("--width")}" height="${opt("--height")}" rx="${opt("--rx") ?? 0}" style="${opt("--style") ?? ""}"/>`);
      if (command === "add-circle") shapes.push(`<circle cx="${opt("--cx")}" cy="${opt("--cy")}" r="${opt("--r")}" style="${opt("--style") ?? ""}"/>`);
      if (group === "text") shapes.push(`<text x="${opt("--x")}" y="${opt("--y")}" font-size="${opt("--font-size")}" fill="${opt("--fill")}">${opt("--text")}</text>`);
      if (group === "export") files.set(rest[2]!, `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${shapes.join("")}</svg>`);
      return { code: 0, stdout: "{}", stderr: "", timedOut: false, durationMs: 1 };
    },
  } as unknown as Sandbox;
  return { sandbox, files, commands };
}

export interface CliLogoResult { passed: boolean; problems: string[]; logoDataUrl: string | null }

export async function runCliLogoEval(db: Db, brief: LogoBrandBrief): Promise<CliLogoResult> {
  const problems: string[] = [];
  const { sandbox, commands } = standInInkscape();
  const runner: CliRunner = createCliRunner({ db, sandboxFor: async () => sandbox });
  const inkscape = createCliConnector("inkscape", { cliRunner: runner });
  const ctx = { businessId: brief.businessId, agentId: "design", sessionId: null, integration: {} as never, log: { debug() {}, info() {}, warn() {}, error() {} } as never } as never;
  const call = async (tool: string, args: unknown) => {
    const r = (await inkscape.callTool(tool, args, ctx)) as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } };
    if (!r.ok) problems.push(`${tool} failed: ${r.error?.message}`);
    return r;
  };

  // 1. Neither making files nor releasing one asks anybody.
  for (const t of ["new_document", "add_rect", "add_text", "export", "release_output"]) if (Object.values(inkscape.policyHints[t] ?? {}).some(Boolean)) problems.push(`${t} would ask the founder`);

  // The agent's script: a square tile in the primary color, the initial in the secondary.
  await call("new_document", { width: 512, height: 512, background: brief.secondary });
  await call("add_rect", { x: 64, y: 64, width: 384, height: 384, radius: 96, fill: brief.primary });
  await call("add_text", { text: brief.name[0]!.toUpperCase(), x: 256, y: 340, fontSize: 280, fill: brief.secondary, anchor: "middle" });
  const exported = await call("export", { format: "svg", output: "logo.svg" });

  // 2. Only brand colors.
  const used = commands.flatMap((c) => c.join(" ").match(/#[0-9a-fA-F]{6}/g) ?? []).map((c) => c.toLowerCase());
  for (const c of new Set(used)) if (![brief.primary, brief.secondary].map((x) => x.toLowerCase()).includes(c)) problems.push(`used ${c}, which is not a brand color`);
  for (const c of commands) { try { checkCliCall("inkscape", c); } catch (e) { problems.push(`the sandbox would refuse: ${(e as Error).message}`); } }

  // 3. Staged: nothing on the page yet, and the result says so.
  if (await repos.logos.get(db, brief.businessId)) problems.push("a logo was set before release_output");
  if (!JSON.stringify(exported).includes("working copy")) problems.push("the export result does not say the file is only in the working copy");

  // 4. The gateway runs the release.
  await call("release_output", { path: "logo.svg", target: "logo" });
  const logo = await repos.logos.get(db, brief.businessId);
  if (!logo) problems.push("no logo after release_output");
  else {
    const svg = Buffer.from(logo.dataUrl.split(",")[1] ?? "", "base64").toString("utf8");
    if (!svg.toLowerCase().includes(brief.primary.toLowerCase())) problems.push("the logo lost the primary brand color");
  }
  return { passed: problems.length === 0, problems, logoDataUrl: logo?.dataUrl ?? null };
}
