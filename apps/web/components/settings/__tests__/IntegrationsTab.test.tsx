// @vitest-environment happy-dom
/**
 * The Simulate panel (SEC-2): every click is a `dev.simulate` mutation through the API; the browser never fetches
 * apps/ingest and sends no credential of its own.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import type * as SharedModule from "../shared";

const simulate = vi.fn();
const setPostal = vi.fn();
const toast = { saved: vi.fn(), failed: vi.fn(), info: vi.fn() };
const invalidate = vi.fn(async () => undefined);

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    integrations: {
      setPostalAddress: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "setPostalAddress"]], mutationFn: (vars: unknown) => setPostal(vars), ...opts }),
      },
    },
    dev: {
      simulate: {
        mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["dev", "simulate"]], mutationFn: (vars: unknown) => simulate(vars), ...opts }),
      },
    },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({ useBusiness: () => ({ businessId: "b1", isAdmin: true, data: { role: "owner", business: {} }, departments: [] }) }));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => toast }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => invalidate }));

import { ConnectFieldsDialog, connectInputFrom, needsConnectFields, PlatformMailSection, PostalAddressField, SimulatePanel, type ConnectFieldView, type PlatformMailView } from "../IntegrationsTab";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SimulatePanel businessId={BUSINESS} connectors={[{ key: "stripe", label: "Stripe", simulations: ["payment.received", "signup.created"] }]} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("SimulatePanel (Settings › Integrations › Simulate)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    simulate.mockReset();
    toast.saved.mockReset();
    toast.failed.mockReset();
    invalidate.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("calls dev.simulate with the business and event name, shows the API's answer and never fetches ingest", async () => {
    simulate.mockResolvedValue({ ok: true, status: 200, body: { ok: true, written: 1, duplicates: 0, connector: "stripe", label: "Simulated" }, label: "Simulated" });
    renderPanel();
    expect(screen.getByTestId("simulate-panel")).toBeTruthy();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-simulate="payment.received"]')!);
    });
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate).toHaveBeenCalledWith({ businessId: BUSINESS, eventName: "payment.received" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("simulate-result").textContent).toContain("payment.received → 200");
    expect(screen.getByTestId("simulate-result").textContent).toContain('"written": 1');
    expect(toast.saved).toHaveBeenCalledWith("Simulated", "payment.received went through the same path as a real event.");
    expect(invalidate).toHaveBeenCalledWith(["inbox", "journey", "finance", "integrations", "distribution"]);
  });

  it("shows a refusal from ingest verbatim and a failed mutation (viewer, unreachable) as a toast", async () => {
    simulate.mockResolvedValueOnce({ ok: false, status: 400, body: { ok: false, error: "unknown_simulation" }, label: "Simulated" });
    renderPanel();
    await act(async () => {
      fireEvent.click(document.querySelector('[data-simulate="signup.created"]')!);
    });
    expect(screen.getByTestId("simulate-result").textContent).toContain("signup.created → 400");
    expect(toast.failed).toHaveBeenCalledTimes(1);
    expect((toast.failed.mock.calls[0]![0] as Error).message).toBe('400: {"ok":false,"error":"unknown_simulation"}');
    expect(invalidate).not.toHaveBeenCalled();

    simulate.mockRejectedValueOnce(new Error("Your role (viewer) cannot perform administration"));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-simulate="payment.received"]')!);
    });
    expect(toast.failed).toHaveBeenCalledTimes(2);
    expect(toast.failed.mock.calls[1]![1]).toBe("Simulation failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Connect with the founder's own key (live API-key connectors)", () => {
  const FIELDS: ConnectFieldView[] = [
    { name: "apiKey", label: "API key", secret: true, required: true, placeholder: "SG.…", hint: "Sending is billed to your SendGrid account." },
    { name: "subuser", label: "Subuser", secret: false, required: false },
  ];

  it("asks for a key only when the connector runs live and declares fields to enter", () => {
    expect(needsConnectFields({ live: true, connectFields: FIELDS })).toBe(true);
    expect(needsConnectFields({ live: false, connectFields: FIELDS })).toBe(false);
    expect(needsConnectFields({ live: true, connectFields: [] })).toBe(false);
  });

  it("builds the connect input from what was typed: trimmed, optional blanks left out, nothing while a required field is empty", () => {
    expect(connectInputFrom(FIELDS, {})).toBeNull();
    expect(connectInputFrom(FIELDS, { apiKey: "   " })).toBeNull();
    expect(connectInputFrom(FIELDS, { apiKey: " SG.key ", subuser: "" })).toEqual({ apiKey: "SG.key" });
    expect(connectInputFrom(FIELDS, { apiKey: "SG.key", subuser: "eu" })).toEqual({ apiKey: "SG.key", subuser: "eu" });
  });

  it("masks the key and connects with exactly what was entered", async () => {
    const onConnect = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <ConnectFieldsDialog connector={{ key: "sendgrid", displayName: "SendGrid", connectFields: FIELDS }} pending={false} onConnect={onConnect} onClose={() => undefined} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Connect SendGrid")).toBeTruthy();
    expect(screen.getByText(/SendGrid bills it for what agents do/)).toBeTruthy();
    const key = document.getElementById("connect-sendgrid-apiKey") as HTMLInputElement;
    expect(key.type).toBe("password");
    const submit = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await act(async () => {
      fireEvent.change(key, { target: { value: "SG.founder-key" } });
    });
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(onConnect).toHaveBeenCalledWith({ apiKey: "SG.founder-key" });
  });

  it("forgets the typed key once the dialog closes or opens for another connector, so it is never offered to the next vendor", async () => {
    const dialog = (connector: { key: string; displayName: string; connectFields: ConnectFieldView[] } | null) => (
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <ConnectFieldsDialog connector={connector} pending={false} onConnect={() => undefined} onClose={() => undefined} />
        </TooltipProvider>
      </QueryClientProvider>
    );
    const sendgrid = { key: "sendgrid", displayName: "SendGrid", connectFields: FIELDS };
    const dropboxSign = { key: "dropbox_sign", displayName: "Dropbox Sign", connectFields: [FIELDS[0]!] };
    const { rerender } = render(dialog(sendgrid));
    await act(async () => {
      fireEvent.change(document.getElementById("connect-sendgrid-apiKey")!, { target: { value: "SG.founder-key" } });
    });
    expect((document.getElementById("connect-sendgrid-apiKey") as HTMLInputElement).value).toBe("SG.founder-key");
    // Straight to another connector: its key field starts empty.
    await act(async () => rerender(dialog(dropboxSign)));
    expect((document.getElementById("connect-dropbox_sign-apiKey") as HTMLInputElement).value).toBe("");
    // A successful connect closes the dialog from outside; opening it again starts empty too.
    await act(async () => rerender(dialog(null)));
    await act(async () => rerender(dialog(sendgrid)));
    expect((document.getElementById("connect-sendgrid-apiKey") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PlatformMailSection (Settings › Integrations › Email from your project)", () => {
  const view = (over: Partial<PlatformMailView> = {}): PlatformMailView => ({ address: "evergreen@mail.foundmill.com", sentToday: 3, cap: 50, paused: false, live: true, ownSender: false, ...over });
  const show = (data: PlatformMailView | null) =>
    render(
      <TooltipProvider>
        <PlatformMailSection data={data} />
      </TooltipProvider>,
    );

  it("shows the address, today's count against the cap and the line about outside contact", () => {
    show(view());
    expect(screen.getByText("Email from your project")).toBeTruthy();
    expect(screen.getByTestId("platform-mail-address").textContent).toBe("evergreen@mail.foundmill.com");
    expect(screen.getByTestId("platform-mail-count").textContent).toBe("3 of 50 sent today");
    expect(screen.getByText("Messages to people outside the project wait for your OK unless you said otherwise in What the team can do.")).toBeTruthy();
    expect(screen.queryByText(/simulated/i)).toBeNull();
  });

  it("says when sending is simulated, paused, or goes through the founder's own SendGrid", () => {
    show(view({ live: false, paused: true, ownSender: true, sentToday: 1_200, cap: 2_000 }));
    expect(screen.getByTestId("platform-mail-count").textContent).toBe("1,200 of 2,000 sent today");
    expect(screen.getByText("Sending is simulated here: no message leaves for real.")).toBeTruthy();
    expect(screen.getByText("Sending from this address is paused for now. Nothing is waiting on you.")).toBeTruthy();
    expect(screen.getByText("Your own email account is connected, so the team sends from it instead.")).toBeTruthy();
  });

  it("renders no row at all when the feature is off", () => {
    const { container } = show(null);
    expect(container.querySelector('[data-testid="platform-mail"]')).toBeNull();
  });
});

describe("PostalAddressField (the founders' postal address for marketing email, US CAN-SPAM)", () => {
  const show = (value: string | null, canEdit = true) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <PostalAddressField businessId={BUSINESS} value={value} canEdit={canEdit} />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  };
  beforeEach(() => {
    setPostal.mockReset();
    toast.saved.mockReset();
    invalidate.mockClear();
  });

  it("says why the law asks for it, that a PO box is fine and that it stays off the public page", () => {
    show(null);
    const field = screen.getByTestId("postal-address");
    expect(field.textContent).toContain("By law in the US, every marketing email must show the sender's postal address");
    expect(field.textContent).toContain("A PO box is fine.");
    expect(field.textContent).toContain("It is never shown on your public page");
    expect(screen.getByTestId("postal-address-missing").textContent).toBe("Until you add it, the team cannot send marketing emails from this address.");
  });

  it("refuses what is not an address in plain words, and saves a PO box", async () => {
    setPostal.mockResolvedValue({ address: "PO Box 1234, Springfield, IL 62701, USA", answeredNoteId: null });
    show(null);
    const input = screen.getByLabelText("Postal address for your emails") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "www.example.com 12" } });
    expect(screen.getByText("Enter a postal address, not a web or email address.")).toBeTruthy();
    expect((screen.getByTestId("postal-address-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "PO Box 1234, Springfield, IL 62701, USA" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("postal-address-save"));
    });
    expect(setPostal).toHaveBeenCalledWith({ businessId: BUSINESS, address: "PO Box 1234, Springfield, IL 62701, USA" });
    expect(toast.saved).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith(["integrations", "inbox", "today"]);
  });

  it("is read-only for a collaborator, who is told only the founders change it", () => {
    show(null, false);
    expect((screen.getByLabelText("Postal address for your emails") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId("postal-address-save")).toBeNull();
    expect(screen.getByTestId("postal-address").textContent).toContain("Only the founders can change it.");
  });
});
