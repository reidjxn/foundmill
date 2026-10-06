/**
 * Dropbox Sign (HelloSign) e-signatures. Sending a request to a counterparty is an external action
 * (contactsThirdParty, irreversible); signing in the founder's name is a hard gate (BUILD §2.2) and exists
 * only as a human-action descriptor.
 */
import { z } from "zod";
import { defineTool } from "../../define";

export const DROPBOX_SIGN_KEY = "dropbox_sign";
export const DROPBOX_SIGN_BASE_URL = "https://api.hellosign.com/v3";
/** Dropbox Sign requires this exact body in the 200 response to a callback. */
export const DROPBOX_SIGN_CALLBACK_RESPONSE = "Hello API Event Received";

export const Signer = z.object({ email: z.email(), name: z.string().min(1).max(200), order: z.number().int().min(0).max(20).optional() });
export const SignatureRequest = z.object({
  signatureRequestId: z.string(),
  title: z.string(),
  subject: z.string().nullable(),
  message: z.string().nullable(),
  isComplete: z.boolean(),
  isDeclined: z.boolean(),
  hasError: z.boolean(),
  testMode: z.boolean(),
  createdAt: z.string(),
  signingUrl: z.string().nullable(),
  detailsUrl: z.string().nullable(),
  signatures: z.array(z.object({ signatureId: z.string(), signerEmail: z.string(), signerName: z.string().nullable(), status: z.string(), signedAt: z.string().nullable() })),
  metadata: z.record(z.string(), z.string()),
});
export type SignatureRequestT = z.infer<typeof SignatureRequest>;

const RequestId = z.string().min(8).max(80);

export const dropboxSignTools = [
  defineTool({ name: "list_signature_requests", description: "Signature requests of the connected account, newest first.", input: z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20) }), output: z.object({ items: z.array(SignatureRequest), numPages: z.number().int() }), hints: {}, untrusted: "api", untrustedRef: (a) => `list:${a.page}`, annotations: { readOnlyHint: true } }),
  defineTool({ name: "get_signature_request", description: "Status of one signature request (who signed, when).", input: z.object({ signatureRequestId: RequestId }), output: SignatureRequest, hints: {}, untrusted: "api", untrustedRef: (a) => `request:${a.signatureRequestId}`, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "send_signature_request",
    description: "Send a document for signature to one or more counterparties. The founder's own signature is a separate, hard-gated step (sign_as_founder). Test mode by default.",
    input: z.object({ title: z.string().min(1).max(255), subject: z.string().max(255).optional(), message: z.string().max(5000).optional(), signers: z.array(Signer).min(1).max(20), fileUrls: z.array(z.url()).min(1).max(10), testMode: z.boolean().default(true), metadata: z.record(z.string().max(40), z.string().max(500)).default({}) }),
    output: SignatureRequest,
    hints: { contactsThirdParty: true, irreversible: true },
  }),
  defineTool({ name: "cancel_signature_request", description: "Cancel an incomplete signature request; signers can no longer sign.", input: z.object({ signatureRequestId: RequestId }), output: z.object({ cancelled: z.literal(true), signatureRequestId: z.string() }), hints: { irreversible: true } }),
  defineTool({
    name: "sign_as_founder",
    description: "HARD GATE (BUILD §2.2): signing anything in the founder's name is never automated. Returns the signing link for the founder to open.",
    input: z.object({ signatureRequestId: RequestId, signatureId: z.string().min(8).max(80).optional(), reason: z.string().max(1000).optional() }),
    hints: { hardGate: true, irreversible: true },
    humanAction: (a) => ({ title: "Sign the document yourself", instructions: `Open signature request ${a.signatureRequestId} in Dropbox Sign, read the document and sign it if you agree. Agents cannot sign on your behalf.${a.reason ? ` Context: ${a.reason}` : ""}`, url: `https://app.hellosign.com/home/manage` }),
  }),
] as const;

export const DROPBOX_SIGN_RATE_LIMITS = { perMinute: 25, perDay: 2_000 };

/* ---- Vendor shapes (subset) ---- */
export interface HsSignature { signature_id: string; signer_email_address: string; signer_name?: string | null; status_code: string; signed_at?: number | null }
export interface HsSignatureRequest { signature_request_id: string; title: string; subject?: string | null; message?: string | null; is_complete: boolean; is_declined: boolean; has_error: boolean; test_mode: boolean; created_at: number; signing_url?: string | null; details_url?: string | null; signatures: HsSignature[]; metadata?: Record<string, string> | null }
export interface HsListResponse { signature_requests: HsSignatureRequest[]; list_info: { num_pages: number; page: number } }

export const mapSignatureRequest = (r: HsSignatureRequest): SignatureRequestT => ({
  signatureRequestId: r.signature_request_id, title: r.title, subject: r.subject ?? null, message: r.message ?? null, isComplete: r.is_complete, isDeclined: r.is_declined, hasError: r.has_error, testMode: r.test_mode,
  createdAt: new Date(r.created_at * 1000).toISOString(), signingUrl: r.signing_url ?? null, detailsUrl: r.details_url ?? null,
  signatures: r.signatures.map((s) => ({ signatureId: s.signature_id, signerEmail: s.signer_email_address, signerName: s.signer_name ?? null, status: s.status_code, signedAt: s.signed_at ? new Date(s.signed_at * 1000).toISOString() : null })),
  metadata: r.metadata ?? {},
});

/** Dropbox Sign's send endpoint is form-encoded with indexed keys. */
export function sendRequestForm(a: { title: string; subject?: string | undefined; message?: string | undefined; signers: { email: string; name: string; order?: number | undefined }[]; fileUrls: string[]; testMode: boolean; metadata: Record<string, string> }): Record<string, string | undefined> {
  const form: Record<string, string | undefined> = { title: a.title, subject: a.subject, message: a.message, test_mode: a.testMode ? "1" : "0" };
  a.signers.forEach((s, i) => { form[`signers[${i}][email_address]`] = s.email; form[`signers[${i}][name]`] = s.name; if (s.order !== undefined) form[`signers[${i}][order]`] = String(s.order); });
  a.fileUrls.forEach((u, i) => { form[`file_urls[${i}]`] = u; });
  for (const [k, v] of Object.entries(a.metadata)) form[`metadata[${k}]`] = v;
  return form;
}
