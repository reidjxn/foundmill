import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { SpecificationScreen, snapshotText } from "../SpecificationScreen";
import type { SpecEditorProps } from "../../env";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, BLOCK, dataResponses, emptyResponses, versions } from "./fixtures";

describe("SpecificationScreen", () => {
  it("renders the outline grouped by section, selects the first block and shows it in the plain editor", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    const outline = screen.getByRole("navigation", { name: "Spec outline" });
    expect(within(outline).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Problem", "Customers", "Features", "Pricing", "Metrics"]);
    expect(within(outline).getByRole("button", { name: /Invoices go unpaid/ }).getAttribute("aria-current")).toBe("true");
    const editor = screen.getByLabelText("Paragraph text") as HTMLTextAreaElement;
    expect(editor.value).toContain("# Invoices go unpaid");
    expect(screen.getByText("Editing")).toBeTruthy();
    // The internal document name is not founder copy.
    expect(screen.queryByText(`spec:${BID}:${BLOCK.problem}`)).toBeNull();
  });

  it("moves through the outline with the keyboard and locks pinned blocks visibly", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    const outline = screen.getByRole("navigation", { name: "Spec outline" });
    fireEvent.keyDown(outline, { key: "ArrowDown" });
    expect(within(outline).getByRole("button", { name: /Solo consultants/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getAllByText("Pinned").length).toBeGreaterThan(0);
    expect(screen.getByText(/agents cannot change this paragraph without an accepted change proposal/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unpin/ })).toBeTruthy();
  });

  it("saves plain edits through product.spec.editBlock with ProseMirror content and refetches", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    const editor = screen.getByLabelText("Paragraph text") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# Invoices go unpaid\n\nNew paragraph" } });
    await act(async () => {
      fireEvent.keyDown(editor, { key: "s", ctrlKey: true });
    });
    expect(fake.mutations).toHaveLength(1);
    expect(fake.mutations[0]).toEqual({ path: "product.spec.editBlock", input: { blockId: BLOCK.problem, patch: { content: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Invoices go unpaid" }] }, { type: "paragraph", content: [{ type: "text", text: "New paragraph" }] }] } } } });
    expect(fake.refetches["product.spec.get"]).toBe(1);
  });

  it("uses the host's collaborative editor from ModuleEnv with the collab URL and document name", () => {
    const seen: SpecEditorProps[] = [];
    const Host = (props: SpecEditorProps) => {
      seen.push(props);
      return <div data-testid="host-editor">host editor</div>;
    };
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />, { SpecEditor: Host, collabUrl: "wss://collab.example", collabToken: "tok" });
    expect(screen.getByTestId("host-editor")).toBeTruthy();
    expect(seen[0]).toMatchObject({ businessId: BID, blockId: BLOCK.problem, documentName: `spec:${BID}:${BLOCK.problem}`, collabUrl: "wss://collab.example", collabToken: "tok", pinned: false });
    // The host editor shows its own live status; the panel footer does not repeat it.
    expect(screen.queryByText("Connecting")).toBeNull();
  });

  it("lists versions, compares two of them in a diff and restores through product.spec.restore", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    const list = screen.getByRole("list", { name: "Spec versions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("Latest")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Select version 2 for comparison" }));
    fireEvent.click(within(list).getByRole("button", { name: "Select version 3 for comparison" }));
    expect(screen.getByText("Comparing v2 → v3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Compare$/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/10 EUR/)).toBeTruthy();
    expect(within(dialog).getByText(/12 EUR/)).toBeTruthy();
    expect(fake.queried.get("product.spec.compare")).toEqual({ from: 2, to: 3 });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore v2" }));
    const confirm = await screen.findByRole("dialog", { name: /Restore version 2/ });
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Restore" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "product.spec.restore", input: { version: 2 } });
    expect(fake.refetches["product.spec.versions"]).toBe(1);
  });

  it("publishes a version with a changelog", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
    const dialog = await screen.findByRole("dialog", { name: /Publish a spec version/ });
    fireEvent.change(within(dialog).getByLabelText("Changelog"), { target: { value: "Pricing finalised" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "product.spec.publish", input: { changelogMd: "Pricing finalised" } });
  });

  it("gives people who may not change Product a read-only editor and no Pin, Publish or Restore (RUI-07)", () => {
    const seen: SpecEditorProps[] = [];
    const Host = (props: SpecEditorProps) => {
      seen.push(props);
      return <div data-testid="host-editor">host editor</div>;
    };
    const asked: string[] = [];
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />, {
      SpecEditor: Host,
      canWrite: (section) => {
        asked.push(section);
        return false;
      },
    });
    expect(asked).toContain("product");
    expect(seen.at(-1)).toMatchObject({ blockId: BLOCK.problem, readOnly: true });
    expect(screen.queryByRole("button", { name: /^(Pin|Unpin)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Publish$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Restore$/ })).toBeNull();
    // Reading and comparing stay open to everyone.
    expect(screen.getByRole("button", { name: /^Compare$/ })).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);

    // The plain fallback editor is locked too.
    const plain = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(plain, <SpecificationScreen businessId={BID} departmentId="d1" />, { canWrite: () => false });
    expect((screen.getAllByLabelText("Paragraph text").at(-1) as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("offers Pin, Publish and Restore to writers and passes a writable editor", () => {
    const seen: SpecEditorProps[] = [];
    const Host = (props: SpecEditorProps) => {
      seen.push(props);
      return <div data-testid="host-editor">host editor</div>;
    };
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />, { SpecEditor: Host, canWrite: () => true });
    expect(seen.at(-1)).toMatchObject({ readOnly: false });
    expect(screen.getByRole("button", { name: /^Pin$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Publish$/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Restore$/ }).length).toBeGreaterThan(0);
  });

  it("shows empty states for a blank spec and errors with retry", () => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(fake, <SpecificationScreen businessId={BID} departmentId="d1" />);
    expect(screen.getByText("No spec yet")).toBeTruthy();
    expect(screen.getByText(/Pick a paragraph in the outline/)).toBeTruthy();
    expect(screen.getByText(/Versions appear when a change proposal is accepted/)).toBeTruthy();
    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "product.spec.get": new Error("boom") } });
    renderScreen(failing, <SpecificationScreen businessId={BID} departmentId="d1" />);
    expect(screen.getAllByText("boom").length).toBeGreaterThan(0);
  });

  it("flattens a snapshot into section-ordered text for comparison", () => {
    expect(snapshotText(versions[2])).toMatch(/^## Problem\n\n# Invoices go unpaid/);
    expect(snapshotText(null)).toBe("");
  });
});
