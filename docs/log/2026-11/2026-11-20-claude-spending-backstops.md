---
date: 2026-11-20
branch: claude/spending-backstops
title: Spending backstops set (WP-00 S13) and Redis capped at 256 MB
areas: [docs, ops]
supersedes: []
---
## What changed
The founder approved the WP-00 S13 limits on Nov 20, 2026: about $750 a month in the Anthropic Console, about $100 a
month on the E2B team, and 256 MB for Redis. Redis on Railway now starts with `--maxmemory 256mb --maxmemory-policy
noeviction` (start command changed and redeployed on Nov 20; it came back "Ready to accept connections", with its data
kept on the volume). The plan records it and Session 16 (the failing supplier outcome eval).

## Decisions
### noeviction, not an LRU policy
Redis holds rate limits and the people limits counted in the shared store (WP-12 T5). Evicting those keys would
silently lift a limit; refusing writes when full fails loudly instead. 256 MB is far above today's use.

## Not done
- The Anthropic and E2B limits are the founder's to set in their dashboards.
- No Railway memory alert yet: it is set in the workspace's usage settings.
