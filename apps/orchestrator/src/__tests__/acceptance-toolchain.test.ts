/**
 * The acceptance sandbox runs the project with the project's own toolchain (activities/session.ts): the Node of
 * `engines.node`, the pnpm of `packageManager`, and only the packages the acceptance command targets. The first live
 * runs on the Foundmill business died on E2B's base image (Node 20, no pnpm, a whole-workspace install killed), and
 * the root `pnpm test` (every package at once) was killed for memory even on the project's own template: a task's
 * tests now run for the packages it changed.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPTANCE_FALLBACK_COMMAND, acceptanceCommandFor, acceptancePrepareScript, acceptanceRunScript, acceptanceToolchainOf, changedPackageNames, readAcceptanceToolchain, SANDBOX_PNPM } from "../activities/session";

describe("acceptanceToolchainOf", () => {
  it("reads the lowest Node of engines.node, the pinned pnpm and the command's --filter", () => {
    expect(acceptanceToolchainOf({ engines: { node: ">=22.23.3" }, packageManager: "pnpm@12.9.1" }, "pnpm --filter @foundmill/gateway test")).toEqual({ node: "22.23.3", pnpm: "12.9.1", filters: ["@foundmill/gateway"] });
    expect(acceptanceToolchainOf({ engines: { node: "^20.11.0" } }, "pnpm test").node).toBe("20.11.0");
    expect(acceptanceToolchainOf({ engines: { node: "22.x" } }, "pnpm test").node).toBe("22.0.0");
    expect(acceptanceToolchainOf({ engines: { node: "v22" } }, "pnpm test").node).toBe("22.0.0");
    expect(acceptanceToolchainOf({ engines: { node: "22.23.3" } }, "pnpm --filter=./apps/api test").filters).toEqual(["./apps/api"]);
    // Every --filter counts once: a task that changed two packages installs both and what they depend on.
    expect(acceptanceToolchainOf({}, "pnpm --filter @foundmill/web --filter @foundmill/dugout --filter @foundmill/web run --if-present test").filters).toEqual(["@foundmill/web", "@foundmill/dugout"]);
  });

  it("gives null for what it cannot read, and never puts an unsafe filter in a shell command", () => {
    expect(acceptanceToolchainOf({}, "pnpm test")).toEqual({ node: null, pnpm: null, filters: [] });
    expect(acceptanceToolchainOf(null, "pnpm test")).toEqual({ node: null, pnpm: null, filters: [] });
    expect(acceptanceToolchainOf({ packageManager: "yarn@4.0.0", engines: { node: "latest" } }, "pnpm test")).toEqual({ node: null, pnpm: null, filters: [] });
    expect(acceptanceToolchainOf({}, 'pnpm --filter "$(rm -rf /)" test').filters).toEqual([]);
    expect(acceptanceToolchainOf({}, "pnpm --filter 'a b' test").filters).toEqual([]);
    expect(acceptanceToolchainOf({}, "pnpm --filter @scope/pkg... test").filters).toEqual([]);
    expect(acceptanceToolchainOf({}, "pnpm -r test").filters).toEqual([]);
  });

  it("reads the workspace's package.json, and falls back to the empty toolchain without one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fm-toolchain-"));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ engines: { node: ">=22.23.3" }, packageManager: "pnpm@12.9.1" }));
    expect(await readAcceptanceToolchain(dir, "pnpm --filter @foundmill/api test")).toEqual({ node: "22.23.3", pnpm: "12.9.1", filters: ["@foundmill/api"] });
    const empty = await mkdtemp(path.join(tmpdir(), "fm-toolchain-empty-"));
    expect(await readAcceptanceToolchain(empty, "pnpm --filter @foundmill/api test")).toEqual({ node: null, pnpm: null, filters: ["@foundmill/api"] });
    await writeFile(path.join(empty, "package.json"), "{ not json");
    expect(await readAcceptanceToolchain(empty, "pnpm test")).toEqual({ node: null, pnpm: null, filters: [] });
  });
});

describe("acceptanceCommandFor", () => {
  const code = (acceptance: unknown[]) => ({ kind: "code" as const, acceptance: acceptance as never });

  it("takes the command the task's acceptance names, else the tests of the packages the task changed, else every package one at a time", () => {
    expect(acceptanceCommandFor(code([{ command: "pnpm --filter @foundmill/api test" }]), ["@foundmill/web"])).toBe("pnpm --filter @foundmill/api test");
    expect(acceptanceCommandFor(code(["pnpm test passes"]), ["@foundmill/web", "@foundmill/dugout", "@foundmill/web"])).toBe("pnpm --filter @foundmill/dugout --filter @foundmill/web run --if-present test");
    expect(acceptanceCommandFor(code(["pnpm test passes"]))).toBe(ACCEPTANCE_FALLBACK_COMMAND);
    expect(acceptanceCommandFor(code([]), [])).toBe(ACCEPTANCE_FALLBACK_COMMAND);
    expect(ACCEPTANCE_FALLBACK_COMMAND).not.toBe("pnpm test");
    expect(acceptanceCommandFor({ kind: "research" as const, acceptance: [] as never })).toBeNull();
  });

  it("never puts a package name it could not pass to a shell into the command", () => {
    expect(acceptanceCommandFor(code([]), ["$(rm -rf /)", "a b", "@scope/pkg..."])).toBe(ACCEPTANCE_FALLBACK_COMMAND);
    expect(acceptanceCommandFor(code([]), ["$(rm -rf /)", "@foundmill/api"])).toBe("pnpm --filter @foundmill/api run --if-present test");
  });
});

describe("changedPackageNames", () => {
  it("names the nearest package above each path, never the workspace root, and skips what it cannot read", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "fm-scope-"));
    await writeFile(path.join(cwd, "package.json"), JSON.stringify({ name: "foundmill", private: true }));
    for (const [dir, name] of [
      ["apps/web", "@foundmill/web"],
      ["packages/dugout", "@foundmill/dugout"],
      ["packages/odd", "$(rm -rf /)"],
    ] as const) {
      await mkdir(path.join(cwd, dir, "src"), { recursive: true });
      await writeFile(path.join(cwd, dir, "package.json"), JSON.stringify({ name }));
    }
    await mkdir(path.join(cwd, "packages", "nameless", "src"), { recursive: true });
    await writeFile(path.join(cwd, "packages", "nameless", "package.json"), "{ not json");
    const scope = await changedPackageNames(cwd, [
      "apps/web/src/app/page.tsx",
      "apps/web/src/lib/deep/x.ts",
      "packages/dugout/src/Button.tsx",
      "packages/odd/src/a.ts", // its name cannot go into a command
      "packages/nameless/src/a.ts", // a package.json that is not JSON: no name
      "docs/PROGRESS.md", // the root's own: no package
      "../outside.ts", // outside the workspace
      "apps/web/src/removed-earlier.ts", // a removed file still names its package
    ]);
    expect(scope).toEqual(["@foundmill/dugout", "@foundmill/web"]);
    expect(await changedPackageNames(cwd, [])).toEqual([]);
  });
});

describe("acceptancePrepareScript", () => {
  it("installs the project's Node only when the sandbox's is older, the pinned pnpm, and only the packages under test", () => {
    const script = acceptancePrepareScript({ node: "22.23.3", pnpm: "12.9.1", filters: ["@foundmill/gateway"] });
    expect(script).toContain('fm_older "$(node --version 2>/dev/null | sed s/^v//)" "22.23.3"');
    expect(script).toContain("node-linux-x64@22.23.3");
    expect(script).toContain('[ "$(pnpm --version 2>/dev/null)" = "12.9.1" ] ||');
    expect(script).toContain("pnpm@12.9.1");
    expect(script).not.toContain(SANDBOX_PNPM);
    expect(script).toContain('--reporter=append-only --filter "@foundmill/gateway..."');
    // Every install goes through npm with scripts off: nothing a package ships runs while the network is open.
    for (const line of script.split("\n").filter((l) => l.includes("npm install"))) expect(line).toContain("--ignore-scripts");
    expect(script).toContain("--ignore-scripts --ignore-pnpmfile");
    // Two packages: both, with what they depend on.
    expect(acceptancePrepareScript({ node: null, pnpm: null, filters: ["@foundmill/web", "@foundmill/dugout"] })).toContain('--filter "@foundmill/web..." --filter "@foundmill/dugout..."');
  });

  it("without a toolchain keeps today's shape: whatever Node the image has, SANDBOX_PNPM, the whole workspace", () => {
    const script = acceptancePrepareScript();
    expect(script).not.toContain("node-linux-x64");
    expect(script).toContain(`command -v pnpm >/dev/null 2>&1 || (cd "$HOME" && npm install --global --prefix "$HOME/.fm-tools" --ignore-scripts --no-fund --no-audit --loglevel=error ${SANDBOX_PNPM})`);
    expect(script).toContain("--reporter=append-only; fi");
    expect(script).not.toContain("--filter");
  });

  it("the offline phase runs the task's command on the same PATH", () => {
    const script = acceptanceRunScript("pnpm --filter @foundmill/gateway test");
    expect(script).toContain('export PATH="$HOME/.fm-tools/bin:$PATH"');
    expect(script).toContain("pnpm --filter @foundmill/gateway test");
    // A worker per CPU was killed (exit 137) on the first web test run; vitest reads this cap.
    expect(script).toContain("export VITEST_MAX_WORKERS=2");
  });

  it("pins pnpm's package-manager settings through the environment, never through `pnpm config set` (pnpm 12 refuses those keys in its global config)", () => {
    const safe = "export npm_config_manage_package_manager_versions=false npm_config_package_manager_strict=false";
    for (const script of [acceptancePrepareScript({ node: "22.23.3", pnpm: "12.9.1", filters: ["@foundmill/api"] }), acceptancePrepareScript(), acceptanceRunScript("pnpm test")]) {
      expect(script).toContain(safe);
      expect(script).not.toContain("pnpm config set");
    }
    // The environment line comes before any pnpm command, so the first pnpm call already sees it.
    const prepare = acceptancePrepareScript({ node: "22.23.3", pnpm: "12.9.1", filters: ["@foundmill/api"] }).split("\n");
    expect(prepare.indexOf(safe)).toBeLessThan(prepare.findIndex((l) => l.includes("pnpm")));
  });
});
