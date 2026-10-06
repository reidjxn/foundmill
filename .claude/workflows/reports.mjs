// Usage: node reports.mjs <journal.jsonl> <title> > docs/WAVEn_REPORTS.md
import { readFileSync } from "node:fs";
const [journal, title] = process.argv.slice(2);
const lines = readFileSync(journal, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const labels = new Map();
for (const l of lines) if (l.type === "started") labels.set(l.agentId, l.label);
const out = [`# ${title}`, "", "Reports returned by the build agents (verbatim summaries, exports, commands, stubs, open issues). Generated from the workflow journal.", ""];
for (const l of lines) {
  if (!l.result) continue;
  const r = l.result; const label = l.label || labels.get(l.agentId) || "?";
  out.push(`## ${label} — ${r.package ?? ""}`, "", r.summary ?? "", "", "**Exports / contracts**", "", r.exports ?? "", "");
  if (r.commands?.length) { out.push("**Commands**", ""); for (const c of r.commands) out.push(`- ${c.passed ? "PASS" : "FAIL"} \`${c.cmd}\`${c.note ? ` — ${c.note}` : ""}`); out.push(""); }
  if (r.stubs?.length) { out.push("**Stubs**", ""); for (const s of r.stubs) out.push(`- ${s}`); out.push(""); }
  if (r.neededDeps?.length) { out.push("**Needed deps**", ""); for (const s of r.neededDeps) out.push(`- ${s}`); out.push(""); }
  if (r.openIssues?.length) { out.push("**Open issues**", ""); for (const s of r.openIssues) out.push(`- ${s}`); out.push(""); }
}
process.stdout.write(out.join("\n"));
