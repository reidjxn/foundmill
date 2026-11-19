---
key: caveman
name: Short working turns
description: Keeps an agent's own working turns short and exact, so a long coding task uses fewer tokens while every fact stays in.
category: engineering
attribute_name: Short working turns
attribute_group: execution
when_to_use: Use when a coding task has many working turns, to keep the notes you write to yourself and your lead short. Never for text a person reads.
roles: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
default_for: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: caveman:caveman
license_note: Apache-2.0, Copyright 2026 Julius Brussee
improves: cost_efficiency, communication
version: 1
---
# Short working turns

## When to use this

Use this for your working turns only: the text you write between tool calls, your progress notes to yourself, and your short messages to your lead while a task is running. Each word costs tokens and a reader's time, and filler costs twice.

**Anything a founder or an outside person reads stays in plain, full sentences.** That covers task notes, reports, hand-backs, the text of a pull request, commit messages, comments in the code, documents, emails and the project's public page. Never compress those. Code, commands, file paths, numbers and error messages stay exactly as they are.

## Before you start

Decide what counts as a working turn and what counts as something a person reads. If you are unsure, treat it as something a person reads and write it in full.

## Steps

1. **Answer first.** Put the result or the finding first, then the reason, then the next step.
2. **Cut filler.** No greeting, no hedging, no recap of what you just did, no closing offer to help. Drop "just", "really", "basically" and "actually".
3. **Use the short word.** "Fix" and not "implement a solution for". Use common acronyms only. Never invent abbreviations.
4. **Articles are optional. Meaning never is.** Drop "a" and "the" when the sentence still reads in one pass. Never drop "not", "never", "no", "only" or "except". Keep numbers and units exact.
5. **One idea per sentence.** Keep sentences under 20 words, in the active voice. Use one term for one thing.
6. **Keep the payload exact.** Quote an error as it is written, using only the line that decides it. When you show a code change in a working turn, show the changed lines and a line or two of context.
7. **Between tool calls, say little.** No text before a routine call. One line before a run of several steps, one line when a phase changes, one line with the result.

Write in full sentences, at normal length, when:

- you warn about a risk to security, data or money;
- you describe an action that cannot be undone, or ask for approval;
- the order of steps matters and a fragment could scramble it;
- your lead or the founder seems confused or repeats a question;
- you ask a question or offer options;
- the text is kept outside the working turns, as listed above.

## What good looks like

A working turn: "Test fails. Route returns 500 on empty email. Missing check in `validate.ts`. Adding it, then rerunning."

The hand-back that the founder reads: "I fixed the waitlist form so it now refuses an empty email and shows the message 'Enter your email address'. I added one test for it, and all 18 tests pass. I did not change the layout."

## Output

Working turns follow the steps above. Everything else you write follows the project's normal writing rules: plain, full sentences, US English, no filler.

## Check before you hand it over

- Every note, report, hand-back, pull request text, commit message, comment and email you wrote is in plain, full sentences.
- No "not", "never", "no" or "only" was dropped from any sentence.
- Every code span, path, number and error message is exactly as it appeared.
- No sentence has two possible readings. Where one does, rewrite it in full.

## What needs the founder

Nothing. This skill only changes how short your own working turns are.

## If a tool is missing

This skill needs no tool. If you cannot tell whether a text is a working turn or something a person reads, write it in full.
