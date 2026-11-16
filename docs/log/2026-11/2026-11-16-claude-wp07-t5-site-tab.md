---
date: 2026-11-16
branch: claude/wp07-t5-site-tab
title: Site screening, Publish and the Product › Site tab (WP-07 T5)
areas: [agents, api, db, modules, web]
supersedes: []
---
## What changed
- `screenSiteFiles` and `siteHeldSentence` (`packages/agents/src/site-screen.ts`): deterministic rules only, no model
  call. Limits, paths and types from `SITE_LIMITS` and `SITE_FILE_TYPES`; in HTML and SVG: scripts, embeds, `<base>`,
  `meta http-equiv`, `on…=` attributes, `javascript:` and `data:text/html`, a form whose action is not `/_fm/follow`,
  password and card fields, links that are not https, mailto, a fragment or a site path; markup that would swallow the
  platform's footer (an unclosed comment, `<plaintext>` and the like, anything naming `data-fm-footer`, the two findings
  the #240 security review left for here); in CSS `@import` and `url(` off the site; in visible text the `markup` and
  `personal_data` flags of `communityScreenLocalFlags`.
- `site.get`, `site.publish`, `site.unpublish`, `site.setSlug` (`apps/api/src/routers/site.ts`,
  `services/sites.ts`): publishing as `publishPage` does it (sample business refused, owner or admin with Product write,
  inside `ctx.rls`, `site.published` and `deploy.succeeded` with `provider: "foundmill"` through the outbox, an audit
  row); 20 presses a day (`repos.sites.publishPressesToday`, counted from the audit rows, so republishing counts).
- The Product › Site tab (`packages/modules/src/product/SiteScreen.tsx`): the address, the versions with their preview
  links (a new tab), a held version in plain words, Publish, Take down.
- `repos.sites.ensure` adds the tab to the department holding the Product module when it creates the site;
  `repos.sites.setSlug`.
- `apps/web/e2e/site.spec.ts`: with SITES_DOMAIN unset (the Playwright stack) the Product area offers no Site tab.

## Decisions
- **The Site tab is not in `MODULE_TABS`.** Every module tab is created at Commit and by `syncModuleScreens`, so a
  `MODULE_TABS` entry would give every project the tab while SITES_DOMAIN is unset (the package's "Done when" 4). The
  tab is created with the site instead, which happens only where SITES_DOMAIN is set; it is registered in the product
  pack beside the module tabs, and a tab no module lists is shown inline. Departing from the package's
  `MODULE_TABS`/`DEFAULT_TABS` change.
- **Screening lives in `packages/agents`**, not `packages/shared`: it uses `communityScreenLocalFlags`, which is
  there, and shared cannot import agents.
- **An email address on a site is not flagged.** `mailto:` links are allowed, so the address they show must be;
  phone and id numbers still are.
- **The preview opens in a new tab, not in frames on the tab.** One link per version; the frames (390 px and desktop)
  wait for WP-10's look of the tab. apps/sites already lets the product's origin frame a preview.
- **Left for T3,** which writes the releases: the Needs you note "Your site is ready to look at" and its "Publish it"
  answer, the "Live product" line in Development and the first-week line. Nothing writes a release before T3, so
  neither the note nor the lines can appear yet. No Storybook story: module screens have none in this repo (the
  module test covers empty, preview, held and live).
