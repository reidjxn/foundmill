---
date: 2026-11-15
branch: claude/fix-personas-test-collision
title: The persona batch test asks for a key no agent holds
areas: [db, tests]
supersedes: []
---
## What changed
`packages/db/src/__tests__/repos/personas.test.ts`, "replaces a given key a live agent of the business already holds
with a fresh pick", asked for `PERSONAS[21]` in its batch step. An earlier hire in the same test ("Second") gets a
random fresh key, and when that random key was `PERSONAS[21]` the batch's first agent was rightly given a fresh pick
too, so the test failed (CI run 43753063102, #179: expected 'rohan', got 'tara'). The batch step now asks for a key no
agent of the business holds yet.

## Decisions
- The code is right (a key a live agent holds is never given twice); only the test assumed the random pick missed one
  key.

## Not done
- Nothing else in the file depends on a random pick missing a fixed key.
