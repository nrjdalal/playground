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

## The four steps

`open` makes a workspace labelled `shell-<session name>-<n>`, its shell in the session's worktree.
`run` checks the command, then types it with a fresh marker that prints its exit status.
A command is one line of printable ASCII and spaces, since any other character, a tab, a control character or a newline, could edit the typed line itself.
A pane is no place for a login or anything that waits on a keypress: once a command runs, the pane takes no input until it ends.
Each command runs in a shell of its own, so nothing one command sets carries to the next, as between a session's own commands, and a pane still running one takes no other until that one finishes.
`read` waits for that marker and prints the output and `rc=<n>`; with no marker by its timeout, the result reads as unknown, never as a pass.
`close` closes the workspace by its id, and confirms its label is gone from the server's list.

## Common questions

**Does a pane get macOS grants a session's own Bash lacks?**
No.
A session on `playground` and a pane on `playground-probes` both run under herdr, so Screen Recording and Accessibility are granted the same way for both.

## It's working if

- A step that needed your `!` before now finishes in a session's report, with its `rc=` line quoted.
- A command a guard refuses in a session's Bash is refused in a pane too, with the same reason.
- No `shell-` workspace stays open on `playground-probes` after the session that opened it is done.

## Where it fits

A core skill, built on the herdr servers that the `ops:herdr` job keeps running ([scripts/README.md](../../scripts/README.md#the-herdr-servers)).
The `no-raw-spawn` hook still refuses a session's own direct herdr call on a factory server; the launcher is the one way to type into a pane, and it starts no Claude session, which only `scripts/spawn.sh` does.
A session trying it before it merges follows [.agents/skill-trial.md](../../.agents/skill-trial.md).
