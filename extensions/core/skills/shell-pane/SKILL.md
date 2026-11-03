---
name: shell-pane
description: "Run a command in a plain shell pane with no Claude in it, on the playground-probes herdr server: open a pane, run a command that every Bash guard has passed, read its output and exit status back, close the pane. Use when a step needs a real terminal that outlives one tool call (an interactive login, a long run read back later), in place of handing the owner a `!` command."
license: Complete terms in the repository's NOTICE
---

# shell-pane

A shell pane is a herdr workspace on the `playground-probes` server, with a plain shell in it and no Claude. It keeps running after your tool call ends, and you drive it only through one launcher, `bun "$PLAYGROUND_REPO/scripts/shell-pane.ts"`, called `shell-pane` below. A pane has no PreToolUse hook of its own, so the launcher **screens** each command before it types it: every Bash guard the factory settings register checks the command as if it were your own Bash call, and the first refusal stops it.

## 1. Open

Run `shell-pane open <your session name>`, from your worktree. It makes a workspace labelled `shell-<your session name>-<n>`, its shell in your worktree, and prints `pane <pane id> workspace <workspace id> label <label>`. Keep both ids: you run and read by the pane id, and close by the workspace id.

Done when it prints the pane id and the workspace id.

## 2. Run

Run `shell-pane run <pane id> '<command>'`, one command line in single quotes. The launcher screens it, refuses a word naming `claude` and a pane in a workspace it did not label, then types it with a fresh **marker** after it, and prints `sent <marker>`.

- A heavy command (a suite, a build, an install) goes inside run-slot, as `~/.playground/ops/run-slot.sh <your name> -- <command>`, as in your own Bash (**slots**).
- A refusal prints the guard's reason, the same one its hook gives your own Bash call: follow it, then run again.
- End the line on a command, not a trailing `#` comment or `&`, so the marker runs.

Done when it prints `sent <marker>`, or a refusal you have acted on.

## 3. Read

Run `shell-pane read <pane id> <marker> --timeout <ms>`. It waits for that marker, then prints what the command printed and `rc=<n>`. With no marker by the timeout it prints what showed so far and `no exit marker by <ms> ms: the result is unknown`, and exits 2. An unknown result is never a pass (**verify**): read again with a longer timeout, or report it as unknown. For a login that shows a code or a link, this read is how you see it.

Done when it prints `rc=<n>`, or you have reported the result as unknown.

## 4. Close

Run `shell-pane close <workspace id>` once the step is done. It closes only a workspace whose label it made (**signal**), reads the server's workspace list, and prints `closed <workspace id>` once your label is gone from it.

Done when it prints `closed <workspace id>`.

## Keep the skills learning

When you get past a hurdle this skill did not foresee, find a fix, or find a faster way, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which step it belongs in, in a few plain lines. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries prod data, secrets or customer details.
