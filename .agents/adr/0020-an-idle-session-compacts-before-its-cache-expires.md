# An idle session compacts before its cache expires

A factory session's prompt cache lasts an hour after its last request. When a session of 200k tokens or more sits idle past that hour, its next turn writes its whole history to the cache again at 1.25 times the input price, where a compaction while the cache is still warm costs one cached read and a short summary. Claude Code's own idle compaction asks only when the session comes back, after the cache has gone. A `/compact` typed into a session reads as the owner's words, so it went against the rule that the dashboard sends a session anything only on the owner's own click; the owner approved this one send on 7 Nov through the Inbox.

## Decision

- **One send on the owner's standing yes.** ops-tick's idle-compact beat runs `bun run idle-compact` every 5 minutes. `compactIdle()` in `api/hono/src/lib/dashboard/idle-compact.ts` sends `/compact` through herdr's `prompt()` to each worker or runner, checkers included, idle 50 to 58 minutes since its last request at 200k+ tokens with nothing waiting on anyone (no prompt, question or usage limit). A dispatcher, a lead and every other role are left alone, and each send is one line in `ops/log/idle-compact.log`.
- **The window.** 50 minutes leaves the cache warm, 58 minutes is the last beat before it expires, and a 5-minute beat meets every session once inside it; the transcript's own change resets the wait, so a compaction's lines keep it from compacting again.
- **A trial.** It is permanent only once the trial's A/B, on the issue that asked for it, meets its bar: the mean weighted cost of a return after a long idle, over the 7 days after the merge, at most 70% of the 7 days before. A miss reverts the beat.

## Consequences

- A long-idle worker's next turn starts from a summary, so a detail the summary drops is gone for it; the trial's readout weighs that risk against the cost.
- `prompt()` has a second caller beside `deliver()`, which `tests/api/hono/src/lib/dashboard/herdr.test.ts` names, and the own-click rule names this one exception wherever it is stated.
