`~/.playground/roster.json` changes only through `scripts/roster.ts`, on every start, dispatch, report, merge and end.
One writer keeps the roster whole for every reader, the Dashboard, the hooks and the managers.
Each write keeps the five versions before it beside the roster, `roster.json.1` (the newest) to `roster.json.5`, mode 600: a lost row comes back from the newest one that holds it, through `roster.ts set`.
`PLAYGROUND_DATA_DIR` is the one variable that moves the roster's file, passed on the command itself (`env PLAYGROUND_DATA_DIR=<scratch> bun scripts/roster.ts ...`).
A write holds `roster.json.lock` from its read to its write, so two writes at once both land; a held lock is waited on for 5 s, and one left by a process that is gone is taken over.
Done when the roster's entry for each session you started, dispatched or ended reads its state now.
What to write, and when, is in playbook's ROSTER.md.
