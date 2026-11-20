/**
 * CLI-Anything programs as connectors (FOUNDMILL.md "Agents run software through CLI-Anything"): `cli_inkscape`,
 * `cli_libreoffice`, `cli_ffmpeg`, `cli_gimp`. Each tool is one typed command, one JSON call, never a REPL or a shell: the
 * handler turns the validated input into an argument list and hands it to the host's runner (packages/sandbox
 * `runCliAnything`, in the project's sandbox with egress closed). Commands that reach the network, run a script, or are not
 * listed here do not exist as tools. Files land in the project's working folder; `release_output` is the only way one
 * leaves it, and it asks the founder first.
 */
import { z } from "zod";
import { defineTool, type AnyToolSpec } from "../../define";

export const CLI_PROGRAM_KEYS = { inkscape: "cli_inkscape", libreoffice: "cli_libreoffice", ffmpeg: "cli_ffmpeg", gimp: "cli_gimp" } as const;
export type CliProgramName = keyof typeof CLI_PROGRAM_KEYS;
export const CLI_RATE_LIMITS = { perMinute: 30, perDay: 1_000 };
export const CLI_NOTICE = "Simulated: no program ran and no file was made. This is an example result, not something done.";
export const CLI_STAGED_NOTICE = "The file is in the project's working copy. It reaches the project only when a founder approves release_output.";

/** A flat file name in the project's working folder: no folders, no dots-only names, no leading dash. */
export const WorkFile = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, "a plain file name such as logo.svg");
const ext = (...e: string[]) => WorkFile.refine((f) => e.some((x) => f.toLowerCase().endsWith(`.${x}`)), `must end in .${e.join(", .")}`);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a color such as #1a2b3c");
const Num = z.number().min(-10_000).max(10_000);
const Pos = z.number().min(1).max(10_000);
const Text = z.string().min(1).max(500).refine((s) => !/[\0\r]/.test(s), "plain text");
const Index = z.number().int().min(0).max(10_000);

export const CliOut = z.object({
  /** Always true: a failed command throws instead. */
  ok: z.literal(true),
  /** What the program printed, trimmed. */
  summary: z.string(),
  /** Files this command made or changed in the working folder. */
  produced: z.array(z.object({ path: z.string(), bytes: z.number().int() })),
  /** These files are in the working copy only: nothing is on the project's page or sent anywhere. */
  staged: z.literal(true),
  notice: z.string(),
  simulated: z.boolean().optional(),
});
export type CliOutT = z.infer<typeof CliOut>;

/** Only the business logo has a place to go today; documents, decks and clips stay in the working copy until a later destination exists. */
export const ReleaseTarget = z.enum(["logo"]);
export const ReleaseOut = z.object({ released: z.boolean(), target: ReleaseTarget, path: z.string(), where: z.string(), simulated: z.boolean().optional(), notice: z.string().optional() });

const o = (flag: string, v: string | number | undefined): string[] => (v === undefined ? [] : [`${flag}=${v}`]);
const style = (fill?: string, stroke?: string, w?: number) => [fill ? `fill:${fill}` : "", stroke ? `stroke:${stroke}` : "", w !== undefined ? `stroke-width:${w}` : ""].filter(Boolean).join(";");

export type CliCommand = { spec: AnyToolSpec; argv: (a: never) => string[] };
const cmd = <I extends z.ZodType>(name: string, description: string, input: I, argv: (a: z.output<I>) => string[]): CliCommand => ({
  spec: defineTool({ name, description, input, output: CliOut, hints: {} }),
  argv: argv as (a: never) => string[],
});

