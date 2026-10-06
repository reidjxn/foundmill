/** Tolerant JSON extraction for model output: plain JSON, fenced ```json blocks, or JSON embedded in prose. */

export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "empty output" };
  const direct = attempt(trimmed);
  if (direct.ok) return direct;
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fence) {
    const inner = attempt((fence[1] ?? "").trim());
    if (inner.ok) return inner;
  }
  const start = trimmed.search(/[{[]/);
  if (start >= 0) {
    const open = trimmed[start];
    const close = open === "{" ? "}" : "]";
    const end = trimmed.lastIndexOf(close);
    if (end > start) {
      const inner = attempt(trimmed.slice(start, end + 1));
      if (inner.ok) return inner;
    }
  }
  return { ok: false, error: direct.ok ? "unreachable" : direct.error };
}

function attempt(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
