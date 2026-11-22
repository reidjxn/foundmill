# Third-party skills in this folder

Copied on Nov 15, 2026 from the founder's installed Claude Code plugins, unchanged except that each collection's `evals/` folders were left out. They are here because a cloud session loads only the skills that live in the repository (decision of the same date in docs/DECISIONS.md). This repo's own skills (`gate`, `new-agent-template`, `new-connector`, `new-event`, `new-screen`, `plan-change`, `rls-test`, `ship-change`, `verify-done`) are not listed.

Where one of these skills disagrees with FOUNDMILL.md, docs/DESIGN.md or docs/DECISIONS.md, the repo's documents win. In particular: branches, pull requests and merges follow `ship-change` (auto-merge once the required checks pass), not any merge step a copied skill describes; UI follows docs/DESIGN.md; nothing here permits a vendor call outside `apps/gateway`.

| Skill folder | Source | Commit | License |
| --- | --- | --- | --- |
| `karpathy-guidelines` | github.com/forrestchang/andrej-karpathy-skills | 2c606141936f1eeef17fa3043a72095b4765b9c2 | No license file upstream. Kept for internal use in this private repository; do not redistribute. The four ideas come from Andrej Karpathy's public observations on LLM coding pitfalls. |
| `executing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `dispatching-parallel-agents`, `writing-plans`, `writing-skills` | github.com/obra/superpowers (plugin `superpowers` 7.0.2) | 22f0b463e7a5e579904dd6211a520321035526f7 | MIT, Copyright (c) 2025 Jesse Vincent |
| `humanizer` | github.com/blader/humanizer (4.0.0) | b48c832f0f809c1b5658edbb838c2521b72f2413 | MIT, Copyright (c) 2025 Siqi Chen |
| `frontend-design` | github.com/anthropics/skills (example-skills) | 1780c5e5a552fd4d1c9d6a7b0cab26b0c2bef064 | Apache-2.0 (see `frontend-design/LICENSE.txt`) |
| `design-taste-frontend` | github.com/Leonxlnx/taste-skill (2.5.1; SKILL.md and references only) | f6b76575f949707b4e3c37cd86cb44b0b98643e8 | MIT, Copyright (c) 2026 Leonxlnx |
| `copywriting`, `copy-editing`, `cro`, `onboarding`, `signup`, `product-marketing`, `emails`, `pricing`, `launch`, `ai-seo`, `schema` | github.com/coreyhaines31/marketingskills (plugin `marketing-skills` 2.14.12) | 1f837447b20bb6f0e72d87b80ece1c221c362c7d | MIT, Copyright (c) 2025 Corey Haines |
| `seo-technical`, `seo-schema`, `seo-geo`, `seo-agentic`, `seo-page` | github.com/AgriciDaniel/claude-seo (2.6.2) | 468ed5b0d9e3249394783710e54abb02837e326b | MIT, Copyright (c) 2026 agricidaniel |
| `ponytail` (added Nov 18, 2026, founder's request) | github.com/dietrichgebert/ponytail (`skills/ponytail`) | 96608e078b2d5ea607c5c3b8b5a54d1c1fba6846 | MIT, Copyright (c) 2026 DietrichGebert |
| `caveman`, `ultracave`, `megacave` (added Nov 18, 2026, founder's request) | github.com/JuliusBrussee/caveman (`skills/`, SKILL.md only) | a192894723a8f47e7f504c7b5041967ff1f18e55 | Apache-2.0, Copyright 2026 Julius Brussee (see `caveman/LICENSE`) |

Notes for a session using them:

- Inside a plugin these skills are named `superpowers:executing-plans`, `marketing-skills:copywriting` and so on. Here they have plain names (`executing-plans`, `copywriting`). Where a skill's text refers to a sibling by its plugin name, use the plain name.
- The SEO skills refer to Python scripts and sub-agents that live in the plugin, not in this folder. Use their written checks and thresholds and do the checks by hand.
- The marketing skills look for a product-marketing context file under `.agents/`. For Foundmill's own marketing, the equivalent is docs/foundmill-plan/foundmill-plan.md.
- `caveman` mentions a hook that tracks its mode, which is not installed here: `/caveman status` then reports `(not tracked by this host)`, as the skill says. Caveman's own rule keeps code, commits, docs and pull requests in plain prose; the repo's writing rules (US English, plain words) still apply to them.
- The rest of the founder's plugins (the full marketing, SEO and social sets, ui-ux-pro-max, impeccable, hyperframes, last30days and others) are not copied. docs/HOLISTIC_PLAN.md says how a cloud environment's setup script can install them.

## MIT License (applies to the folders marked MIT above, each under its own copyright line)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
