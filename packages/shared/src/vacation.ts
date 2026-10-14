/**
 * The words after "On vacation until " in the top bar. A vacation that ends on a condition stores the founder's own
 * sentence ("until I return", "when the launch ships"); the bar adds "until" itself, so the label drops a leading
 * "until", "when", "once" or "after" and speaks to the founder ("you return"). Audit VOL-X2: the bar read "Until until I return".
 */
export function vacationUntilLabel(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "you return";
  const rest = t.replace(/^(?:until|when|once|after)\s+/i, "").trim();
  if (!rest || /^i(?:'m| am)? (?:return|back)$/i.test(rest)) return "you return";
  return rest;
}
