// @vitest-environment happy-dom
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
  });
});
