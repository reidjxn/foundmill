/**
 * Runs one CLI-Anything command in a project's sandbox (FOUNDMILL.md "Agents run software through CLI-Anything").
 *
 * Never a raw shell for an agent: the caller names a program and an argument list, `checkCliCall` holds it to an
 * allow-list of commands per program (so anything that reaches the network, runs a script or a macro, or is not listed
 * does not run), every path stays inside the working folder, and the command is one JSON call, never a REPL. Egress is
 * cut before the program starts. Files the command made are listed so the caller can stage them; nothing leaves the
 * working folder here.
 */
import { shellQuote } from "./shell";
import type { Sandbox } from "./types";

export const CLI_WORK_DIR = "/home/user/work";

/** The program's binary and the command groups (`group command`) an agent may run. Not listed means not allowed. */
export const CLI_PROGRAMS = {
  inkscape: {
    bin: "cli-anything-inkscape",
    allowed: ["document new", "document info", "document canvas-size", "shape add-rect", "shape add-circle", "shape add-ellipse", "shape add-polygon", "shape add-path", "shape add-star", "shape list", "text add", "style set-fill", "style set-stroke", "style set-opacity", "transform translate", "transform rotate", "transform scale", "layer add", "layer list", "gradient add-linear", "gradient add-radial", "gradient apply", "export png", "export svg", "export pdf"],
  },
  libreoffice: {
    bin: "cli-anything-libreoffice",
    allowed: ["document new", "document info", "writer add-heading", "writer add-paragraph", "writer add-list", "writer add-table", "writer add-page-break", "writer list", "calc add-sheet", "calc set-cell", "calc list-sheets", "impress add-slide", "impress set-content", "impress add-element", "impress list-slides", "export render"],
  },
  gimp: {
    bin: "cli-anything-gimp",
    allowed: ["project new", "project info", "layer new", "layer list", "canvas resize", "canvas scale", "canvas crop", "draw text", "draw rect", "export render"],
  },
  // CLI-Hub has no FFmpeg package at the pinned commit, so the program itself: argv is built by the connector's own
  // wrapper from typed fields, and the commands below are the only shapes it builds.
  ffmpeg: { bin: "ffmpeg", allowed: ["convert", "trim", "extract-audio", "poster"] },
} as const;
export type CliProgram = keyof typeof CLI_PROGRAMS;

/** Arguments that would make a program read a network address or run code, refused whatever the command. */
const REFUSED_ARG = /^(?:[a-z][a-z0-9+.-]*:\/\/|-(?:-?(?:script|macro|eval|exec|plugin|python|shell|filter_complex_script)\b)|-i$)/i;
const PATH_FLAG = /^--?(?:output|o|project|path)$/;

export class CliCallRefused extends Error {
  constructor(reason: string) {
    super(`CLI-Anything call refused: ${reason}`);
    this.name = "CliCallRefused";
  }
}

/** A relative path inside the working folder: no absolute path, no `..`, no `~`, no URL, no option-looking name. */
export function isWorkPath(p: string): boolean {
  return p.length > 0 && p.length < 200 && !p.startsWith("/") && !p.startsWith("-") && !p.startsWith("~") && !/(^|\/)\.\.(\/|$)/.test(p) && !/[\0\n\r]/.test(p) && !/^[a-z][a-z0-9+.-]*:/i.test(p);
}

/**
 * Throws `CliCallRefused` unless `argv` is an allowed command of `program` with safe arguments. For the three CLI-Hub
 * programs `argv` starts with `group command`; for ffmpeg it starts with the wrapper's command word, then `--in`/`--out`
 * paths and typed values.
 */
