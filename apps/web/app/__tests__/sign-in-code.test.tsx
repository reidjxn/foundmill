/** The six-digit code from the sign-in email (docs/IDEA_BOX.md): digits only, verified with the address, then `next`. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn(async () => ({ auth: { verifyOtp } })) }));

const { SignInCode, SIGN_IN_CODE_WORDS, cleanCode } = await import("../login/SignInCode");

beforeEach(() => verifyOtp.mockReset());

describe("SignInCode", () => {
  it("keeps digits only, at most six", () => {
    expect(cleanCode(" 12a3-45 678")).toBe("123456");
  });

  it("verifies the code with the address the link went to, then goes where the link would have", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const go = vi.fn();
    render(<SignInCode email="maya@example.com" next="/start?claim=abc" go={go} />);
    const submit = screen.getByRole("button", { name: SIGN_IN_CODE_WORDS.submit });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText(SIGN_IN_CODE_WORDS.label), { target: { value: "123 456" } });
    fireEvent.click(submit);
    await waitFor(() => expect(go).toHaveBeenCalledWith("/start?claim=abc"));
    expect(verifyOtp).toHaveBeenCalledWith({ email: "maya@example.com", token: "123456", type: "email" });
  });

  it("says plainly when the code is wrong, and stays", async () => {
    verifyOtp.mockResolvedValue({ error: { status: 403, message: "Token has expired or is invalid" } });
    const go = vi.fn();
    render(<SignInCode email="maya@example.com" next="/start" go={go} />);
    fireEvent.change(screen.getByLabelText(SIGN_IN_CODE_WORDS.label), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: SIGN_IN_CODE_WORDS.submit }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(SIGN_IN_CODE_WORDS.wrong));
    expect(go).not.toHaveBeenCalled();
    expect(screen.queryByText(/Token has expired/)).toBeNull();
  });
});
