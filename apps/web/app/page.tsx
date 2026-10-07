import { APP_NAME, APP_TAGLINE } from "@foundmill/config";

// Placeholder landing page: replaced by the real shell when the web build lands.
const BUILDING = [
  ["Dugout", "design system, tokens, shell, tables, Journey Ribbon, Formation Board"],
  ["Data", "schema, row-level security, repositories, demo businesses"],
  ["Agents", "templates, skills, policy engine, gateway, orchestrator"],
  ["Surfaces", "Home, Inbox, Match Day, departments, agent profiles, CRM"],
];

export default function Page() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 32 }}>
      <section style={{ width: 640, border: "1px solid var(--line-subtle)", borderRadius: "var(--radius-panel)", background: "var(--bg-panel)", boxShadow: "var(--inner-highlight)" }}>
        <header style={{ height: 32, display: "flex", alignItems: "center", padding: "0 12px", background: "var(--bg-panel-alt)", borderBottom: "1px solid var(--line-subtle)", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          Staging build
        </header>
        <div style={{ padding: 20 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 28, lineHeight: "32px" }}>{APP_NAME}</h1>
          <p style={{ margin: "6px 0 18px", fontSize: 13, lineHeight: "19px", color: "var(--text-secondary)" }}>{APP_TAGLINE}</p>
          <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: "19px" }}>The squad is building this environment right now. What is on the training ground:</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {BUILDING.map(([k, v]) => (
              <li key={k} style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 12, fontSize: 13, lineHeight: "19px", padding: "6px 0", borderTop: "1px solid var(--line-subtle)" }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)", paddingTop: 2 }}>{k}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "18px 0 0", fontSize: 12, lineHeight: "16px", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            Desktop only · minimum 1280 px · this page is replaced by the shell when the web build lands.
          </p>
        </div>
      </section>
    </main>
  );
}
