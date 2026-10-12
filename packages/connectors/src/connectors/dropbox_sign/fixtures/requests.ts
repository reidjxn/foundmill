import type { HsSignatureRequest } from "../tools";

/** Public test secret: signs mock deliveries in development and test only; ingest never mounts mock webhooks in staging or production (`mockWebhooksAllowed`). */
export const MOCK_DROPBOX_SIGN_API_KEY = "mock_dropbox_sign_api_key";

export const HS_REQUESTS: HsSignatureRequest[] = [
  {
    signature_request_id: "a1f9c2e4b6d8a0c2e4f6a8b0c2d4e6f8a0b2c4d6", title: "Supplier agreement — Hallbergs Hud AB", subject: "Supplier agreement for signature", message: "Please review and sign.", is_complete: true, is_declined: false, has_error: false, test_mode: true, created_at: 1759300000,
    signing_url: null, details_url: "https://app.hellosign.com/home/manage?guid=a1f9c2e4", metadata: { kind: "supplier_agreement", valueMinor: "6800000", currency: "EUR", founderEmail: "reid@northwindskincare.com" },
    signatures: [
      { signature_id: "s1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6", signer_email_address: "order@hallbergshud.se", signer_name: "Karin Hallberg", status_code: "signed", signed_at: 1759400000 },
      { signature_id: "s2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7", signer_email_address: "reid@northwindskincare.com", signer_name: "Reid Jackson", status_code: "signed", signed_at: 1759410000 },
    ],
  },
  {
    signature_request_id: "b2e0d3f5c7e9b1d3f5a7c9e1b3d5f7a9c1e3f5a7", title: "Influencer collaboration — @skinbymaja", subject: "Collaboration agreement", message: null, is_complete: false, is_declined: false, has_error: false, test_mode: true, created_at: 1759500000,
    signing_url: "https://app.hellosign.com/sign/b2e0d3f5", details_url: "https://app.hellosign.com/home/manage?guid=b2e0d3f5", metadata: { kind: "influencer_agreement", valueMinor: "150000", currency: "EUR" },
    signatures: [{ signature_id: "s3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8", signer_email_address: "maja@sensitiveskinclub.se", signer_name: "Maja Lindgren", status_code: "awaiting_signature", signed_at: null }],
  },
];
