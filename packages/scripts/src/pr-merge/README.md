# pr:merge and pr:train

A Playground PR reaches `canary` only through `bun run pr:merge <n>`, or merge-on-ready (`bun run pr:train ready`), which runs pr:merge on the first gated PR in queue order, once it is ready at 5/5 with GitHub's checks green at its head.
This file holds the gates, the merge lock and the merge queue's readers.

## Gates

A draft left green reaches `canary` too: when the owner's draft passes every gate but ready, pr:merge marks it ready (`gh pr ready`) just before its squash, merge-on-ready takes it, `--explain` names it, and an outside author's draft is never touched (`marksReady` in `gates.ts`).
pr:merge refuses a PR the repo's owner did not open unless `--outside-author <login>` names its author (an outside PR's code runs here, so it merges only on a lead's go, after its read-only review), refuses a PR `~/.playground/ops/report/held-prs.json` lists, naming its reason (`PLAYGROUND_HELD_PRS` moves it, as the tests do; a file that does not read holds every PR), and refuses unless:

- `up to date`: the head holds everything on `canary`, or merges with it clean; a conflict waits for a merge of `canary`, whose new head then needs its own checks and 5/5.
- `ci`: the newest run of every GitHub check on the head, by workflow and name, has finished and passed, since a rerun or a close and reopen leaves the older runs listed; `Audit, Lint, and Build` and `test` (`REQUIRED_CHECKS` in `gates.ts`) are among them, and on factory.repo (the checkout's origin when unset) a GitGuardian check too, since a head GitGuardian never started on ran no secret scan.
- `body`: the PR body is the PR template, and its TL;DR holds no `Outcome:` label line (`bodyRefusal()` in `body.ts`, which names why it refuses).
- `review`: the newest `## ReviewBot · round <n>: <s>/5 at <sha7>` on the head reads 5/5.

Every verdict is read from the comments of the account that owns `factory.repo` alone (`packages/config/src/verdicts.ts` parses them): the reviewer's `## ReviewBot` line, which the `review` gate reads, and the tester's `## TesterBot · <PASS|FAIL> at <sha7>` line, which the Dashboard shows and no gate reads.
`--explain` prints each gate and what it found.
suite.sh's `audit` fails only on an advisory the head adds over its merge base with `canary`.
It also refuses a head holding a merge of `canary` that dropped a line its `canary` side added, in a file git merges without a conflict, which git's own merge of its two parents (`git merge-tree --write-tree`) keeps, `canary` still holds and the squash onto `canary` lacks (`keeps canary`, `lost.ts`), naming each file and merge:
a merge with `-s ours` leaves exactly that while `canary` reads as merged in.
A read it cannot finish refuses too.
A blank line, a move (its text added elsewhere in the merge's diff) and a rewrite (a line its hunk adds is 80% alike) pass.
A line a merge of `canary` dropped clears once the squash holds it again or `canary` drops it too, so it stays lost after a new merge of `canary` and after a restore that a later own commit replaces: redo that merge plainly and re-apply the change in a commit of the PR's own, or keep the line.

## Holds and rulings

A hold is a line in the `held` object of `~/.playground/ops/report/held-prs.json`, `"<owner>/<name>#<n>": "<reason>"`, which Ops writes the moment a lead sends `hold <owner>/<name>#<n>: <reason>` and removes on the lead's word; pr:merge and merge-on-ready refuse a listed PR, naming the reason.
A lead that overrules a reviewer's FAIL posts one comment on the PR whose first line is `Lead ruling: ReviewBot round <r> at <sha7> overruled: <evidence>; the fault moves to #<issue>`, with that issue filed first; pr:merge reads no ruling, so the merge still waits for a fresh verdict at the head, or the Builder's merge by hand.
A red check that `canary` caused needs a fresh run once `canary`'s fix lands: merge `canary` into the PR, since `gh run rerun` reuses the run's original merge commit, which holds the red `canary`.
An outside author's PR goes to the Builder, who gives its go only after a read-only review of its diff.

## The merge lock

Only one merge into `canary` runs at a time: pr:merge takes the factory's merge lock (`mkdir ~/.playground/merge.lock`, its PR number inside; `PLAYGROUND_MERGE_LOCK_DIR` moves it, as the tests do), reads every gate and `canary` inside it, and lets it go into `merge-locks/<pr>-<epoch ms>-<random>` however it ends, a refusal included,
and only while the lock still names its PR; a lock another merge holds refuses, naming that PR.
With `REDIS_URL` set, the lock's holder is also a Redis key with a time to live (`playground:merge.lock`, `takeLock` in `merge.ts`, through `@packages/redis`), renewed while pr:merge runs, and the folder is marked with that key and its pid, so a merge that crashed leaves a lock the next merge takes over once its key lapses;
a merge that cannot reach Redis keeps to the folder alone and so is refused by any holder.
`bun run lock take|renew|free` gives a shell script the same Redis lock (exit 3: no Redis, keep the script's own lock file).
It squash-merges with `--match-head-commit <head>` and `--body` set to the PR body less every line opening `Co-authored-by:`, in any case, since AGENTS.md's Commits rule keeps that trailer out of `canary` and GitHub's own squash body copies it from the PR's commits, tries once more on a GitHub 5xx, checks the PR reads `MERGED`, prints the merge SHA and, after letting the lock go, leaves its merge comment.
Then it ends the PR's worker, reviewer and tester (`scripts/ops/optimizer/auto_end.ts`, the factory's SESSIONS.md End), each line to its lead; a failure there is printed and never undoes the merge.
`--explain` takes no lock.
Like `bun run verify`, pr:merge and pr:train first build the workspace packages they import when a `dist` is missing or lacks an export (`packages/scripts/src/verify/prebuild.ts pr-merge`), so either runs from a fresh worktree;
in the factory's main checkout (`$PLAYGROUND_REPO`), which builds only `packages/*` after a pull, the prebuild stops instead, verify's and `bun run dev`'s too, and says to run from your own worktree.

## When canary moves

A PR behind `canary` that merges with it clean merges as it is, on its own head's checks and 5/5, so several gated PRs merge back to back with no new run.
When its head conflicts with `canary`, merge `canary` in and resolve it; the new head then needs GitHub's checks and a 5/5 of its own.
A refusal `--explain` shows to be wrong goes to the Builder, who alone may merge that PR by hand with `gh pr merge <n> --squash --body <body> --match-head-commit <head>`, `<body>` the one pr:merge would pass (above), on an override in the factory's **override** shape, and has pr:merge fixed.

## The merge queue

`bun run pr:train` (`train.ts` beside it; `--help` gives each command) reads the merge queue, `merge-queue.json` beside the merge lock (`PLAYGROUND_MERGE_QUEUE` moves it, as the tests do): the owner's open PRs in its order, then any other by number; an outside author's PR never merges on ready.
`ready` is merge-on-ready (`ready.ts`, which the merge-train ops job runs every cycle): the first PR, in that order, whose every gate passes at its head merges at once through pr:merge; one merge a call.
`forecast` merges each open PR, gated or not and drafts included, onto `canary` and the PRs ahead of it in the queue, as GitHub's squash merge will, and prints each predicted conflict with its files and the PR it comes from, so a worker rebases onto the PR ahead before its next review round rather than after that PR lands; it writes nothing.
