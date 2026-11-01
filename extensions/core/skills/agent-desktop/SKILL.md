---
name: agent-desktop
description: "Operate a desktop app through the agent-desktop CLI (computer use through the macOS accessibility tree): check its install and grants, load the binary's own docs, and keep to Playground's guardrails: headless, the owner's apps untouched, desktop content private. Use before any agent-desktop command, or when a task needs a desktop app driven."
license: Complete terms in the repository's NOTICE
---

# agent-desktop

`agent-desktop` reads and drives desktop apps through the OS accessibility tree. The binary carries its own docs, matched to its version, so this skill holds only what the binary cannot know: whether this Mac lets you run it, and what stays the owner's. The desktop is the owner's own screen, so every step keeps your work **off the owner's hands**: nothing you do moves the owner's pointer, touches the owner's apps or carries what you saw outside your session.

## 1. Check

Run `agent-desktop version`, then `agent-desktop permissions`, which reads the grants and never prompts. Read each grant's `state` in its JSON, since `permissions` exits 0 with a grant denied.

- Accessibility reads `granted`, for every task.
- Screen Recording reads `granted`, when the task takes a screenshot (the binary's platform guide, Requirements).

macOS grants the app that launches agent-desktop. A factory session runs under the launchd herdr server (`~/.playground/bin/herdr`), not a GUI terminal, so that is the binary the grant most likely names (untested until the owner's first grant).

On a missing binary or a grant that is not `granted`, **stop** and tell your manager the one action needed: Ops installs `agent-desktop` (npm), or the owner grants the named permission to the launching app in System Settings. Granting is the owner's step, and so are `permissions --guide` and `permissions --request`, which open System Settings or a system prompt on the owner's screen.

Done when `version` answers and each grant the task needs reads `granted`, or when your manager has the stop and its one action.

## 2. Load the binary's docs

Run `agent-desktop skills get desktop` and `agent-desktop skills get platform` once in the session, and follow them: they hold the observe, act, verify loop and macOS's own rules.

Done when both have printed in this session.

## 3. Stay headless

Use the default headless mode. `--headed` sends physical pointer and key events, which move the owner's own pointer and focus, so it is the owner's alone: when a task needs it, tell your manager the one command for the owner to run with `!`. This skill holds that rule itself, and the `no-desktop-owner-app` hook refuses `--headed` once it is registered.

Done when every command in the session runs headless.

## 4. Leave the owner's apps alone

Name only apps off the owner's list in a snapshot, act, launch or close, matching a name in any case and with or without `.app`. Read the list with `bun "$PLAYGROUND_REPO/packages/scripts/src/playground/guard-list.ts" no-desktop-owner-app desktop-owner-apps`, which prints it as JSON. While it exits 2 with `no guard list desktop-owner-apps` (the list is not registered yet), the list is every web browser and Slack, and an app you cannot place counts as a browser. On any other answer that is not a printed list (another exit 2, an unset `$PLAYGROUND_REPO`, no `bun`), **stop** and tell your manager, since there is no list to trust. The owner's login extension fills the list, an app leaves it only when Ops edits that extension on the owner's word, and the `no-desktop-owner-app` hook refuses a command that names a listed app once it is registered.

Done when every app the session's commands name is off the list the reader printed, or off every web browser and Slack while the reader answers `no guard list desktop-owner-apps`.

## 5. Keep desktop content private

A snapshot, screenshot, clipboard read, trace or command output can hold whatever is on the owner's desktop. Keep each one in your session's scratchpad, and describe results in words wherever they go out: a commit, PR, issue, comment, Inbox item, Slack post or report carries words alone, with no snapshot, screenshot or quoted desktop text. Delete the scratchpad copies when the task ends.

Done when no outward write holds a desktop artifact, its path or quoted desktop text, and the scratchpad copies are deleted.

## Keep the skills learning

When you get past a hurdle this skill did not foresee, find a fix, or find a faster way, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which step it belongs in, in a few plain lines. That session turns findings into a reviewed change to the factory's repo. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries desktop content, prod data, secrets or customer details.
