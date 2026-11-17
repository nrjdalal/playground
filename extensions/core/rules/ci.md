Every verdict is the reviewer's 5/5 and GitHub's `Audit, Lint, and Build` and `test` check runs, green at the head that merges, and for a diff under `web/next/` the tester's PASS there.
GitHub runs both on every push to a pull request into `canary`, so a verdict needs no run of its own and no one's go.
`Audit, Lint, and Build` is the last job of `auto-check-build.yml` and runs after `Lint and Build` and the suite, so a green `Lint and Build` alone leaves the gate unfilled.
A merge of `canary` makes a new head, which needs its own green checks and a 5/5, and on a `web/next/` diff a new tester's PASS.
A red that `canary` caused clears with a fresh merge of `canary` once its fix lands, since a rerun replays the old merge commit.
Done when the head you merge holds the 5/5, both checks green and, for a `web/next/` diff, the tester's PASS.
Each gate and its reading are in `packages/scripts/src/pr-merge/README.md`.
