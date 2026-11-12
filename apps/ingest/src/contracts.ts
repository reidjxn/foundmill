/**
 * Signatures that arrive by webhook (Dropbox Sign `signature_request_all_signed`, BUILD §11.11): the connector cannot
 * know which contract row a signature request belongs to, so its `contract.signed` names the request (`docRef`). Here,
 * in the delivery's transaction, the request is matched to the contract whose document reference names it, the
 * contract is recorded as signed (the signature happened on the vendor's side; nothing is signed here), and the event
 * is rewritten to name that contract and its counterparty, so the Contracts register, the event log and the narration
 * all speak of the same contract. A request that names no contract of the business, or one that can no longer be
 * signed, writes nothing: the request id in the vendor's callback is not covered by its signature (SECURITY_REVIEW
 * SEC-11, N1), so "a contract was signed" is only ever said about a contract the business itself tied to that request.
 */
import { repos, type Executor } from "@foundmill/db";
import type { PlatformEvent } from "@foundmill/events";

/** Statuses a webhook may record a signature from: anything still before signature (never a terminated contract). */
const SIGNABLE = new Set(["draft", "review", "awaiting_signature"]);

/**
 * The event, pointed at the contract it signed (and that contract marked signed). Any other event comes back unchanged.
 * `null`: a signature callback that names no signable contract of the business; the caller writes nothing for it.
 */
export async function linkContractSignature(tx: Executor, event: PlatformEvent): Promise<PlatformEvent | null> {
  if (event.type !== "contract.signed") return event;
  const payload = event.payload as { docRef?: string | null; signedAt?: string; counterpartyEntityId?: string } & Record<string, unknown>;
  // No request named: an event the platform itself wrote about a contract it names passes through; a vendor callback does not.
  if (!payload.docRef) return payload.provider === "dropbox_sign" ? null : event;
  const contract = await repos.legal.findContractByDocRef(tx, event.businessId, payload.docRef);
  if (!contract || !SIGNABLE.has(contract.status)) return null;
  const signedAt = payload.signedAt ? new Date(payload.signedAt) : event.occurredAt;
  await repos.legal.transitionContract(tx, event.businessId, contract.id, "signed", { force: true, signedAt: Number.isNaN(signedAt.getTime()) ? event.occurredAt : signedAt });
  const counterpartyEntityId = contract.counterpartyEntityId ?? payload.counterpartyEntityId;
  const entityIds = counterpartyEntityId ? [counterpartyEntityId] : event.entityIds;
  return { ...event, entityIds, payload: { ...payload, contractId: contract.id, ...(counterpartyEntityId ? { counterpartyEntityId } : {}), kind: contract.kind, title: contract.title || (payload.title as string | undefined) || contract.kind } } as PlatformEvent;
}
