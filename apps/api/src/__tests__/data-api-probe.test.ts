import { describe, expect, it } from "vitest";
import { createDataApiProbe } from "../services/data-api-probe";

const logs = () => {
  const lines: { level: string; msg: string }[] = [];
  const at = (level: string) => (_obj: unknown, msg?: string) => void lines.push({ level, msg: msg ?? "" });
  return { lines, log: { error: at("error"), warn: at("warn"), info: at("info") } as never };
};
const answering = (...answers: (number | Error)[]) => {
  let i = 0;
  return (async () => {
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return new Response(null, { status: a });
  }) as unknown as typeof fetch;
};

describe("createDataApiProbe", () => {
  it("a 2xx is on and logs one error; 503 is off", async () => {
    const { lines, log } = logs();
    const probe = createDataApiProbe({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", log, fetchImpl: answering(200, 200, 503) });
    expect(await probe.refresh()).toBe("on");
    expect(await probe.refresh()).toBe("on");
    expect(lines.filter((l) => l.level === "error")).toHaveLength(1);
    expect(await probe.refresh()).toBe("off");
  });

  it("404 is off; a thrown error or another status keeps the last value", async () => {
    const { log } = logs();
    const probe = createDataApiProbe({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", log, fetchImpl: answering(404, new Error("reset"), 500) });
    expect(await probe.refresh()).toBe("off");
    expect(await probe.refresh()).toBe("off");
    expect(await probe.refresh()).toBe("off");
  });

  it("without the anon key it stays unknown and warns once", async () => {
    const { lines, log } = logs();
    const probe = createDataApiProbe({ supabaseUrl: "https://x.supabase.co", anonKey: undefined, log, fetchImpl: answering(200) });
    expect(await probe.refresh()).toBe("unknown");
    expect(await probe.refresh()).toBe("unknown");
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
