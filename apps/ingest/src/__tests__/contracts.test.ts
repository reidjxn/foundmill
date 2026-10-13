/**
 * A Dropbox Sign "all signed" callback records the signature on the contract that names the request (audit W03 #347):
 * the contract becomes signed, the `contract.signed` event names that contract and its counterparty, a redelivery changes
 * nothing, a request that matches no contract is written as the connector reported it, and another business's
 * contract with the same document reference is never touched.
 */
import { repos } from "@foundmill/db";
import { normaliseCallback, type HsCallbackEvent } from "@foundmill/connectors/connectors/dropbox_sign/webhooks";
import { HS_REQUESTS } from "@foundmill/connectors/connectors/dropbox_sign/fixtures/requests";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestPlatformEvents } from "../ingest";
import { createIngestHarness, type IngestHarness } from "./harness";

let hz: IngestHarness;
beforeAll(async () => {
  hz = await createIngestHarness("contracts");
}, 120_000);
afterAll(async () => {
  await hz.close();
});

const REQUEST = HS_REQUESTS[0]!;
const callback = (businessId: string, signatureRequestId = REQUEST.signature_request_id) => {
  const body: HsCallbackEvent = { event: { event_time: "1759300000", event_type: "signature_request_all_signed", event_hash: "unchecked-here", event_metadata: {} }, signature_request: { ...REQUEST, signature_request_id: signatureRequestId } };
  return normaliseCallback(body, businessId);
};

describe("contract.signed from Dropbox Sign", () => {
  it("records the signature on the contract whose document reference names the request, and names that contract in the event", async () => {
    const contract = await repos.legal.createContract(hz.db, hz.A.businessId, { kind: "supplier", title: "Hallbergs Hud AB supplier agreement", counterpartyEntityId: hz.A.entityId, docRef: `https://app.hellosign.com/sign/${REQUEST.signature_request_id}`, status: "awaiting_signature" });
    // another business holds a contract with the same reference: it must stay as it is
    const other = await repos.legal.createContract(hz.db, hz.B.businessId, { kind: "supplier", counterpartyEntityId: hz.B.entityId, docRef: REQUEST.signature_request_id, status: "awaiting_signature" });

    const first = await ingestPlatformEvents(hz.db, callback(hz.A.businessId), { source: "dropbox_sign" });
    expect(first.written).toBe(1);
    const signed = await repos.legal.getContract(hz.db, hz.A.businessId, contract.id);
    expect(signed.status).toBe("signed");
    expect(signed.signedAt).not.toBeNull();
    const [event] = await hz.events(hz.A.businessId, "contract.signed");
    expect(event!.payload).toMatchObject({ contractId: contract.id, counterpartyEntityId: hz.A.entityId, kind: "supplier", provider: "dropbox_sign", docRef: REQUEST.signature_request_id });
    expect(event!.entityIds).toEqual([hz.A.entityId]);

    // the same callback again: no second event, the contract stays as it was
    const again = await ingestPlatformEvents(hz.db, callback(hz.A.businessId), { source: "dropbox_sign" });
    expect(again.written).toBe(0);
    expect(again.duplicates).toBe(1);
    expect(await hz.events(hz.A.businessId, "contract.signed")).toHaveLength(1);

    expect((await repos.legal.getContract(hz.db, hz.B.businessId, other.id)).status).toBe("awaiting_signature");
    expect(await hz.events(hz.B.businessId, "contract.signed")).toHaveLength(0);
  });

  it("writes a request that matches no contract as the connector reported it, and leaves a terminated contract alone", async () => {
    const unknownId = "ffffffffffffffffffffffffffffffffffffffff";
    const result = await ingestPlatformEvents(hz.db, callback(hz.A.businessId, unknownId), { source: "dropbox_sign" });
    expect(result.written).toBe(1);
    const events = await hz.events(hz.A.businessId, "contract.signed");
    const unmatched = events.find((e) => (e.payload as { docRef: string }).docRef === unknownId)!;
    expect(unmatched.payload).toMatchObject({ docRef: unknownId });
    expect((await repos.legal.listContracts(hz.db, hz.A.businessId, {})).items.filter((c) => c.docRef?.includes(unknownId))).toHaveLength(0);

    const ended = await repos.legal.createContract(hz.db, hz.A.businessId, { kind: "nda", counterpartyEntityId: hz.A.entityId, docRef: "ended-request-0001", status: "terminated" });
    await ingestPlatformEvents(hz.db, callback(hz.A.businessId, "ended-request-0001"), { source: "dropbox_sign" });
    expect((await repos.legal.getContract(hz.db, hz.A.businessId, ended.id)).status).toBe("terminated"); // a terminated contract is not revived by a late callback
  });
});
