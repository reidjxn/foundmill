import "./setup";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CodeScreen, PushStatus, firstFile, sessionLabel, toCodeRows } from "../CodeScreen";
import type { CodeFileResponse, CodeFilesResponse, CodeSnapshotSummary, CodeTaskRow } from "../types";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { AGENT_JUNO, AGENT_PIKE, TASK_BUNDLE, TASK_INDEX, agents, agentsResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const SNAP_INDEX_2 = "50000000-0000-4000-8000-000000000002";
const SNAP_INDEX_1 = "50000000-0000-4000-8000-000000000001";
const SNAP_BUNDLE = "50000000-0000-4000-8000-000000000003";

const summary = (id: string, taskId: string, agentId: string, createdAt: string, extra: Partial<CodeSnapshotSummary> = {}): CodeSnapshotSummary => ({ id, taskId, sessionId: null, agentId, branch: `agent/${taskId}`, fileCount: 3, totalBytes: 2048, added: 3, changed: 0, removed: 0, createdAt, ...extra });

const indexLatest = summary(SNAP_INDEX_2, TASK_INDEX, AGENT_PIKE, "2026-10-07T09:30:00Z", { added: 1, changed: 1, removed: 0 });
const indexFirst = summary(SNAP_INDEX_1, TASK_INDEX, AGENT_PIKE, "2026-10-07T08:00:00Z", { fileCount: 2 });
const bundleLatest = summary(SNAP_BUNDLE, TASK_BUNDLE, AGENT_JUNO, "2026-10-06T12:00:00Z", { fileCount: 1, totalBytes: 12 });

const codeList: CodeTaskRow[] = [
  { taskId: TASK_INDEX, title: "Usage index for the Ledgerly dashboard", status: "review", assigneeAgentId: AGENT_PIKE, latest: indexLatest, snapshots: 2 },
  { taskId: TASK_BUNDLE, title: "Add a bundle picker to the product page", status: "running", assigneeAgentId: AGENT_JUNO, latest: bundleLatest, snapshots: 1 },
];

const FILES: Record<string, CodeFilesResponse["snapshot"]> = {
  [SNAP_INDEX_2]: { ...indexLatest, files: [{ path: "README.md", sha256: "a", size: 20 }, { path: "src/index.ts", sha256: "b", size: 30 }, { path: "logo.png", sha256: "c", size: 1998 }] },
  [SNAP_INDEX_1]: { ...indexFirst, files: [{ path: "src/index.ts", sha256: "d", size: 25 }, { path: "package.json", sha256: "e", size: 2 }] },
  [SNAP_BUNDLE]: { ...bundleLatest, files: [{ path: "picker.tsx", sha256: "f", size: 12 }] },
};
const LATEST: Record<string, string> = { [TASK_INDEX]: SNAP_INDEX_2, [TASK_BUNDLE]: SNAP_BUNDLE };
const HISTORY: Record<string, CodeSnapshotSummary[]> = { [TASK_INDEX]: [indexLatest, indexFirst], [TASK_BUNDLE]: [bundleLatest] };
const TEXT: Record<string, string> = { "README.md": "# Usage index\n", "src/index.ts": "export const v = 2;\n", "package.json": "{}", "picker.tsx": "export {};\n" };

const responses = () => ({
  "dev.code.list": codeList,
  "team.agents.list": agentsResponse,
  "dev.code.files": (input?: Record<string, unknown>) => {
    const taskId = input?.taskId as string;
    const snapshot = FILES[(input?.snapshotId as string | undefined) ?? LATEST[taskId]!] ?? null;
    return { taskId, branch: `agent/${taskId}`, snapshot, history: HISTORY[taskId] ?? [] } satisfies CodeFilesResponse;
  },
  "dev.code.file": (input?: Record<string, unknown>) => {
    const path = input?.path as string;
    const entry = Object.values(FILES).flatMap((s) => s?.files ?? []).find((f) => f.path === path)!;
    const binary = path.endsWith(".png");
    return { path, size: entry.size, sha256: entry.sha256, binary, truncated: false, text: binary ? null : TEXT[path]! } satisfies CodeFileResponse;
  },
});

describe("CodeScreen", () => {
  it("lists tasks with saved code and opens the latest session's README", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <CodeScreen {...props} />);
    const table = await screen.findByRole("grid", { name: "Tasks with saved code" });
    expect(within(table).getAllByRole("row")).toHaveLength(codeList.length + 1);
    expect(within(table).getAllByText("Pike").length).toBeGreaterThan(0);
    const files = screen.getByRole("navigation", { name: "Files" });
    expect(within(files).getAllByRole("button").map((b) => b.getAttribute("title"))).toEqual(["README.md", "src/index.ts", "logo.png"]);
    expect(within(files).getByRole("button", { name: /README\.md/ }).getAttribute("aria-current")).toBe("true");
    const viewer = await screen.findByRole("region", { name: "File README.md" });
    await waitFor(() => expect(viewer.textContent).toContain("# Usage index"));
    expect(screen.getByText(`agent/${TASK_INDEX}`)).toBeTruthy();
    expect(screen.getByTestId("code-summary").textContent).toMatch(/^3 files · 2(\.0)? KB · saved .+ by Pike · 1 added, 1 changed, 0 removed by that session$/);
    expect(fake.queried.get("dev.code.file")).toEqual({ snapshotId: SNAP_INDEX_2, path: "README.md" });
  });

  it("opens other files, says when one is binary, and switches tasks", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <CodeScreen {...props} />);
    const files = await screen.findByRole("navigation", { name: "Files" });
    fireEvent.click(within(files).getByRole("button", { name: /index\.ts/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "File src/index.ts" }).textContent).toContain("export const v = 2;"));
    fireEvent.click(within(files).getByRole("button", { name: /logo\.png/ }));
    expect(await screen.findByText("This is a binary file, so it is not shown as text.")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("grid", { name: "Tasks with saved code" })).getByText("Add a bundle picker to the product page"));
    await waitFor(() => expect(fake.queried.get("dev.code.files")).toEqual({ taskId: TASK_BUNDLE }));
    await waitFor(() => expect(screen.getByRole("region", { name: "File picker.tsx" }).textContent).toContain("export {};"));
    // One saved session: its line instead of a picker.
    expect(screen.queryByRole("combobox", { name: "Saved session" })).toBeNull();
    expect(screen.getByText(/^6 Oct, \d\d:00 · 1 file$/)).toBeTruthy();
  });

  it("reads an earlier session and keeps the open file when it still exists", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <CodeScreen {...props} />);
    const files = await screen.findByRole("navigation", { name: "Files" });
    fireEvent.click(within(files).getByRole("button", { name: /index\.ts/ }));
    await user.click(screen.getByRole("combobox", { name: "Saved session" }));
    await user.click(await screen.findByRole("option", { name: /^7 Oct, 0[89]:00 · 2 files$/ }));
    await waitFor(() => expect(fake.queried.get("dev.code.files")).toEqual({ taskId: TASK_INDEX, snapshotId: SNAP_INDEX_1 }));
    await waitFor(() => expect(fake.queried.get("dev.code.file")).toEqual({ snapshotId: SNAP_INDEX_1, path: "src/index.ts" }));
    expect(within(screen.getByRole("navigation", { name: "Files" })).getAllByRole("button").map((b) => b.getAttribute("title"))).toEqual(["src/index.ts", "package.json"]);
  });

  it("navigates to the task on the Plan tab", async () => {
    const fake = createFakeSource({ responses: responses() });
    renderScreen(fake, <CodeScreen {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Show in Plan" }));
    expect(fake.navigations[0]).toBe(`/b/${BUSINESS_ID}/d/development/plan?task=${TASK_INDEX}`);
  });

  it("forgets a task's saved code after confirming, and shows a refusal inline", async () => {
    const user = userEvent.setup();
    let refuse = true;
    const fake = createFakeSource({
      responses: responses(),
      onMutate: (path) => {
        if (path === "dev.code.forget" && refuse) throw new Error("Only owners and admins can do administration");
        return { snapshots: 2, blobs: 3 };
      },
    });
    renderScreen(fake, <CodeScreen {...props} />);
    await user.click(await screen.findByRole("button", { name: "Forget" }));
    const dialog = await screen.findByRole("dialog", { name: "Forget saved code" });
    expect(within(dialog).getByText(/Usage index for the Ledgerly dashboard/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Forget saved code" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(fake.mutations).toEqual([{ path: "dev.code.forget", input: { taskId: TASK_INDEX } }]);
    refuse = false;
    await user.click(within(dialog).getByRole("button", { name: "Forget saved code" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Forget saved code" })).toBeNull());
    expect(fake.refetches["dev.code.list"]).toBe(1);
  });

  it("sets the repository saved code is pushed to, or sends the founder to connect GitHub first", async () => {
    const user = userEvent.setup();
    const notConnected = createFakeSource({ responses: { ...responses(), "dev.code.repository": { connected: false, status: null, repository: null, simulated: true } } });
    const first = renderScreen(notConnected, <CodeScreen {...props} />);
    await user.click(await screen.findByRole("button", { name: "Set up GitHub" }));
    let dialog = await screen.findByRole("dialog", { name: "Push saved code to GitHub" });
    expect(within(dialog).getByText(/not connected for this business yet/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Open Settings › Integrations" }));
    expect(notConnected.navigations).toEqual([`/b/${BUSINESS_ID}/settings/integrations`]);
    first.unmount();

    const connected = createFakeSource({ responses: { ...responses(), "dev.code.repository": { connected: true, status: "mock", repository: null, simulated: true } } });
    renderScreen(connected, <CodeScreen {...props} />);
    await user.click(await screen.findByRole("button", { name: "Set up GitHub" }));
    dialog = await screen.findByRole("dialog", { name: "Push saved code to GitHub" });
    expect(within(dialog).getByText(/Simulated GitHub/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText("Repository"), "acme/shop");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(connected.mutations).toEqual([{ path: "dev.code.setRepository", input: { repository: "acme/shop" } }]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Push saved code to GitHub" })).toBeNull());
    expect(connected.refetches["dev.code.repository"]).toBe(1);
  });

  it("shows whether a save reached GitHub", () => {
    const repo = { connected: true, status: "connected", repository: { fullName: "acme/shop", owner: "acme", repo: "shop", writeEnabled: true }, simulated: false };
    const pushed = { ...indexLatest, pushedRepo: "acme/shop", pushedBranch: `agent/${TASK_INDEX}`, pushedCommitSha: "abc1234def", pushedUrl: "https://github.com/acme/shop/commit/abc1234def" };
    const live = render(<PushStatus snapshot={pushed} repository={repo} />);
    expect(screen.getByRole("link", { name: /Pushed · abc1234/ }).getAttribute("href")).toBe("https://github.com/acme/shop/commit/abc1234def");
    expect(screen.getByRole("link", { name: /Branch on GitHub/ }).getAttribute("href")).toBe(`https://github.com/acme/shop/tree/agent/${TASK_INDEX}`);
    live.unmount();
    const simulated = render(<PushStatus snapshot={pushed} repository={{ ...repo, simulated: true }} />);
    expect(screen.getByTestId("push-status").textContent).toBe("Pushed · abc1234 · simulated");
    expect(screen.queryByRole("link")).toBeNull();
    simulated.unmount();
    const failed = render(<PushStatus snapshot={{ ...indexLatest, pushError: "Update is not a fast forward" }} repository={repo} />);
    expect(screen.getByText("Not pushed")).toBeTruthy();
    expect(screen.getByTitle("Update is not a fast forward")).toBeTruthy();
    failed.unmount();
    const pending = render(<PushStatus snapshot={indexLatest} repository={repo} />);
    expect(screen.getByTestId("push-status").textContent).toBe("Not pushed yet: the next session on the task pushes it");
    pending.unmount();
    render(<PushStatus snapshot={indexLatest} repository={{ ...repo, repository: null }} />);
    expect(screen.getByTestId("push-status").textContent).toBe("Saved here only");
  });

  it("shows the empty, loading and error states", async () => {
    const empty = renderScreen(createFakeSource({ responses: { ...responses(), "dev.code.list": [] } }), <CodeScreen {...props} />);
    expect(await screen.findByText("No saved code yet")).toBeTruthy();
    empty.unmount();
    const loading = renderScreen(createFakeSource({ responses: { "team.agents.list": agentsResponse } }), <CodeScreen {...props} />);
    expect(loading.container.querySelectorAll('[data-state="loading"]').length).toBe(1);
    loading.unmount();
    const failing = createFakeSource({ responses: { ...responses(), "dev.code.list": new Error("database unavailable") } });
    renderScreen(failing, <CodeScreen {...props} />);
    expect((await screen.findAllByText("database unavailable")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(failing.refetches["dev.code.list"]).toBe(1);
  });
});

describe("code helpers", () => {
  it("toCodeRows names the agent that saved the code", () => {
    const rows = toCodeRows(codeList, new Map(agents.map((a) => [a.id, a])));
    expect(rows.map((r) => [r.id, r.agentName, r.fileCount])).toEqual([
      [TASK_INDEX, "Pike", 3],
      [TASK_BUNDLE, "Juno", 1],
    ]);
  });
  it("firstFile prefers a README, then package.json, then the first file", () => {
    expect(firstFile([{ path: "a.ts", sha256: "", size: 1 }, { path: "README.md", sha256: "", size: 1 }])).toBe("README.md");
    expect(firstFile([{ path: "a.ts", sha256: "", size: 1 }, { path: "package.json", sha256: "", size: 1 }])).toBe("package.json");
    expect(firstFile([{ path: "a.ts", sha256: "", size: 1 }])).toBe("a.ts");
    expect(firstFile([])).toBeNull();
  });
  it("sessionLabel marks the latest", () => {
    expect(sessionLabel(indexLatest, true)).toMatch(/^Latest · 7 Oct, \d\d:30 · 3 files$/);
    expect(sessionLabel(bundleLatest, false)).toMatch(/^6 Oct, \d\d:00 · 1 file$/);
  });
});
