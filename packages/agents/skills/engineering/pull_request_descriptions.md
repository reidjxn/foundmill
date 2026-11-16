---
key: pull_request_descriptions
name: Pull request descriptions
description: Describes a change so a reviewer understands why, what and how it was tested in two minutes.
category: engineering
attribute_name: Pull request write-ups
attribute_group: craft
version: 2
---
# Pull request descriptions

Every pull request description has four short sections:

- **Why**: the task id and the problem in one or two sentences.
- **What**: the change, file by file only where the reason is not obvious.
- **How it was tested**: the tests you wrote or changed, by name. You cannot run commands: say that the platform runs the task's tests after your session and that the result is on the task.
- **Risk**: what could break, how to roll back, and any migration or setting to apply.

Keep it under 300 words. Mention follow-up work as separate tasks rather than leaving it in the change.