export function checkCliCall(program: CliProgram, argv: readonly string[]): void {
  const spec = CLI_PROGRAMS[program];
  if (!spec) throw new CliCallRefused(`unknown program ${String(program)}`);
  const head = program === "ffmpeg" ? argv[0] ?? "" : argv.slice(0, 2).join(" ");
  if (!(spec.allowed as readonly string[]).includes(head)) throw new CliCallRefused(`${program} ${head || "(nothing)"} is not an allowed command`);
  for (const a of argv) {
    if (/[\0]/.test(a)) throw new CliCallRefused("an argument holds a null byte");
    if (REFUSED_ARG.test(a)) throw new CliCallRefused(`argument ${a.slice(0, 40)} is not allowed`);
  }
  // A path value (after a path flag, or a bare `export` / `new` output argument) must stay in the working folder.
  argv.forEach((a, i) => {
    if (PATH_FLAG.test(a) && argv[i + 1] !== undefined && !isWorkPath(argv[i + 1]!)) throw new CliCallRefused(`path ${argv[i + 1]!.slice(0, 60)} is outside the working folder`);
  });
  if (/^(?:export )/.test(head) || program === "ffmpeg") {
    const paths = program === "ffmpeg" ? [argv[argv.indexOf("--in") + 1], argv[argv.indexOf("--out") + 1]] : [argv[2]];
    for (const p of paths) if (p === undefined || !isWorkPath(p)) throw new CliCallRefused("a file path is missing or outside the working folder");
  }
}

export interface CliCallInput {
  program: CliProgram;
  argv: readonly string[];
  /** Per-business subfolder of the working folder; the files this call may read and write. */
  folder: string;
  timeoutMs?: number;
}

export interface CliCallResult {
  ok: boolean;
  code: number;
  /** Parsed `--json` output when the program printed JSON; the trimmed text otherwise. */
  output: unknown;
  stderr: string;
  /** Files in the folder after the call that were not there before: path relative to the folder, bytes. */
  produced: { path: string; bytes: number }[];
}

const ffmpegArgv = (argv: readonly string[]): string[] => {
  const v = (k: string) => argv[argv.indexOf(k) + 1]!;
  const common = ["-hide_banner", "-nostdin", "-protocol_whitelist", "file", "-y", "-i", v("--in")];
  switch (argv[0]) {
    case "trim": return [...common, "-ss", v("--start"), "-t", v("--seconds"), v("--out")];
    case "extract-audio": return [...common, "-vn", v("--out")];
    case "poster": return [...common, "-ss", v("--start"), "-frames:v", "1", v("--out")];
    default: return [...common, v("--out")];
  }
};

/** Runs the call in `sandbox` after cutting egress. The sandbox is the project's; this never creates one. */
export async function runCliAnything(sandbox: Sandbox, call: CliCallInput): Promise<CliCallResult> {
  checkCliCall(call.program, call.argv);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(call.folder)) throw new CliCallRefused("folder name");
  const cwd = `${CLI_WORK_DIR}/${call.folder}`;
  await sandbox.closeEgress();
  await sandbox.exec(`mkdir -p ${shellQuote(cwd)}`);
  const before = new Map((await sandbox.listFiles(cwd)).filter((f) => f.type === "file").map((f) => [f.name, f.size ?? 0]));
  const spec = CLI_PROGRAMS[call.program];
  const args = call.program === "ffmpeg" ? ffmpegArgv(call.argv) : ["--json", "--project", "project.json", ...(call.program === "inkscape" ? ["-s"] : []), ...call.argv];
  const run = await sandbox.exec([spec.bin, ...args].map(shellQuote).join(" "), { cwd, timeoutMs: call.timeoutMs ?? 120_000 });
  const after = (await sandbox.listFiles(cwd)).filter((f) => f.type === "file");
  const produced = after.filter((f) => before.get(f.name) !== (f.size ?? 0)).map((f) => ({ path: f.name, bytes: f.size ?? 0 }));
  let output: unknown = run.stdout.trim();
  try { output = JSON.parse(run.stdout); } catch { /* plain text */ }
  return { ok: run.code === 0, code: run.code, output, stderr: run.stderr.slice(0, 2000), produced };
}
