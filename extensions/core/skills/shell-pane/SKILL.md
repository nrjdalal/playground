---
name: shell-pane
description: "Run a command in a plain shell pane with no Claude in it, on the playground-probes herdr server: open a pane, run a command that every Bash guard has passed, read its output and exit status back, close the pane. Use when a step needs a terminal that outlives one tool call, such as a long run read back later; never for a login or anything that waits on a keypress."
license: Complete terms in the repository's NOTICE
---

# shell-pane

A shell pane is a herdr workspace on the `playground-probes` server, with a plain shell in it and no Claude. It keeps running after your tool call ends, and you drive it only through one launcher, `bun run --no-env-file "$PLAYGROUND_REPO/scripts/shell-pane.ts"`, called `shell-pane` below. A pane has no PreToolUse hook of its own, so the launcher **screens** each command before it types it: every Bash guard the factory settings register checks the command as if it were your own Bash call, and the first refusal stops it.

## 1. Open

Run `shell-pane open <your session name>`, from your worktree. It makes a workspace labelled `shell-<your session name>-<n>`, its shell in your worktree, and prints `pane <pane id> workspace <workspace id> label <label>`. Keep both ids: you run and read by the pane id, and close by the workspace id.

Done when it prints the pane id and the workspace id.

## 2. Run

Run `shell-pane run <pane id> '<command>'`, the command in single quotes. The launcher screens it, refuses a word naming `claude`, a pane in a workspace it did not label and a pane whose last command still runs, then types it with a fresh **marker** after it, and prints `sent <marker>`. Each run is a `zsh -f` of its own in the pane's folder, so, as between your Bash calls, nothing one run sets (an alias, a variable, a `cd`) reaches the next: put a step's whole setup in one command.

- Run the launcher with your session's own `CLAUDE_CODE_SESSION_ID` and `PLAYGROUND_ROLE`, as your Bash call has them: it checks both against your session's state record and refuses a call that changes either. A session with no role recorded yet gets one with the next record the session-state hook writes, its next prompt; a session whose hooks do not run, such as one herdr restored outside the factory's checkout, gets none, so its run stays refused.
- A heavy command (a suite, a build, an install) goes inside run-slot, as `~/.playground/ops/run-slot.sh <your name> -- <command>`, as in your own Bash (**slots**).
- A refusal prints its reason, a guard's being the one its hook gives your own Bash call: follow it, then run again.
- The launcher's own `claude` check reads the words with quotes and backslashes taken out; a word built from a variable or a glob gets past it, as past no-raw-spawn, so a session start goes through `scripts/spawn.sh` alone.
- A command is one line of printable ASCII and spaces: the launcher refuses any other character, naming it, since a tab, a control character or a newline could edit or end the typed line itself.
- A pane is no place for a login or anything that waits on a keypress: once a command runs, the pane takes no input until it ends, so such a step stays with the owner.

Done when it prints `sent <marker>`, or a refusal you have acted on.

## 3. Read

Run `shell-pane read <pane id> <marker> --timeout <ms>`. It waits for that marker, then prints what the command printed and `rc=<n>`. With no marker by the timeout it prints what showed so far and `no exit marker by <ms> ms: the result is unknown`, and exits 2. An unknown result is never a pass (**verify**): read again with a longer timeout, or report it as unknown.

Done when it prints `rc=<n>`, or you have reported the result as unknown.

## 4. Close

Run `shell-pane close <workspace id>` once the step is done. It closes only a workspace whose label it made (**signal**), reads the server's workspace list, and prints `closed <workspace id>` once your label is gone from it.

Done when it prints `closed <workspace id>`.

## Keep the skills learning

When you get past a hurdle this skill did not foresee, find a fix, or find a faster way, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which step it belongs in, in a few plain lines. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries prod data, secrets or customer details.
