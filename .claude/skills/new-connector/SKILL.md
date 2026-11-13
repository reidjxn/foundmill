---
name: new-connector
description: Implement one integration against the connector contract (docs/BUILD.md §13.1) with real and mock implementations, webhooks, policy hints and contract tests. Use when adding a vendor connector to packages/connectors.
argument-hint: "<vendor>"
---

# Add a connector

Delegate to the `connector-builder` sub-agent, then check its work against this list.

1. Read `docs/BUILD.md` §13.1, `docs/ARCHITECTURE.md` §8–9 and the newest connector of the same auth kind in `packages/connectors/src/connectors/` (the founder's-own-key ones use auth kind `api_key`).
2. Fetch the vendor's current API docs. Do not write calls from memory.
3. Real and mock implementations. The mock result carries `simulated: true` and a notice; `INTEGRATIONS_MODE=mock` must still run the golden path.
4. Only `apps/gateway` calls the vendor. Keys live sealed in the vault; never in env files, logs or fixtures.
5. Founder's-own-key rule (2026-11-12): no fallback to a Foundmill platform key; not connected means the agent says "not connected". Anything outward or costly is `irreversible`/`spendsMoney`/`contactsThirdParty` as appropriate so it asks first (Needs you) in augmented and assisted mode.
6. Content that comes back from the vendor is untrusted and travels in the untrusted envelope.
7. Webhooks: verify signatures, normalize to declared events (`new-event` skill).
8. Recorded-fixture contract tests; run the `security-reviewer` sub-agent on the change. Finish with `verify-done`.
