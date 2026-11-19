---
date: 2026-11-19
branch: claude/exciting-heisenberg-ty7njj
title: CLI-Anything programs in the sandbox, as four connectors with staged outputs (Session 4b)
areas: [infra, sandbox, connectors, gateway, agents, evals]
supersedes: []
---
## What changed
- `infra/e2b/e2b.Dockerfile`: installs Inkscape, LibreOffice, FFmpeg and GIMP, and the CLI-Hub packages `cli-anything-inkscape`, `-libreoffice` and `-gimp` from HKUDS/CLI-Anything, pinned to commit `34f519533bc175d2fe287ab8316b0dd99bb9cc43` (`CLI_ANYTHING_COMMIT`). `infra/e2b/README.md` records the commit, the license (Apache-2.0, with the packages' MIT classifier noted) and each program's license. The template must be rebuilt before live use.
- `packages/sandbox/src/cli-anything.ts`: `runCliAnything` runs one command in the project's sandbox. It checks the call against a per-program allow-list (anything not listed does not run, which removes the network, script and open-by-path commands), keeps every path inside the business's working folder, quotes each argument, calls `closeEgress()` first, and reports the files the command made.
- `packages/connectors/src/connectors/cli_anything/`: `cli_inkscape`, `cli_libreoffice`, `cli_ffmpeg`, `cli_gimp`, each with typed tools (real and mock), registered as built-ins (nothing to connect in Settings). Making a file asks nobody; `release_output` carries `contactsThirdParty`, so it asks the founder in augmented and assisted mode. The mock says `simulated`, makes no file and releases only what it "made". `CliRunner` is the new host hook in `LiveConnectorOptions`.
- `apps/gateway/src/cli-runner.ts`, wired in `builtins.ts`: one sandbox per business, started on first use; `release` moves an approved SVG or PNG out of the working folder through the same logo check an upload goes through (`repos.logos.set`). `apps/gateway/package.json` now depends on `@foundmill/sandbox`.
- Grants: Design (`design_to_code`, `packaging_design`) get Inkscape and GIMP; Product (`product_lead`) LibreOffice; Marketing (`channel_content`, `channel_social`, `distribution_strategist`) the programs that fit. Three default skills (`make_brand_assets`, `make_documents_and_decks`, `make_media_files`) come with those roles as release 2 of the role defaults, through a new optional `default_since` front-matter field in `scripts/build-skill-library.mjs` so existing agents are backfilled with only these.
- `evals/src/cli-logo.ts`: a Design agent makes a logo from the brand colors, the file stays staged, and approval puts it on the business.

## Decisions
- **CLI-Hub has no FFmpeg package** at the pinned commit (only `shotcut`, `kdenlive`, `openscreen`, which use FFmpeg). FFmpeg is installed as a program and `cli_ffmpeg` is Foundmill's own typed wrapper with four fixed command shapes. The founder should confirm this, or pick `shotcut`.
- **One JSON call per command:** the wrappers run `cli-anything-<program> --json --project project.json <group> <command>`, never the REPL. Inkscape saves with `-s`; LibreOffice and GIMP save on exit.
- **Only the logo has a destination.** A document, deck or clip stays in the working copy: there is no project file store to release it into, so `release_output` accepts target `logo` only. Adding a destination is a follow-up, not hidden behind a tool that cannot work.
- `apps/gateway/src/pipeline.ts` is untouched; the tools reach the pipeline through the connector contract.

## Not done
- The template was not built and no real program ran: the unit suite uses a stand-in for Inkscape. The live eval needs `E2B_API_KEY` and the rebuilt template.
- The sandbox's working folder is per business, not per task; it is cleared when the sandbox ends (60 minutes).
