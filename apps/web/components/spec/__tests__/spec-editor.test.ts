import { describe, expect, it } from "vitest";
import { WebSocketStatus } from "@hocuspocus/provider";
import { CARET_COLOURS, caretColourFor } from "../spec-user";
import { COLLAB_FIELD, initialMode, statusFromSocket } from "../SpecEditor";

describe("SpecEditor mode and status (BUILD §11.5)", () => {
  it("opens collaboratively only when a collab URL is configured", () => {
    expect(initialMode("ws://localhost:4004")).toBe("collab");
    expect(initialMode("")).toBe("local");
    expect(initialMode("   ")).toBe("local");
    expect(initialMode(undefined)).toBe("local");
  });

  it("maps the Hocuspocus socket status onto the module contract; connected means synced", () => {
    expect(statusFromSocket(WebSocketStatus.Connecting, false)).toBe("connecting");
    expect(statusFromSocket(WebSocketStatus.Connected, false)).toBe("connecting");
    expect(statusFromSocket(WebSocketStatus.Connected, true)).toBe("connected");
    expect(statusFromSocket(WebSocketStatus.Disconnected, true)).toBe("disconnected");
  });

  it("shares the default Yjs fragment with apps/collab", () => {
    expect(COLLAB_FIELD).toBe("default");
  });

  it("gives every writer a stable department-palette caret colour", () => {
    const a = caretColourFor("0f0a0d00-0000-4000-8000-00000000f0a1");
    expect(a).toBe(caretColourFor("0f0a0d00-0000-4000-8000-00000000f0a1"));
    expect(CARET_COLOURS).toContain(a);
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map(caretColourFor)).size).toBeGreaterThan(1);
  });
});
