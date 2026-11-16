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

Step 3, the same day:

| Check | Result |
| --- | --- |
| Streaming | Anthropic's event stream (`message_start`, `ping`, `content_block_start`, `thinking_delta`, ...). `message_start` reports zero usage, so read usage from the closing events. At `effort: "low"` a streamed call still sent thinking deltas, where the same call without streaming did not |
| Image (base64 PNG) | Works: a red square was named "Red" |
| A concept card (forced tool, low effort, a short system prompt, 317 tokens in) | 326, 412 and 586 tokens out: $0.00021 to $0.00034 a card; 9.2 s, 14.8 s and 19.6 s |

## Decisions
- `MODEL_CAPABILITIES.glm` starts as effort yes, temperature yes, structured output no (use a forced tool or the
  client's "## Response format" block), prompt cache no, fast mode no. Vision and streaming are checked in step 3.
- Every SDK model slot must name `glm-5.3-flash` (T4): an Anthropic id would be served by an unknown GLM model at an
  unknown price, and the ledger could not tell.
- Effort is the main cost lever: at `low` the model skips thinking. Routes that run at `low` today stay there on GLM.
- A card costs about a fifth of the $0.0015 Estimate on this short prompt. Real Ideation prompts carry the house rules
  and more context, so T8 measures them before the Estimate in the research is replaced.
- Speed is the open question: 9 to 20 s a card, where Ideation runs on Opus fast mode today. The cards are written in
  parallel and streamed, so T8 measures time to the first card on the real route before T10.

## Not done
- Step 2 (one Agent SDK run against the endpoint), done with T4's first test.
