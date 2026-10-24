import { describe, expect, it } from "vitest";
import { agentFitsKind, agentUsable, pickAssignee, type AssignableAgent } from "../assignee";

const DEV = "dept-dev";
const FIN = "dept-fin";
const agent = (id: string, agentType: string, over: Partial<AssignableAgent> = {}): AssignableAgent => ({ id, agentType, status: "idle", layer: "worker", departmentIds: [DEV], ...over });

describe("pickAssignee (lead, 2026-10-24: the cycle and Start by hand choose the same agent)", () => {
  const backend = agent("backend", "backend_engineer");
  const frontend = agent("frontend", "frontend_engineer");
  const researcher = agent("researcher", "researcher", { departmentIds: [FIN] });
  const chief = agent("chief", "chief_of_staff", { layer: "assistant", departmentIds: [] });
  const code = { kind: "code", departmentId: DEV };

  it("prefers a worker of the task's department whose template does that kind of work", () => {
    expect(pickAssignee(code, [chief, researcher, frontend, backend])?.id).toBe("frontend");
    expect(pickAssignee({ kind: "research", departmentId: DEV }, [chief, researcher, backend])?.id).toBe("researcher");
  });

  it("takes the requested agent, then the task's own assignee, when they are usable", () => {
    expect(pickAssignee(code, [backend, frontend], { requested: "backend" })?.id).toBe("backend");
    expect(pickAssignee({ ...code, assigneeAgentId: "backend" }, [frontend, backend])?.id).toBe("backend");
    expect(pickAssignee({ ...code, assigneeAgentId: "backend" }, [frontend, agent("backend", "backend_engineer", { status: "paused" })])?.id).toBe("frontend");
  });

  it("never picks a paused, down, failing, released or capped agent, nor a lead or assistant", () => {
    const unusable = [agent("p", "backend_engineer", { status: "paused" }), agent("i", "backend_engineer", { status: "injured" }), agent("f", "backend_engineer", { status: "failing" }), agent("r", "backend_engineer", { archivedAt: new Date() }), agent("c", "backend_engineer", { wageRemainingMinor: 0 })];
    for (const a of unusable) expect(agentUsable(a), a.id).toBe(false);
    // The Chief of Staff is usable but not a worker: never a task's assignee by this rule.
    expect(agentUsable(chief)).toBe(true);
    expect(pickAssignee(code, [...unusable, chief])).toBeNull();
    expect(agentUsable(agent("ok", "backend_engineer", { wageRemainingMinor: 5 }))).toBe(true);
  });

  it("falls back to any worker in the department when none of them does the kind", () => {
    const writer = agent("writer", "copywriter_engine_x", { departmentIds: [DEV] });
    expect(agentFitsKind(writer, "code")).toBe(false);
    expect(pickAssignee(code, [chief, writer])?.id).toBe("writer");
    // No department: any worker that fits, else any worker.
    expect(pickAssignee({ kind: "legal", departmentId: null }, [chief, writer])?.id).toBe("writer");
    // A department with no workers and no worker that fits anywhere: nobody.
    expect(pickAssignee({ kind: "legal", departmentId: "dept-empty" }, [chief, writer])).toBeNull();
  });

  it("avoids an agent already chosen this cycle when another usable agent fits, and takes it when nobody else does", () => {
    expect(pickAssignee(code, [backend, frontend], { exclude: new Set(["backend"]) })?.id).toBe("frontend");
    expect(pickAssignee(code, [backend, frontend], { exclude: ["backend", "frontend"] })?.id).toBe("backend");
    // The requested agent is busy and another fits: the other runs it.
    expect(pickAssignee(code, [backend, frontend], { requested: "backend", exclude: ["backend"] })?.id).toBe("frontend");
  });
});
