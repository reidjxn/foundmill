import { describe, expect, it } from "vitest";
import { googleSignInEnabled, hasSupabase, isDevLike, parsePublicEnv, simulatePanelAvailable } from "../env";

describe("public env", () => {
  it("applies defaults and trims trailing slashes", () => {
    const env = parsePublicEnv({ NEXT_PUBLIC_API_URL: "https://api.foundmill.com/", NEXT_PUBLIC_APP_ENV: "staging" });
    expect(env.apiUrl).toBe("https://api.foundmill.com");
    expect(env.streamUrl).toBe("ws://localhost:4003");
    expect(env.collabUrl).toBe("");
    expect(parsePublicEnv({ NEXT_PUBLIC_COLLAB_URL: "wss://collab.foundmill.com/" }).collabUrl).toBe("wss://collab.foundmill.com");
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

  it("reads the store links from the one value: null until it is set (WP-03 T9)", () => {
    expect(parsePublicEnv({}).storeLinks).toBeNull();
    expect(parsePublicEnv({ NEXT_PUBLIC_STORE_LINKS: "" }).storeLinks).toBeNull();
    expect(parsePublicEnv({ NEXT_PUBLIC_STORE_LINKS: "https://example.com/app" }).storeLinks).toBeNull();
    const ios = "https://apps.apple.com/us/app/foundmill/id1234567890";
    const android = "https://play.google.com/store/apps/details?id=com.foundmill.app";
    expect(parsePublicEnv({ NEXT_PUBLIC_STORE_LINKS: `${android},${ios}` }).storeLinks).toEqual({ ios, android });
  });

  it("detects a configured Supabase", () => {
    expect(hasSupabase(parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }))).toBe(true);
  });

  it("offers Continue with Google only when NEXT_PUBLIC_AUTH_GOOGLE is on (off by default, so it is never a dead end before setup)", () => {
    expect(googleSignInEnabled(parsePublicEnv({}))).toBe(false);
    expect(googleSignInEnabled(parsePublicEnv({ NEXT_PUBLIC_AUTH_GOOGLE: "" }))).toBe(false);
    expect(googleSignInEnabled(parsePublicEnv({ NEXT_PUBLIC_AUTH_GOOGLE: "off" }))).toBe(false);
    expect(googleSignInEnabled(parsePublicEnv({ NEXT_PUBLIC_AUTH_GOOGLE: "true" }))).toBe(false);
    expect(googleSignInEnabled(parsePublicEnv({ NEXT_PUBLIC_AUTH_GOOGLE: "on" }))).toBe(true);
    expect(googleSignInEnabled(parsePublicEnv({ NEXT_PUBLIC_AUTH_GOOGLE: " ON " }))).toBe(true);
  });
});
