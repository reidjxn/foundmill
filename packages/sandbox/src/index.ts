// @foundmill/sandbox — sandbox runners for agent sessions (docs/ARCHITECTURE.md §1, BUILD §3.1, §9.3,
// §11.6, §13.3, §14). One interface (`Sandbox`/`SandboxProvider`), three runners: mock (replays recorded
// sessions), local Docker, E2B. `getSandboxProvider()` picks one from INTEGRATIONS_MODE and availability.
export * from "./types";
export * from "./errors";
export * from "./credentials";
export * from "./shell";
export * from "./worktree";
export * from "./mock/recording";
export * from "./mock/recordings";
export * from "./mock/replay";
export * from "./docker";
export * from "./e2b";
export * from "./provider";
export * from "./browser";
export * from "./cli-anything";
