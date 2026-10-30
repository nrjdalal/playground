Every verdict is the owner's stamp, one YAML block; a clean merge of `canary` carries it, a merge that is not clean takes the reviewer's look, and a red stamp on `canary`'s tip stops every merge but its fix.
One stamp that every gate reads lets several PRs merge back to back with no new run each.
A merge reads the stamp's status, commit and each check's source: green merges, wait waits for CI, and red or none is not ready.
Every PR's green stamp has passed each check GitHub's jobs run, so a Checks run alone never merges a PR.
The Builder's go is for one exact head and starts no run of its own: the reviewer asks for it, the Builder gives it with `bun run ci:go <pr> <sha7>`, a worker never relays or predicts one, and a moved head needs a new one.
A red that `canary` caused clears with a fresh merge of `canary` once its fix lands, since a rerun replays the old merge commit.
An outside author's PR runs here only on the Builder's go naming that author at that head, after a read-only review of its diff, since a check runs its code on this machine.
Done when the head you merge holds a green stamp that passed every check its diff needs.
The stamp's shape and readers, the carry, the look, the net, the go and the Checks lanes are in `packages/scripts/src/pr-merge/README.md`.
