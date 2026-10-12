import { describe, expect, it } from "vitest";
import { WebSocketStatus } from "@hocuspocus/provider";
import { CARET_COLOUR_RE, CARET_TOKENS, caretColourFor, specUserName, toHexColour } from "../spec-user";
import { COLLAB_FIELD, initialMode, isReadOnly, statusFromSocket } from "../SpecEditor";

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
    expect(CARET_TOKENS.map(([, hex]) => hex)).toContain(a);
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => caretColourFor(id))).size).toBeGreaterThan(1);
  });

  it("publishes a six-digit hex the caret extension accepts, never a CSS var() (TPD-31)", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "0f0a0d00-0000-4000-8000-00000000f0a1"]) {
      expect(caretColourFor(id)).toMatch(CARET_COLOUR_RE);
      expect(caretColourFor(id, () => "var(--dept-6)")).toMatch(CARET_COLOUR_RE);
    }
    // The live token wins when it resolves to a hex (a three-digit one is expanded).
    expect(caretColourFor("a", () => " #ABC ")).toBe("#aabbcc");
    expect(caretColourFor("a", () => "#123456")).toBe("#123456");
    expect(toHexColour("rgb(1, 2, 3)")).toBeNull();
    expect(toHexColour("")).toBeNull();
  });

  it("labels the caret with the person's name, never as You", () => {
    expect(specUserName({ name: "Reid Jackson", email: "reid@example.com" })).toBe("Reid Jackson");
    expect(specUserName({ name: "  ", email: "reid@example.com" })).toBe("reid");
    expect(specUserName({ name: null, email: null })).toBe("Founder");
  });

  it("locks the editor when the screen says read only or the collab server grants only readonly (RUI-07)", () => {
    expect(isReadOnly(false, "read-write")).toBe(false);
    expect(isReadOnly(undefined, null)).toBe(false);
    expect(isReadOnly(true, "read-write")).toBe(true);
    expect(isReadOnly(false, "readonly")).toBe(true);
  });
});