const inkscape: CliCommand[] = [
  cmd("new_document", "Start a new SVG drawing (a blank canvas) in the working folder.", z.object({ width: Pos.default(512), height: Pos.default(512), background: Hex.default("#ffffff") }), (a) => ["document", "new", `--width=${a.width}`, `--height=${a.height}`, `--background=${a.background}`, "--output=project.json"]),
  cmd("add_rect", "Add a rectangle, with an optional fill, stroke and corner radius.", z.object({ x: Num, y: Num, width: Pos, height: Pos, radius: z.number().min(0).max(5000).optional(), fill: Hex.optional(), stroke: Hex.optional(), strokeWidth: z.number().min(0).max(500).optional() }), (a) => ["shape", "add-rect", `--x=${a.x}`, `--y=${a.y}`, `--width=${a.width}`, `--height=${a.height}`, ...o("--rx", a.radius), ...o("--ry", a.radius), ...o("--style", style(a.fill, a.stroke, a.strokeWidth) || undefined)]),
  cmd("add_circle", "Add a circle.", z.object({ cx: Num, cy: Num, r: Pos, fill: Hex.optional(), stroke: Hex.optional(), strokeWidth: z.number().min(0).max(500).optional() }), (a) => ["shape", "add-circle", `--cx=${a.cx}`, `--cy=${a.cy}`, `--r=${a.r}`, ...o("--style", style(a.fill, a.stroke, a.strokeWidth) || undefined)]),
  cmd("add_star", "Add a star or burst.", z.object({ cx: Num, cy: Num, points: z.number().int().min(3).max(24), outerRadius: Pos, innerRadius: Pos, fill: Hex.optional() }), (a) => ["shape", "add-star", `--cx=${a.cx}`, `--cy=${a.cy}`, `--points=${a.points}`, `--outer-r=${a.outerRadius}`, `--inner-r=${a.innerRadius}`, ...o("--style", style(a.fill) || undefined)]),
  cmd("add_polygon", "Add a polygon from SVG points, such as \"50,0 100,100 0,100\".", z.object({ points: z.string().regex(/^[0-9.,\s-]{3,400}$/, "numbers and commas only"), fill: Hex.optional() }), (a) => ["shape", "add-polygon", `--points=${a.points}`, ...o("--style", style(a.fill) || undefined)]),
  cmd("add_text", "Add a line of text, such as a business name beside a mark.", z.object({ text: Text, x: Num, y: Num, fontSize: z.number().min(4).max(2000).default(48), fontFamily: z.enum(["sans-serif", "serif", "monospace", "DejaVu Sans"]).default("sans-serif"), fontWeight: z.enum(["normal", "bold"]).default("bold"), fill: Hex.default("#000000"), anchor: z.enum(["start", "middle", "end"]).default("start") }), (a) => ["text", "add", `--text=${a.text}`, `--x=${a.x}`, `--y=${a.y}`, `--font-size=${a.fontSize}`, `--font-family=${a.fontFamily}`, `--font-weight=${a.fontWeight}`, `--fill=${a.fill}`, `--text-anchor=${a.anchor}`]),
  cmd("set_fill", "Change the fill color of an object by its index (shape list order).", z.object({ index: Index, color: Hex }), (a) => ["style", "set-fill", String(a.index), a.color]),
  cmd("export", "Write the drawing as SVG, PNG or PDF into the working folder.", z.object({ format: z.enum(["svg", "png", "pdf"]), output: WorkFile }).refine((a) => a.output.toLowerCase().endsWith(`.${a.format}`), "output must end in the format"), (a) => ["export", a.format, a.output, "--overwrite"]),
];

const libreoffice: CliCommand[] = [
  cmd("new_document", "Start a new text document, spreadsheet or presentation.", z.object({ type: z.enum(["writer", "calc", "impress"]), name: Text.default("untitled") }), (a) => ["document", "new", `--type=${a.type}`, `--name=${a.name}`, "--output=project.json"]),
  cmd("add_heading", "Add a heading to a text document.", z.object({ text: Text, level: z.number().int().min(1).max(6).default(1) }), (a) => ["writer", "add-heading", `--text=${a.text}`, `--level=${a.level}`]),
  cmd("add_paragraph", "Add a paragraph to a text document.", z.object({ text: z.string().min(1).max(4000).refine((s) => !/[\0\r]/.test(s), "plain text"), bold: z.boolean().default(false), alignment: z.enum(["left", "center", "right", "justify"]).default("left") }), (a) => ["writer", "add-paragraph", `--text=${a.text}`, `--alignment=${a.alignment}`, ...(a.bold ? ["--bold"] : [])]),
  cmd("add_slide", "Add a slide with a title and body text to a presentation.", z.object({ title: Text, content: z.string().max(2000).default("") }), (a) => ["impress", "add-slide", `--title=${a.title}`, `--content=${a.content}`]),
  cmd("set_cell", "Put a value or formula in a spreadsheet cell.", z.object({ sheet: Index.default(0), cell: z.string().regex(/^[A-Z]{1,2}[1-9][0-9]{0,4}$/), value: z.string().max(500) }), (a) => ["calc", "set-cell", `--sheet=${a.sheet}`, a.cell, a.value]),
  cmd("export", "Write the document as PDF, Word, Excel, PowerPoint or OpenDocument into the working folder.", z.object({ format: z.enum(["pdf", "docx", "xlsx", "pptx", "odt"]), output: WorkFile }).refine((a) => a.output.toLowerCase().endsWith(`.${a.format}`), "output must end in the format"), (a) => ["export", "render", a.output, `--preset=${a.format}`, "--overwrite"]),
];

