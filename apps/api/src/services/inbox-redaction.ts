/**
 * Section walls in the Inbox (BUILD §11.9; audit RUI-02): the implementation lives in packages/db
 * (`@foundmill/db/inbox-redaction`) since the security review of Nov 11, 2026, so the api and the gateway's email to a
 * person mask a note the same way. This module only re-exports it for the api's procedures.
 */
export * from "@foundmill/db/inbox-redaction";
