/**
 * The sandbox behind the `cli_*` connectors (CLI-Anything, FOUNDMILL.md): one sandbox per business, started on first use,
 * with egress closed by `runCliAnything` before any program runs. Programs write only to the business's own working
 * folder. A file leaves that folder only through `release`, which the pipeline reaches after the founder approved the
 * `release_output` tool: today that puts an SVG or PNG on the business as its logo, through the same check an upload goes through.
 */
import { repos, type Db } from "@foundmill/db";
import type { CliRunner } from "@foundmill/connectors";
import { getSandboxProvider, CLI_WORK_DIR, runCliAnything, shellQuote, type Sandbox } from "@foundmill/sandbox";
import { AppError } from "@foundmill/shared";
import type { LogoInput } from "@foundmill/shared/logo";

export interface CliRunnerDeps {
  db: Db;
  /** Tests hand in a sandbox; the gateway lets `getSandboxProvider` choose from INTEGRATIONS_MODE (mock replays, live is E2B). */
  sandboxFor?: (businessId: string) => Promise<Sandbox>;
}

export function createCliRunner(deps: CliRunnerDeps): CliRunner {
  const open = new Map<string, Promise<Sandbox>>();
  const sandboxFor =
    deps.sandboxFor ??
    ((businessId: string) => {
      let s = open.get(businessId);
      if (!s) {
        s = (async () => {
          const sb = await (await getSandboxProvider()).create({ businessId, taskId: `cli-${businessId}`, egressAllowList: [], ttlMinutes: 60 });
          await sb.start();
          return sb;
        })();
        open.set(businessId, s);
        s.catch(() => open.delete(businessId));
      }
      return s;
    });
  return {
    async run({ businessId, program, argv, folder }) {
      const r = await runCliAnything(await sandboxFor(businessId), { program, argv, folder });
      const text = typeof r.output === "string" ? r.output : JSON.stringify(r.output);
      return { ok: r.ok, summary: text.slice(0, 1_000), stderr: r.stderr, produced: r.produced };
    },
    async release({ businessId, folder, path, target }) {
      const sb = await sandboxFor(businessId);
      const mime = /\.svg$/i.test(path) ? "image/svg+xml" : /\.png$/i.test(path) ? "image/png" : null;
      if (target !== "logo" || !mime) throw new AppError("invalid_output", "Only an SVG or PNG file can become the logo.", 400);
      const file = `${CLI_WORK_DIR}/${folder}/${path}`;
      const read = await sb.exec(`base64 -w0 ${shellQuote(file)}`);
      if (read.code !== 0 || !read.stdout) throw new AppError("not_found", `${path} is not in the working folder.`, 404);
      const bytes = read.stdout.trim();
      const logo: LogoInput = mime === "image/png" ? { mime, base64: bytes } : { mime, svg: Buffer.from(bytes, "base64").toString("utf8") };
      await repos.logos.set(deps.db, businessId, { logo, source: "generated" });
      return { released: true, target, path, where: "the business logo" };
    },
  };
}
