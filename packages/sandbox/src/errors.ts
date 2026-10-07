/** Typed errors for @foundmill/sandbox. All extend the shared AppError so apps map them uniformly. */
import { AppError } from "@foundmill/shared";

export class SandboxError extends AppError {
  constructor(message: string, details?: unknown, code = "sandbox", status = 500) {
    super(code, message, status, details);
    this.name = "SandboxError";
  }
}

/** The requested runner cannot run here (docker binary/daemon missing, no E2B key, ...). Callers fall back or surface it. */
export class SandboxUnavailableError extends SandboxError {
  constructor(
    public readonly provider: string,
    reason: string,
    details?: unknown,
  ) {
    super(`Sandbox provider "${provider}" is unavailable: ${reason}`, details, "sandbox_unavailable", 503);
    this.name = "SandboxUnavailableError";
  }
}

/** Operation not valid in the sandbox's current state (exec before start, write after stop...). */
export class SandboxStateError extends SandboxError {
  constructor(message: string, details?: unknown) {
    super(message, details, "sandbox_state", 409);
    this.name = "SandboxStateError";
  }
}

export interface CredentialFinding {
  /** Environment variable name. The value is never included. */
  name: string;
  /** Stable id of the pattern that matched (see credentials.ts). */
  patternId: string;
  reason: string;
}

/** AC-11.6.6: an environment destined for a sandbox carried a long-lived credential. Never includes the value. */
export class LongLivedCredentialError extends SandboxError {
  constructor(public readonly findings: readonly CredentialFinding[]) {
    super(
      `Refusing to start a sandbox with long-lived credentials in its environment: ${findings
        .map((f) => `${f.name} (${f.patternId})`)
        .join(", ")}`,
      { findings },
      "long_lived_credential",
      400,
    );
    this.name = "LongLivedCredentialError";
  }
}

/** `readFile`/`listFiles` on a path that does not exist in the sandbox. */
export class SandboxFileNotFoundError extends SandboxError {
  constructor(public readonly path: string) {
    super(`No such file or directory in sandbox: ${path}`, { path }, "sandbox_file_not_found", 404);
    this.name = "SandboxFileNotFoundError";
  }
}
