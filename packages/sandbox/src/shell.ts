/** POSIX shell quoting helpers used when composing commands for `Sandbox.exec` (which runs `sh -c`). */

/** Quote one argument for `sh`. Always single-quotes, escaping embedded single quotes. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Join a command and its arguments into one safely quoted shell line. */
export function shellJoin(parts: readonly string[]): string {
  return parts.map(shellQuote).join(" ");
}

/** `KEY=value` assignments for an inline environment prefix (`A=1 B=2 cmd`). Keys must be identifiers. */
export function shellEnvPrefix(env: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`Invalid environment variable name: ${JSON.stringify(k)}`);
    parts.push(`${k}=${shellQuote(v)}`);
  }
  return parts.join(" ");
}
