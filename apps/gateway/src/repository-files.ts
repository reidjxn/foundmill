/**
 * The business's code repository on its default branch, read by the platform for the Chief of Staff's skill tools
 * (`list_skills` with a folder, `assign_skill` with a file). Each read goes through the gateway's own pipeline as the
 * calling agent, with a token that allows nothing but the two GitHub reads: session scope, rate limit, Cedar, audit and
 * the first-party decision all apply as to any tool call. Only the Code-tab repository at HEAD counts: a read the
 * pipeline does not mark first-party (another repository, a branch, a public repository) is refused, so a skill file
 * reaches an agent's prompt only after it reached the default branch, which takes the founder's merge.
 */
import { repos } from "@foundmill/db";
import type { PlatformCaller } from "@foundmill/connectors";
import { uuid } from "@foundmill/shared";
import type { GatewayDeps } from "./pipeline";
import type { RepositoryFiles } from "./platform-host";
import type { SessionToken } from "./tokens";
import { tracedToolCall } from "./tracing";
import { CallRequest } from "./types";

const READ_TOOLS = ["github:read_file", "github:read_tree"];
const FOLDER_LIMIT = 200;

type Read<T> = { data: T } | { error: string };

export function createRepositoryFiles(deps: GatewayDeps): RepositoryFiles {
  const token = (caller: PlatformCaller): SessionToken => {
    const iat = Math.floor(Date.now() / 1000);
    return { businessId: caller.businessId, agentId: caller.agentId, sessionId: caller.sessionId, allowedTools: READ_TOOLS, kitMode: false, untrustedSeeded: false, jti: `platform-skills:${uuid()}`, iat, exp: iat + 120 };
  };
  const read = async <T>(caller: PlatformCaller, tool: "read_file" | "read_tree", args: Record<string, unknown>): Promise<Read<T>> => {
    const target = await repos.integrations.codeRepository(deps.db, caller.businessId);
    if (!target) return { error: "no repository is chosen on the Code tab" };
    const req = CallRequest.parse({ connector: "github", tool, args: { owner: target.owner, repo: target.repo, ref: "HEAD", ...args } });
    const { body } = await tracedToolCall(deps, token(caller), req);
    if (body.outcome !== "allow") return { error: body.outcome === "rate_limited" ? "GitHub reads are rate limited right now; try again shortly" : (body.reasons?.[0] ?? "the read was refused") };
    if (!body.result.ok) return { error: body.result.error?.message ?? "GitHub did not answer" };
    const data = body.result.data as { firstParty?: unknown; content?: unknown } | undefined;
    // First-party only: the Code-tab repository, private, at its default branch (decideFirstParty).
    if (data?.firstParty !== true) return { error: `only files of ${target.fullName} on its default branch can become skills` };
    return { data: data.content as T };
  };
  return {
    async listFolder(caller, folder) {
      const path = folder.replace(/^\/+|\/+$/g, "");
      const r = await read<{ entries?: { path: string; type: string }[] }>(caller, "read_tree", { path, recursive: false });
      if ("error" in r) return r;
      const paths = (r.data.entries ?? []).filter((e) => e.type === "blob").map((e) => (path && !e.path.startsWith(`${path}/`) ? `${path}/${e.path}` : e.path));
      return { paths: paths.slice(0, FOLDER_LIMIT) };
    },
    async readFile(caller, path) {
      const r = await read<{ content?: unknown; encoding?: unknown }>(caller, "read_file", { path: path.replace(/^\/+/, "") });
      if ("error" in r) return r;
      if (r.data.encoding !== "utf-8" || typeof r.data.content !== "string") return { error: `${path} is not a text file` };
      return { content: r.data.content };
    },
  };
}
