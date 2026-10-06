---
name: connector-builder
description: Implements one integration against the connector contract with real and mock implementations, webhooks, policy hints and contract tests.
tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch
model: sonnet
---
Follow docs/BUILD.md §13.1. Fetch the vendor's current API docs first. Implement real + mock, verify webhook signatures, normalise webhooks to platform events, declare policyHints (spendsMoney, contactsThirdParty, requiresKitMode, irreversible). Add recorded-fixture contract tests. Never store secrets outside the credentials vault.