const gimp: CliCommand[] = [
  cmd("new_image", "Start a new raster image.", z.object({ width: z.number().int().min(1).max(8000).default(1024), height: z.number().int().min(1).max(8000).default(1024), background: Hex.default("#ffffff") }), (a) => ["project", "new", `--width=${a.width}`, `--height=${a.height}`, `--background=${a.background}`, "--output=project.json"]),
  cmd("draw_text", "Draw text on the image.", z.object({ text: Text, x: z.number().int().min(0).max(8000), y: z.number().int().min(0).max(8000), size: z.number().int().min(4).max(2000).default(48), color: Hex.default("#000000") }), (a) => ["draw", "text", `--text=${a.text}`, `--x=${a.x}`, `--y=${a.y}`, `--size=${a.size}`, `--color=${a.color}`]),
  cmd("draw_rect", "Draw a filled rectangle on the image.", z.object({ x: z.number().int().min(0).max(8000), y: z.number().int().min(0).max(8000), width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000), color: Hex }), (a) => ["draw", "rect", `--x=${a.x}`, `--y=${a.y}`, `--width=${a.width}`, `--height=${a.height}`, `--color=${a.color}`]),
  cmd("scale", "Scale the canvas to a new size.", z.object({ width: z.number().int().min(1).max(8000), height: z.number().int().min(1).max(8000) }), (a) => ["canvas", "scale", `--width=${a.width}`, `--height=${a.height}`]),
  cmd("export", "Write the image as PNG or JPEG into the working folder.", z.object({ format: z.enum(["png", "jpg"]), output: WorkFile }).refine((a) => a.output.toLowerCase().endsWith(`.${a.format}`), "output must end in the format"), (a) => ["export", "render", a.output, `--preset=${a.format === "jpg" ? "jpeg" : "png"}`, "--overwrite"]),
];

const Secs = z.number().min(0).max(36_000);
const ffmpeg: CliCommand[] = [
  cmd("convert", "Convert a working-folder audio or video file to another format.", z.object({ input: WorkFile, output: ext("mp4", "webm", "mp3", "wav", "gif") }), (a) => ["convert", "--in", a.input, "--out", a.output]),
  cmd("trim", "Cut a clip from a working-folder video or audio file.", z.object({ input: WorkFile, output: ext("mp4", "webm", "mp3", "wav"), startSeconds: Secs, seconds: z.number().min(0.1).max(3600) }), (a) => ["trim", "--in", a.input, "--out", a.output, "--start", String(a.startSeconds), "--seconds", String(a.seconds)]),
  cmd("extract_audio", "Take the sound out of a video as an audio file.", z.object({ input: WorkFile, output: ext("mp3", "wav") }), (a) => ["extract-audio", "--in", a.input, "--out", a.output]),
  cmd("poster", "Save one frame of a video as a picture.", z.object({ input: WorkFile, output: ext("png", "jpg"), atSeconds: Secs.default(1) }), (a) => ["poster", "--in", a.input, "--out", a.output, "--start", String(a.atSeconds)]),
];

export const CLI_COMMANDS: Record<CliProgramName, CliCommand[]> = { inkscape, libreoffice, gimp, ffmpeg };

/** The one way a file leaves the working folder. It asks the founder first (an outside-facing action), in every program. */
export const releaseOutputTool = defineTool({
  name: "release_output",
  description: "Ask the founder to approve putting a finished file from the working folder to use: as the business logo (an SVG or PNG). The founder is always asked first.",
  input: z.object({ path: WorkFile, target: ReleaseTarget }),
  output: ReleaseOut,
  hints: { contactsThirdParty: true },
});

export const cliTools = (p: CliProgramName): AnyToolSpec[] => [...CLI_COMMANDS[p].map((c) => c.spec), releaseOutputTool];
