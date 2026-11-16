---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T1, what Z.ai's Anthropic-compatible endpoint accepts (step 1)
areas: [models]
supersedes: []
---
## What changed
Ten live calls to `https://api.z.ai/api/anthropic/v1/messages` with `glm-5.3-flash`, through the session proxy (the key
is injected as `Authorization: Bearer`; no key in this file). Cost: a few cents. No code changed.

| Feature | Result |
| --- | --- |
| Bearer auth | Accepted |
| Plain message | Returns Anthropic's message shape: `thinking` block with a `signature`, then `text` |
| `output_config.effort: "low"` | Accepted and honored: no thinking block, 49 output tokens for three one-line ideas |
| `output_config.format` (JSON schema) | Ignored: prose came back, with 3,091 characters of thinking (825 output tokens) |
| `tools` + forced `tool_choice` | Works: `stop_reason: tool_use` with valid input |
| `cache_control` on a 2k-token system block | Accepted; `cache_read_input_tokens` stayed 0 on the repeat call |
| `temperature` | Accepted |
| `max_tokens` | Thinking counts toward it (`max_tokens: 20` stopped inside the thinking) |
| An Anthropic model id (`claude-haiku-4-5-20251001`) | Not refused: answered by a GLM model, with the Claude id echoed in `model` |
| Response headers | `X-Request-Id`, `X-Log-Id`, `X-Process-Time`; no rate-limit headers |
| `usage` | `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `server_tool_use.web_search_requests` |

## Decisions
- `MODEL_CAPABILITIES.glm` starts as effort yes, temperature yes, structured output no (use a forced tool or the
  client's "## Response format" block), prompt cache no, fast mode no. Vision and streaming are checked in step 3.
- Every SDK model slot must name `glm-5.3-flash` (T4): an Anthropic id would be served by an unknown GLM model at an
  unknown price, and the ledger could not tell.
- Effort is the main cost lever: at `low` the model skips thinking. Routes that run at `low` today stay there on GLM.

## Not done
- Step 2 (one Agent SDK run against the endpoint) and step 3 (five measured Ideation calls, streaming and an image).
