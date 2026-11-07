# An idle session compacts before its cache expires

A factory session's prompt cache lasts an hour after its last request. When a session of 200k tokens or more sits idle past that hour, its next turn writes its whole history to the cache again at 1.25 times the input price, where a compaction while the cache is still warm costs one cached read and a short summary. Claude Code's own idle compaction asks only when the session comes back, after the cache has gone. A `/compact` typed into a session reads as the owner's words, so it went against the rule that the dashboard sends a session anything only on the owner's own click; the owner approved this one send on 7 Nov through the Inbox.

## Decision

- **One send on the owner's standing yes.** ops-tick's idle-compact beat runs the idle-compact bin straight from the Dashboard's checkout every 5 minutes, not `bun run idle-compact` from ops-tick's folder: the package.json script's prebuild starts an unslotted turbo build in the main checkout right after a ship, and the bin's env validates only against the Dashboard checkout's own .env, which `load-dotenv` reads from the beat's `--cwd`. `compactIdle()` in `api/hono/src/lib/dashboard/idle-compact.ts` sends `/compact` through herdr's `prompt()` to each worker or runner, checkers included, idle 50 to 58 minutes since its last request at 200k+ tokens with nothing waiting on anyone (no prompt, question or usage limit), and only while its input box is empty, since herdr's paste would send a draft with it; the beat names the live machine with `PLAYGROUND_LIVE_READS`. A dispatcher, a lead and every other role are left alone, and each send is one line in `ops/log/idle-compact.log`.
- **The window.** 50 minutes leaves the cache warm, 58 minutes is the last beat before it expires, and a 5-minute beat meets every session once inside it; a compaction writes no usage line, so `lastTurn()` reads a session compacted since its last turn as having no turn, and it waits for its next real one.
- **A trial.** It is permanent only once the trial's A/B, on the issue that asked for it, meets its bar: the mean weighted cost of a return after a long idle, together with the compaction it got, over the 7 days after the merge, at most 70% of the 7 days before. A miss reverts the beat.

## Consequences

- A long-idle worker's next turn starts from a summary, so a detail the summary drops is gone for it; the trial's readout weighs that risk against the cost.
- `prompt()` has a second caller beside `deliver()`, which `tests/api/hono/src/lib/dashboard/herdr.test.ts` names, and the own-click rule names this one exception wherever it is stated.
