A worker sends its lead a UTC ETA to merged, `date -u +%FT%TZ` plus its estimate, when it starts and with every report, and the lead records it with `roster.ts set <name> eta=<iso>`.
An ETA to merged lets a lead plan the merge order and tell the owner what is left.
It counts the build left, each review round, the tester and the Checks queue at their measured times, plus the slip seen so far.
The lead clears it when the PR merges, and a runner, whose job has no end, sends none.
Told to the owner, an ETA is time remaining, never a clock time.
`roster.ts` refuses an `eta=` that is not a future time in that shape, and an empty `eta=` clears it.
Done when the worker's roster entry holds the newest ETA it sent, which `roster.ts` took, or none once its PR has merged.
How the Dashboard shows it is in playbook's ROSTER.md.
