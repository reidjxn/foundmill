// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SIGN_OUT_PATH, signOut } from "../auth/sign-out";

describe("signOut", () => {
  it("submits a hidden POST form to the sign-out route", () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
    signOut();
    const form = document.body.querySelector("form");
    expect(form?.method.toUpperCase()).toBe("POST");
    expect(new URL(form!.action).pathname).toBe(SIGN_OUT_PATH);
    expect(form?.hidden).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    submit.mockRestore();
    // Leave the page, as the browser would: the one-time listener goes, so the next test starts clean.
    window.dispatchEvent(new Event("pagehide"));
  });

  it("tells the other tabs as it leaves, not before the POST has cleared the session (audit RES-08)", () => {
    const posted: unknown[] = [];
    class FakeChannel {
      onmessage = null;
      constructor(readonly name: string) {}
      postMessage(m: unknown) {
        posted.push([this.name, m]);
      }
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => undefined);
    signOut();
    // The form is on its way: a tab told now would reach /login while the proxy still accepts the session.
    expect(posted).toEqual([]);
    window.dispatchEvent(new Event("pagehide"));
    expect(posted).toEqual([["foundmill:session", { type: "signed-out", from: expect.any(String) }]]);
    // Once: a page restored from the back/forward cache and left again does not announce twice.
    window.dispatchEvent(new Event("pagehide"));
    expect(posted).toHaveLength(1);
    submit.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("the sign-out route (audit PAS-8)", () => {
  const source = readFileSync(resolve(__dirname, "../../app/auth/signout/route.ts"), "utf8");

  it("answers POST only: a GET that signed out would let any site log the founder out with a link", () => {
    expect(source).toMatch(/export (async )?function POST|export const POST/);
    expect(source).not.toMatch(/export (async )?function GET|export const GET/);
  });

  it("ends this browser's session only, not the founder's other devices", () => {
    expect(source).toContain('signOut({ scope: "local" })');
  });

  it("nothing links to it: every sign-out control posts through lib/auth/sign-out", () => {
    for (const file of ["../../components/shell/BrandPage.tsx", "../../components/shell/UnreachablePage.tsx", "../../components/shell/NotInvitedPage.tsx", "../../components/new/StudioFrame.tsx"]) {
      const text = readFileSync(resolve(__dirname, file), "utf8");
      expect(text, file).not.toContain("/auth/signout");
      expect(text, file).toContain("SignOutButton");
    }
  });
});
