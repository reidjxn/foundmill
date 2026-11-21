---
date: 2026-11-19
branch: claude/exciting-heisenberg-ty7njj
title: CLI-Anything programs in the sandbox, as four connectors with staged outputs (Session 4b)
areas: [infra, sandbox, connectors, gateway, agents, evals]
supersedes: []
---
## What changed
- `infra/e2b/e2b.Dockerfile`: installs Inkscape, LibreOffice, FFmpeg and GIMP, and the CLI-Hub packages `cli-
  anything-inkscape`, `-libreoffice` and `-gimp` from HKUDS/CLI-Anything, pinned to commit
  `34f519533bc175d2fe287ab8316b0dd99bb9cc43` (`CLI_ANYTHING_COMMIT`). `infra/e2b/README.md` records the
  commit, the license (Apache-2.0, with the packages' MIT classifier noted) and each program's license. The
  template must be rebuilt before live use.
- `packages/sandbox/src/cli-anything.ts`: `runCliAnything` runs one command in the project's sandbox. It checks the call against a per-program allow-list (anything not listed does not run, which removes the network, script and open-by-path commands), keeps every path inside the business's working folder, quotes each argument, calls `closeEgress()` first, and reports the files the command made.
- `packages/connectors/src/connectors/cli_anything/`: `cli_inkscape`, `cli_libreoffice`, `cli_ffmpeg`,
  `cli_gimp`, each with typed tools (real and mock), registered as built-ins (nothing to connect in Settings).
  Making a file asks nobody; `release_output` carries `contactsThirdParty`, so it asks the founder in
  augmented and assisted mode. The mock says `simulated`, makes no file and releases only what it "made".
  `CliRunner` is the new host hook in `LiveConnectorOptions`.
- `apps/gateway/src/cli-runner.ts`, wired in `builtins.ts`: one sandbox per business, started on first use; `release` moves an approved SVG or PNG out of the working folder through the same logo check an upload goes through (`repos.logos.set`). `apps/gateway/package.json` now depends on `@foundmill/sandbox`.
- Grants: Design (`design_to_code`, `packaging_design`) get Inkscape and GIMP; Product (`product_lead`)
  LibreOffice; Marketing (`channel_content`, `channel_social`, `distribution_strategist`) the programs that
  fit. Three default skills (`make_brand_assets`, `make_documents_and_decks`, `make_media_files`) come with
  those roles as release 2 of the role defaults, through a new optional `default_since` front-matter field in
  `scripts/build-skill-library.mjs` so existing agents are backfilled with only these.
- `evals/src/cli-logo.ts`: a Design agent makes a logo from the brand colors, the file stays staged, and approval puts it on the business.

## Decisions
- **CLI-Hub has no FFmpeg package** at the pinned commit (only `shotcut`, `kdenlive`, `openscreen`, which use FFmpeg). FFmpeg is installed as a program and `cli_ffmpeg` is Foundmill's own typed wrapper with four fixed command shapes. The founder should confirm this, or pick `shotcut`.
- **One JSON call per command:** the wrappers run `cli-anything-<program> --json --project project.json <group> <command>`, never the REPL. Inkscape saves with `-s`; LibreOffice and GIMP save on exit.
- **Only the logo has a destination.** A document, deck or clip stays in the working copy: there is no project file store to release it into, so `release_output` accepts target `logo` only. Adding a destination is a follow-up, not hidden behind a tool that cannot work.
- `apps/gateway/src/pipeline.ts` is untouched; the tools reach the pipeline through the connector contract.

## Security review (Nov 20)
- **Fixed:** `release_output` only asked in augmented mode; assisted and automated allowed it.
  `packages/policy/src/policies/45-release.cedar` now has `cli-release-asks-founder`, which asks in every
  mode, with a policy test. The release read in `cli-runner.ts` now refuses a link or a file over the upload
  limit. The sandbox check refuses joined path flags (`--output=/abs`) and option-looking positional values,
  and FFmpeg gets a demuxer allow-list. The runner forgets a business's sandbox after 55 minutes.
- **Open, not mine:** `apps/gateway/src/pipeline.ts` (`decisionTypeFor`, about line 827) sends `release_output` to the `message_customers` decision type, which Team › Responsibilities can hand to an agent. It must return null for the `cli_*` `release_output` tools so only the founder decides. Session 5b owns that file.
- **Open, judgment:** text from untrusted content is not forced through the quarantined reader before it becomes a program argument. With the founder asked before any release, the damage is limited to the working copy; a later change can add it to the pipeline's untrusted-session rule.
- **Open, low:** a LibreOffice formula in `set_cell` can link a local file inside the same sandbox; documents cannot be released today.

## Not done
- The template was not built and no real program ran: the unit suite uses a stand-in for Inkscape. The live eval needs `E2B_API_KEY` and the rebuilt template.
- The sandbox's working folder is per business, not per task; it is cleared when the sandbox ends (60 minutes).
