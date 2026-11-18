---
date: 2026-11-18
branch: claude/wp08-page-logo-mark
title: The page preview shows the real logo; the "Built on" mark one step larger for visitors
areas: [api, modules, dugout, sites]
supersedes: []
---
## What changed
- Product › Public page › Preview showed the letter mark ("CO") where the published page shows the project's logo.
  `page.get`'s `preview` now carries `logo` (the business's checked logo as the same `data:` URL `/p/<slug>` renders,
  from `repos.logos.get`), and the preview passes it to `ProjectPage`. The letter mark shows only when there is no logo.
- The "Built on Foundmill" mark on a project page, for outside visitors only, is `t-body` (was `t-small`), one step
  above the follow form's notices ("Protected by Cloudflare Turnstile" is `t-small`). For the project's own
  signed-in people it stays `t-small`, plain text. A paid plan still shows none (`tierShowsBuiltOnMark`).
- Foundmill Sites: the mark in the fixed footer is 13 px, against the bar's 12 px "Report this site" (the bar's styles
  are inline and `!important`, so tokens do not reach it).

## Decisions
- Founder, Nov 18, 2026: Foundmill's mark must not read smaller than a third party's notice on the same page.

## Not done
- Nothing else of the page changes; the after-follow line ("Built on Foundmill" inside the follow form's thanks) keeps
  its size.
