## What it does

`shell-pane` lets a session run a command in a real terminal pane with no Claude in it, and read the result back itself, so a long run no longer ties up the session's own tool call.
The pane is a herdr workspace on the factory's `playground-probes` server, and it keeps running after the session's tool call ends.
A pane runs outside the hooks that check every command a session types, so the launcher, `scripts/shell-pane.ts`, puts them back: before it types a command, every Bash guard the factory registers checks it, and the first one that refuses stops it.

## When to reach for it

A session loads it on its own when a step needs a terminal that outlives one tool call.

| Case                                                        | What the skill does                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A long run the session reads back later                     | Runs it in a pane, inside run-slot when it is heavy, and reads the exit status later |
| A command any guard refuses, or one that would start Claude | Refuses it before anything is typed, with the guard's own reason                     |
| A pane the launcher did not open                            | Leaves it alone: it types into, and closes, only a workspace it labelled             |
| GitHub's sign-in for the `gh` CLI                           | Runs `gh`'s browser login in a pane and puts its one-time code on an Inbox card      |

## The four steps

`open` makes a workspace labelled `shell-<session name>-<n>`, its shell in the session's worktree.
`run` checks the command, then types it with a fresh marker that prints its exit status.
A command is one line of printable ASCII and spaces, since any other character, a tab, a control character or a newline, could edit the typed line itself.
A pane is no place for a login typed in the pane or anything that waits on a keypress: once a command runs, the pane takes no input until it ends.
Each command runs in a shell of its own, so nothing one command sets carries to the next, as between a session's own commands, and a pane still running one takes no other until that one finishes.
`read` waits for that marker and prints the output and `rc=<n>`; with no marker by its timeout, the result reads as unknown, never as a pass.
`close` closes the workspace by its id, and confirms its label is gone from the server's list.

## Signing in to GitHub from the Inbox

`login <pane> github` runs `gh`'s browser login in the pane, with no token from the environment and no browser opened on your screen.
It posts a card to your Dashboard's Inbox, from whichever worktree the session runs in, with `gh`'s one-time code and a link to GitHub's device page: you open the link, enter the code and sign in on GitHub's own page, so nothing you type passes through Playground.
The card closes itself once `gh` sees the sign-in, after 15 minutes, when the code runs out, and when the launcher stops or cannot read the pane.
A session runs `login` as a background task, since it waits up to 15 minutes, past a foreground tool call's limit.
The session sees only that result and the card's id, never a line `gh` printed, so no token `gh` writes reaches a transcript.
A prompt that waits for a typed answer or a keypress has no card yet.

## Common questions

**Does a pane get macOS grants a session's own Bash lacks?**
No.
A session on `playground` and a pane on `playground-probes` both run under herdr, so Screen Recording and Accessibility are granted the same way for both.

## It's working if

- A long run a session started in a pane finishes in its report, with its `rc=` line quoted.
- A command a guard refuses in a session's Bash is refused in a pane too, with the same reason.
- No `shell-` workspace stays open on `playground-probes` after the session that opened it is done.

## Where it fits

A core skill, built on the herdr servers that the `ops:herdr` job keeps running ([scripts/README.md](../../scripts/README.md#the-herdr-servers)).
The `no-raw-spawn` hook still refuses a session's own direct herdr call on a factory server; the launcher is the one way to type into a pane, and it starts no Claude session, which only `scripts/spawn.sh` does.
Before it screens a command, the launcher checks the session id and role in its own environment against the claude process it runs under, the nearest process above it whose executable is `claude`: the role that process was started with, read from its own environment (`ps -E` on macOS, `/proc/<pid>/environ` on Linux),
and the id Claude Code's registry in that process's own config folder holds for it.
A call that sets either one differently is refused and nothing is typed, and a call that moves `CLAUDE_CONFIG_DIR`, `HOME` or `PLAYGROUND_DATA_DIR` in its own environment changes nothing the check reads.
Two gaps stay open, each a session's own doing: a process the session starts itself under the name `claude` stands in for the real one, and the registry's entry is a file the session can write, so a rewritten entry passes the id check, though not the role check.
A session trying it before it merges follows [.agents/skill-trial.md](../../.agents/skill-trial.md).
