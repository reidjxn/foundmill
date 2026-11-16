---
date: 2026-11-16
branch: claude/wp04-t13-shortcuts-off
title: Single-key shortcuts off by default (WP-04 T13)
areas: [db, api, web, dugout, docs]
supersedes: []
---
## What changed
A new guided account can no longer start work or answer a note with one stray key (audit A2-03, WCAG 2.1.4).
- Migration 0114 (journal idx 102): `account_preferences.keyboard_shortcuts boolean not null default false`, set true
  for rows whose `guidance = 'off'`. RLS unchanged (own-row policy). Schema mirror, `preferencesRepo` view and
  `AccountPreferencesPatch` gain `keyboardShortcuts`; `founder.preferences.guidance` returns it.
- `founder.profile.update`: the save that creates an Exited or Operator profile (guidance off) turns the keys on too.
- `useKeyboardMap` (packages/dugout keyboard.ts): new `singleKeys` flag, default false. Off, only `/`, Cmd-K, `?` and
  Esc act; R, J, K, E, the G chords and 1–4 do nothing. The page-level Space binding and `onContinue` are gone whatever
  the flag: Space presses Continue only when Continue has focus (the button's own behavior) and otherwise scrolls.
  1–4 act only with focus inside a decision bar (`DECISION_BAR_ATTRIBUTE`, which DecisionBar now sets on its root).
- AppShell passes `keyboard.singleKeys` to the map and to `KeyboardHelp`, which says "Single-key shortcuts are off.
  Turn them on in Settings › Preferences." while they are off and still lists every shortcut.
- Web: `useKeyboardShortcutsOn()` (guidance-context.ts) feeds BusinessShell's `keyboard.singleKeys`; ReadingPane shows
  the DecisionBar's 1–4 caps only while the keys are on. Settings › Preferences has a "Keyboard shortcuts" section with
  one switch, "Single-key shortcuts", saved through the GuidanceHost with a toast.
- The Ideation Studio's Space-to-compare is gone with the map's Space binding; its tip now names only Esc.
- docs/DESIGN.md "Key caps go the other way" says the keys are off until turned on in Settings › Preferences.
- Tests: keyboard.test.ts (Space never bound, digit outside the bar, off by default, the always-on list),
  AppShell/Dialogs/DecisionBar tests, migration-0114.test.ts, the account_preferences RLS suite, api preferences and
  founder-profile-guidance, web guidance-host and preferences-tab; e2e keyboard-a11y.spec.ts (a block with the keys
  off: Space on Today, the always-on keys, the Settings switch) and inbox.spec.ts (a digit outside the bar).

## Decisions
- The switch is a new `singleKeys` field on `KeyboardMapContext`, not the existing `enabled`, which the spec names:
  `enabled` turns Esc, `/` and `?` off too, and the spec keeps those on. Its default is false, so any shell that forgets
  to pass it is safe.
- `AppShell.tsx` changed (one line to pass the flag, the Space wiring removed), against the spec's "keyboard.ts and
  BusinessShell.tsx only": AppShell owns the call to `useKeyboardMap`, so the flag cannot reach it otherwise. Branch
  `claude/blissful-fermat-q03yq1` touches a different region of the file.
- With the keys off, 1–4 do nothing even with focus in the decision bar (the spec's "only /, the palette chord, ? and
  Esc act"); with them on, only from inside the bar. The focused option still answers to Enter or Space, as any button.
- The keys live on the guidance preferences answer (`GuidancePrefs`), which the web already loads on every signed-in
  page, rather than a new query.
- The full list stays behind `?`; the Settings hint says so instead of opening a second copy of the overlay there
  (Settings does not know the sidebar's areas, so its list would miss the G chords).
- Playwright: global-setup.ts turns the dev founder's keys on, because many specs drive screens by key (inbox, today,
  areas, home, shell); keyboard-a11y.spec.ts turns them off for its new block and restores them. `approveFromInbox`
  and inbox.spec.ts focus the decision bar (`focusDecisionBar`) before pressing a digit.
- Migration number 0114 at idx 102: #213 took 0113 (idx 101). The branch was rebased onto main after #213 merged.
- Spec vs code: the spec points at `BusinessShell.tsx:919` and `keyboard.ts:101/152-160`; the lines matched. It also
  names `apps/web/components/settings/PreferencesTab.tsx` for the switch, used as is.

## Not done
- `ContinueButton`'s own opt-in `bindSpace` (a page-level Space, used only by its story and tests, no app passes it)
  and `DecisionBar`'s own `hotkeys` (page-level 1–4, every app passes `hotkeys={false}`) are left as they are.
- Other single keys outside the shell map are unchanged: ReadingPane's T (focus the agent's desk), the Channel Board's
  O, and number keys in an agent's conversation outside the Inbox (QuickReplies). None starts paid work.
- docs/BUILD.md §5.5 still lists "Space = Continue" (the task names only DESIGN.md); the code and DESIGN.md win.
- No pull request opened (the coordinating session opens it).
