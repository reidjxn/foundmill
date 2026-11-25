---
key: terse_working_notes
name: Terse working notes
description: Keeps an agent's own working turns short while every fact survives, and keeps everything a person reads in plain full sentences.
category: engineering
attribute_name: Terse working notes
attribute_group: execution
when_to_use: Use when working through a code task, for your own working turns and tool-run notes, never for anything a person will read.
roles: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, security_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
default_for: engineering_lead, backend_engineer, frontend_engineer, data_engineer, infra_engineer, security_engineer, qa_engineer, design_to_code, docs_writer, review_agent, integration_agent, planner
default_since: 6
load: always
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: caveman:caveman
license_note: Apache-2.0 and MIT, Copyright 2026 Julius Brussee
improves: cost_efficiency, communication
version: 1
---
# Terse working notes

## When to use this

Use this for your own working turns while you work through a code task: the short notes between tool calls, your plan as you go, your read of an error. Every word you write there is paid for in credits and read again on the next turn. Words that carry nothing cost twice.

It is never for anything a person reads. Everything a founder or an outside person reads, and everything kept in the project, stays in plain full sentences: notes and reports for the founder, Needs you items, replies, email, the public page, code, code comments, commit messages and pull request text. Being short there makes the text harder to read and to trust.

## Before you start

Decide, for each piece of text, who reads it. If a person reads it, or it is saved in the project, write it in full sentences and stop reading this skill for that text. If only you read it on your next turn, keep it short as below.

## Steps

1. **Answer first.** Say the finding, then the reason, then the next step. "Test fails: the date check uses less-than, not less-than-or-equal. Fixing the check." Not a greeting, not a summary of what you are about to do.
2. **Drop ceremony.** No greetings, hedges, pleasantries, recaps or closing offers. No filler words such as "just", "really", "basically" or "actually".
3. **Use short, plain words.** "Fix", not "implement a solution for". Common abbreviations (API, URL, ID) are fine. Invented ones are not: they save nothing and are harder to read.
4. **Keep the meaning whole.** You may drop "a", "an" and "the" when the sentence still reads in one pass. Never drop "not", "never", "no", "only" or "except". Keep numbers and units exact.
5. **One idea per sentence.** At most 20 words, active voice. If short and clear pull apart, clear wins.
6. **Copy the payload exactly.** Code, commands, file paths, names in the code and error messages stay character for character. Quote only the error line that decides the matter.
7. **Say little between routine tool calls.** One line before a run of several steps, one line when the phase changes, one line with the result.

## What good looks like

Your working notes are a fraction of their old length, and nothing in them is lost: every path, number, error and negation is still there. The founder's notes, the hand-back and the pull request read as clearly as before.

## Output

Short working notes for yourself, and the usual full-sentence hand-back, report and pull request text for people.

## Check before you hand it over

- The hand-back, any note for the founder and any pull request text are in plain full sentences.
- No code comment, commit message or saved document was shortened.
- Every "not", "never", "no" and "only" you meant is still in your notes.
- Nothing you shortened can be read two ways. If it can, write it out in full.

## What needs the founder

Nothing in this skill needs the founder. A security warning, an action that cannot be undone and a question for your lead are always written in full sentences, so the answer comes back right the first time.

## If a tool is missing

This skill needs no tool. If you are unsure whether a person will read a piece of text, treat it as text a person reads and write it in full sentences.
