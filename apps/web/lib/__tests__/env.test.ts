import { describe, expect, it } from "vitest";
import { hasSupabase, isDevLike, parsePublicEnv, simulatePanelAvailable } from "../env";

describe("public env", () => {
  it("applies defaults and trims trailing slashes", () => {
    const env = parsePublicEnv({ NEXT_PUBLIC_API_URL: "https://api.foundmill.com/", NEXT_PUBLIC_APP_ENV: "staging" });
    expect(env.apiUrl).toBe("https://api.foundmill.com");
    expect(env.streamUrl).toBe("ws://localhost:4003");
    expect(env.appEnv).toBe("staging");
    expect(env.integrationsMode).toBe("mock");
    expect(hasSupabase(env)).toBe(false);
  });

  it("falls back to development for an unknown APP_ENV", () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_APP_ENV: "prod" }).appEnv).toBe("development");
  });

  it("gates the dev bypass and the Simulate panel by environment", () => {
    expect(isDevLike({ appEnv: "development" })).toBe(true);
    expect(isDevLike({ appEnv: "test" })).toBe(true);
    expect(isDevLike({ appEnv: "staging" })).toBe(false);
    expect(isDevLike({ appEnv: "production" })).toBe(false);
    expect(simulatePanelAvailable({ appEnv: "staging" })).toBe(true);
    expect(simulatePanelAvailable({ appEnv: "test" })).toBe(false);
    expect(simulatePanelAvailable({ appEnv: "production" })).toBe(false);
  });

  it("detects a configured Supabase", () => {
    expect(hasSupabase(parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }))).toBe(true);
  });
});
