# Notices for adapted skills

Some skills in this folder keep the substance (frameworks, checklists, decision rules) of open-source skills and are rewritten for Foundmill's agents and rules. Each such file names its source in `adapted_from` (`collection:skill`, the collection as in the first column below) and its license in `license_note`; the catalog carries both as the skill's provenance. The drafts moved here from docs/holistic-plan/skills in WP-06 T3 (Nov 16, 2026); the product's own notices page is to gain the same list. A test (`packages/agents/src/__tests__/skill-library.test.ts`) fails when an adapted skill names a collection that is not in this table, or a license other than MIT or Apache-2.0.

| Collection | Source | Version read | License |
| --- | --- | --- | --- |
| `marketing-skills` | github.com/coreyhaines31/marketingskills | 2.14.12 (1f837447) | MIT, Copyright (c) 2025 Corey Haines |
| `claude-seo` | github.com/AgriciDaniel/claude-seo | 2.6.2 (468ed5b0) | MIT, Copyright (c) 2026 agricidaniel |
| claude-seo, the `seo-content-brief` skill inside it | same repository | 2.6.2 (468ed5b0) | MIT, Copyright (c) 2026 puneetindersingh (its own LICENSE.txt) |
| `social-media-skills` | github.com/charlie947/social-media-skills | 1.1.0 (10ca79c0) | MIT, Copyright (c) 2026 Charlie Hills |
| `superpowers` | github.com/obra/superpowers | 7.0.2 (22f0b463) | MIT, Copyright (c) 2025 Jesse Vincent |
| `humanizer` | github.com/blader/humanizer | 4.0.0 (b48c832f) | MIT, Copyright (c) 2025 Siqi Chen |
| `taste-skill` | github.com/Leonxlnx/taste-skill | 2.5.1 (f6b76575) | MIT, Copyright (c) 2026 Leonxlnx |
| `ui-ux-pro-max` | github.com/nextlevelbuilder/ui-ux-pro-max-skill | 2.15.0 (d643997c) | MIT, Copyright (c) 2024 Next Level Builder |
| `last30days` | github.com/mvanhorn/last30days-skill | 3.39.0 | MIT, Copyright (c) 2026 Matt Van Horn |
| `example-skills`: Anthropic example skills (frontend-design, webapp-testing) | github.com/anthropics/skills | 1780c5e5 | Apache-2.0 |
| `ponytail` | github.com/dietrichgebert/ponytail | 96608e07 | MIT, Copyright (c) 2026 DietrichGebert |
| `caveman` | github.com/JuliusBrussee/caveman | a1928947 | Apache-2.0, Copyright 2026 Julius Brussee |

Not adapted, only credited for ideas, because they ship without a license text: `karpathy-guidelines` (github.com/forrestchang/andrej-karpathy-skills; the four ideas are Andrej Karpathy's public observations on how models go wrong when coding, and `coding_discipline` is written in Foundmill's own words around them) and `impeccable` (github.com/pbakaus/impeccable).

What was always removed in adaptation: questions to a person in a chat, slash commands, scripts and command-line tools, file conventions outside Foundmill's records, sponsor or partner mentions, named living people cited as authorities, statistics without a source, and any step that has an agent sign up for, buy from or log in to someone else's service.

The MIT permission notice: "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."
