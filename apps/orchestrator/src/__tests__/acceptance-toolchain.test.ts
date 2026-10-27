/**
 * The acceptance sandbox runs the project with the project's own toolchain (activities/session.ts): the Node of
 * `engines.node`, the pnpm of `packageManager`, and only the package the acceptance command targets. The first live
 * runs on the Foundmill business died on E2B's base image (Node 20, no pnpm, a whole-workspace install killed).
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptancePrepareScript, acceptanceRunScript, acceptanceToolchainOf, readAcceptanceToolchain, SANDBOX_PNPM } from "../activities/session";

describe("acceptanceToolchainOf", () => {
  it("reads the lowest Node of engines.node, the pinned pnpm and the command's --filter", () => {
    expect(acceptanceToolchainOf({ engines: { node: ">=22.23.3" }, packageManager: "pnpm@12.9.1" }, "pnpm --filter @foundmill/gateway test")).toEqual({ node: "22.23.3", pnpm: "12.9.1", filter: "@foundmill/gateway" });
    expect(acceptanceToolchainOf({ engines: { node: "^20.11.0" } }, "pnpm test").node).toBe("20.11.0");
    expect(acceptanceToolchainOf({ engines: { node: "22.x" } }, "pnpm test").node).toBe("22.0.0");
    expect(acceptanceToolchainOf({ engines: { node: "v22" } }, "pnpm test").node).toBe("22.0.0");
    expect(acceptanceToolchainOf({ engines: { node: "22.23.3" } }, "pnpm --filter=./apps/api test").filter).toBe("./apps/api");
  });

  it("gives null for what it cannot read, and never puts an unsafe filter in a shell command", () => {
    expect(acceptanceToolchainOf({}, "pnpm test")).toEqual({ node: null, pnpm: null, filter: null });
    expect(acceptanceToolchainOf(null, "pnpm test")).toEqual({ node: null, pnpm: null, filter: null });
    expect(acceptanceToolchainOf({ packageManager: "yarn@4.0.0", engines: { node: "latest" } }, "pnpm test")).toEqual({ node: null, pnpm: null, filter: null });
    expect(acceptanceToolchainOf({}, 'pnpm --filter "$(rm -rf /)" test').filter).toBeNull();
    expect(acceptanceToolchainOf({}, "pnpm --filter 'a b' test").filter).toBeNull();
    expect(acceptanceToolchainOf({}, "pnpm --filter @scope/pkg... test").filter).toBeNull();
    expect(acceptanceToolchainOf({}, "pnpm -r test").filter).toBeNull();
  });

  it("reads the workspace's package.json, and falls back to the empty toolchain without one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fm-toolchain-"));
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ engines: { node: ">=22.23.3" }, packageManager: "pnpm@12.9.1" }));
    expect(await readAcceptanceToolchain(dir, "pnpm --filter @foundmill/api test")).toEqual({ node: "22.23.3", pnpm: "12.9.1", filter: "@foundmill/api" });
    const empty = await mkdtemp(path.join(tmpdir(), "fm-toolchain-empty-"));
    expect(await readAcceptanceToolchain(empty, "pnpm --filter @foundmill/api test")).toEqual({ node: null, pnpm: null, filter: "@foundmill/api" });
    await writeFile(path.join(empty, "package.json"), "{ not json");
    expect(await readAcceptanceToolchain(empty, "pnpm test")).toEqual({ node: null, pnpm: null, filter: null });
  });
});

describe("acceptancePrepareScript", () => {
  it("installs the project's Node only when the sandbox's is older, the pinned pnpm, and only the package under test", () => {
    const script = acceptancePrepareScript({ node: "22.23.3", pnpm: "12.9.1", filter: "@foundmill/gateway" });
    expect(script).toContain('fm_older "$(node --version 2>/dev/null | sed s/^v//)" "22.23.3"');
    expect(script).toContain("node-linux-x64@22.23.3");
    expect(script).toContain('[ "$(pnpm --version 2>/dev/null)" = "12.9.1" ] ||');
    expect(script).toContain("pnpm@12.9.1");
    expect(script).not.toContain(SANDBOX_PNPM);
    expect(script).toContain('--reporter=append-only --filter "@foundmill/gateway..."');
    // Every install goes through npm with scripts off: nothing a package ships runs while the network is open.
    for (const line of script.split("\n").filter((l) => l.includes("npm install"))) expect(line).toContain("--ignore-scripts");
    expect(script).toContain("--ignore-scripts --ignore-pnpmfile");
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
  });

  it("pins pnpm's package-manager settings through the environment, never through `pnpm config set` (pnpm 12 refuses those keys in its global config)", () => {
    const safe = "export npm_config_manage_package_manager_versions=false npm_config_package_manager_strict=false";
    for (const script of [acceptancePrepareScript({ node: "22.23.3", pnpm: "12.9.1", filter: "@foundmill/api" }), acceptancePrepareScript(), acceptanceRunScript("pnpm test")]) {
      expect(script).toContain(safe);
      expect(script).not.toContain("pnpm config set");
    }
    // The environment line comes before any pnpm command, so the first pnpm call already sees it.
    const prepare = acceptancePrepareScript({ node: "22.23.3", pnpm: "12.9.1", filter: "@foundmill/api" }).split("\n");
    expect(prepare.indexOf(safe)).toBeLessThan(prepare.findIndex((l) => l.includes("pnpm")));
  });
});
