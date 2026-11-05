# pr:merge and pr:train

A Playground PR reaches `canary` only through `bun run pr:merge <n>`, or merge-on-ready (`bun run pr:train ready`), which runs pr:merge on the first gated PR in queue order, once it is ready at 5/5 with GitHub's checks green at its head.
This file holds the gates, the merge lock and the merge queue's readers.

## Gates

A draft left green reaches `canary` too: when the owner's draft passes every gate but ready, pr:merge marks it ready (`gh pr ready`) just before its squash, merge-on-ready takes it, `--explain` names it, and an outside author's draft is never touched (`marksReady` in `gates.ts`).
pr:merge refuses a PR the repo's owner did not open unless `--outside-author <login>` names its author (an outside PR's code runs here, so it merges only on a lead's go, after its read-only review), refuses a PR `~/.playground/ops/report/held-prs.json` lists at the gates or just before the merge call, naming its reason (`PLAYGROUND_HELD_PRS` moves it, as the tests do; a `"*"` line until it lapses (Holds and rulings), or a file that does not read, holds every PR), and refuses unless:

- `up to date`: the head holds everything on `canary`, or merges with it clean; a conflict waits for a merge of `canary`, whose new head then needs its own checks and 5/5.
- `ci`: the newest run of every GitHub check on the head, by workflow and name, has finished and passed, since a rerun or a close and reopen leaves the older runs listed; `Audit, Lint, and Build` and `test` (`REQUIRED_CHECKS` in `gates.ts`) are among them, and on factory.repo (the checkout's origin when unset) a GitGuardian check too, since a head GitGuardian never started on ran no secret scan.
- `body`: the PR body is the PR template, its TL;DR holds no `Outcome:` label line, and its Evidence section names each changed `*.md` path (a `SKILL.md` included) by its full repo-relative path, as AGENTS.md's Shipping step 1 asks (`bodyRefusal()` in `body.ts`, which names why it refuses and each doc left out).
  The changed paths are the PR's files from the one paginated `pulls/<n>/files` read `factsOf` makes, a renamed file by both its paths, so Checks, `pr:merge`, merge-on-ready and the train judge the same list.
- `review`: the newest `## ReviewBot · round <n>: <s>/5 at <sha7>` on the head reads 5/5.
- `types`: last, inside the merge lock once every other gate passes, the tree the squash makes type-checks (`types.ts`), since a head's own checks typed it alone and a clean textual merge can still call an API `canary` changed.
  It skips when the head already holds `canary`'s tip (`git merge-base --is-ancestor`), whose own checks typed that very tree.
  Else it checks the `git merge-tree --write-tree` tree out detached in `.claude/worktrees/merge-types`, the one worktree every merge reuses and keeps however it ends, since cloning and removing a whole `node_modules` (about 114k files) on each merge drove the load to 93 on 2 Nov.
  It forces the checkout to the tree and removes every untracked and ignored file but `node_modules` (`git clean -ffdx -e node_modules`), so nothing the last check left reads into this one.
  `node_modules` takes a clone of the caller's when the worktree has none ([scripts/README.md](../../../../scripts/README.md#a-worktrees-node_modules)), then `bun install --force` in place of that section's plain install first, since a fresh copy that printed any error needs the forced one.
  A kept `node_modules` takes a plain `bun install` when `bun.lock`, `bunfig.toml`, a `package.json` or a file under `patches/` differs from its last install, as `node_modules/.merge-types-deps` records them; an install removes that record first and writes it once it exits 0, so a retry after a clone or install that never finished takes the plain install too, which repairs a partial copy (measured), and a forced one there would rewrite every package (27s measured, against 0.2s plain).
  It then runs CI's own type steps there, each through `~/.playground/ops/run-slot.sh` as `ops-merge-train`, whose class 0 skips the queue and whose quick step starts at once, past the quick slot's race, since every step runs inside the merge lock (bare under a run that already holds a slot, or with no run-slot): `turbo run check-types --filter='...[<canary>]'`, the build and data-table metrics `check-types:tests` reads, then `check-types:tests`; its pass names each step's seconds.
  When the PR's diff from `canary` touches `scripts/hooks/` or `packages/`, whose files a hook imports, `hooks-bundle.ts --check` runs first, after the install, since a head branched before another PR rebuilt a bundle passes its own checks while the squash writes that bundle beside the source this PR changed (3 Nov: a shell.ts change merged after a rebuild of no-raw-delete.js it predated, and canary went red).
  A type error refuses with the first errors and the fix (merge `canary` in, fix it, and the new head needs its checks and a 5/5), and a stale bundle with the files `--check` names and its fix (merge `canary` in plainly, run `bun run hooks:bundle` and commit the rebuild on its own, then checks and a 5/5); either is kept beside the lock (`merge-types/<head>-<canary>`), so merge-on-ready's next cycle refuses the same pair at once; a run it cannot finish in 600s (`TYPES_BUDGET_MS`, which every gate in one `pr:train ready` call shares, so the call ends inside the merge train's 900s), counting each step's wait for a CPU slot as well as its run, or a step that fails another way refuses, naming it, and runs again on the next try.
  `--explain` names whether it would run or skip, and why, and runs no type check.

Every verdict is read from the comments of the account that owns `factory.repo` alone (`packages/config/src/verdicts.ts` parses them): the reviewer's `## ReviewBot` line, which the `review` gate reads, and the tester's `## TesterBot · <PASS|FAIL> at <sha7>` line, which the Dashboard shows and no gate reads.
`--explain` prints each gate and what it found.
suite.sh's `audit` fails only on an advisory the head adds over its merge base with `canary`.
It also refuses a head holding a merge of `canary` that dropped a line its `canary` side added, in a file git merges without a conflict, which git's own merge of its two parents (`git merge-tree --write-tree`) keeps, `canary` still holds and the squash onto `canary` lacks (`keeps canary`, `lost.ts`), naming each file and merge:
a merge with `-s ours` leaves exactly that while `canary` reads as merged in.
A read it cannot finish refuses too.
lefthook's pre-push command `keeps-canary` (`prepush.ts`) runs the same check before the push lands, a review round sooner: on a push whose range holds a merge, it reads the squash onto `origin/canary` as fetched with `lostLines` and refuses in this gate's words, from local git alone, while a head that conflicts with `canary` passes it, since this gate names the conflict.
A blank line, a move (its text added elsewhere in the merge's diff) and a rewrite (a line its hunk adds is 80% alike) pass.
A line a merge of `canary` dropped clears once the squash holds it again or `canary` drops it too, so it stays lost after a new merge of `canary` and after a restore that a later own commit replaces: redo that merge plainly and re-apply the change in a commit of the PR's own, or keep the line.
When every lost line sits under `scripts/hooks/bundled/`, the refusal names its cause, bundles rebuilt inside the merge, and that redo: merge `canary` plainly, commit the merge with `canary`'s bundles as they are, then run `bun run hooks:bundle` and commit the rebuild on its own (`hooks:bundle` refuses to write while a merge is in progress).
After that reset, `bun run hooks:merge-canary` makes that merge and rebuild, two commits, from a clean tree (`scripts/hooks/README.md`).

## Holds and rulings

A hold is a line in the `held` object of `~/.playground/ops/report/held-prs.json`, `"<owner>/<name>#<n>": "<reason>"`, which Ops writes the moment a lead sends `hold <owner>/<name>#<n>: <reason>` and removes on the lead's word; pr:merge and merge-on-ready refuse a listed PR, naming the reason: each reads the file at the gates and again inside the merge lock, after the types gate and just before the merge call, so a hold written while the type check runs still stops the merge.
One `"*": "<reason>"` line holds every PR at once, as a ship's merge hold does, while a PR's own line keeps its own reason.
The ship flow writes it with `bun run ship:freeze <version>` when its freeze starts (`startFreeze` in `held.ts`), with the time in the file's `since` object, and removes it with `bun run ship:freeze --end` once the tag lands or the ship stops (`endFreeze`).
`bun run ship:freeze status` prints the `"*"` line, its `since` (or focus's `until`) and whether it has lapsed, or that none is set, and writes nothing (`freezeStatus`); any other word that is not a version (`vX.Y.Z`) prints the usage and writes nothing, since a stray word written as the version would hold every PR.
A freeze's own `"*"` line (its reason ends `ships: canary is frozen until its tag lands`) lapses 4 hours after that time (`FREEZE_LAPSE_MS`), so a ship that stopped without its `--end` holds no PR for long, and a ship still running then writes it again.
A `"*"` line Ops wrote by hand never lapses, even beside a time an earlier freeze left, and `ship:freeze <version>` and `--end` both leave it for Ops to remove; a PR's own line never lapses either.
`playground focus on` writes focus's own `"*"` line (its reason ends `has focus: every merge waits until focus ends`, `startFocus`), with the focus end in the file's `until` object, at which it lapses; `playground focus off` removes it (`endFocus`).
Focus keeps a ship's freeze or a hand line it finds, and a ship's freeze writes over focus's line, since the ship's tag waits on it.
A lead that overrules a reviewer's FAIL posts one comment on the PR whose first line is `Lead ruling: ReviewBot round <r> at <sha7> overruled: <evidence>; the fault moves to #<issue>`, with that issue filed first; pr:merge reads no ruling, so the merge still waits for a fresh verdict at the head, or the Builder's merge by hand.
A red check that `canary` caused needs a fresh run once `canary`'s fix lands: merge `canary` into the PR, since `gh run rerun` reuses the run's original merge commit, which holds the red `canary`.
An outside author's PR goes to the Builder, who gives its go only after a read-only review of its diff.

## The merge lock

Only one merge into `canary` runs at a time: pr:merge takes the factory's merge lock (`mkdir ~/.playground/merge.lock`, its PR number inside; `PLAYGROUND_MERGE_LOCK_DIR` moves it, as the tests do), reads every gate and `canary` inside it, and lets it go into `merge-locks/<pr>-<epoch ms>-<random>` however it ends, a refusal included,
and only while the lock still names its PR; a lock another merge holds refuses, naming that PR.
A SIGHUP, SIGINT or SIGTERM releases it too (`stop.ts`, whose cleanups run newest first): pr:merge ends the types gate's running step and waits for it, keeping its worktree, then moves the lock into `merge-locks/<pr>-<epoch ms>-<signal>`, again only while it names its PR, and exits 128 plus the signal's number, so a run stopped by its own handle never leaves the lock held, and no next merge checks out into the shared worktree under a step still running there.
A signal that comes once the squash has begun waits for it to settle, merged or failed, before the lock goes, since the spawned `gh pr merge` would carry on past the exit; the run then posts no merge comment and ends no sessions, whatever the squash did, and a second signal exits at once.
With `REDIS_URL` set, the lock's holder is also a Redis key with a time to live (`playground:merge.lock`, `takeLock` in `merge.ts`, through `@packages/redis`), renewed while pr:merge runs, and the folder is marked with that key and its pid, so a merge that crashed leaves a lock the next merge takes over once its key lapses;
a merge that cannot reach Redis keeps to the folder alone and so is refused by any holder.
`bun run lock take|renew|free` gives a shell script the same Redis lock (exit 3: no Redis, keep the script's own lock file).
It squash-merges with `--match-head-commit <head>` and `--body` set to the PR body less every line opening `Co-authored-by:`, in any case, since AGENTS.md's Commits rule keeps that trailer out of `canary` and GitHub's own squash body copies it from the PR's commits, tries once more on a GitHub 5xx, checks the PR reads `MERGED`, prints the merge SHA and, after letting the lock go, leaves its merge comment.
Then it ends the PR's worker, reviewer and tester (`scripts/ops/optimizer/auto_end.ts`, the factory's SESSIONS.md End) and cleans each worktree an ended one used, each line to its lead; a failure there is printed and never undoes the merge.
`--explain` takes no lock.
Like `bun run verify`, pr:merge and pr:train first build the workspace packages they import when a `dist` is missing, is older than a file under its package's `src`, or lacks a name their sources import from it, those reached through a relative import outside their folder included (`packages/scripts/src/verify/prebuild.ts pr-merge`), so either runs from a fresh worktree;
in the factory's main checkout (`$PLAYGROUND_REPO`), which builds only `packages/*` after a pull, the prebuild stops instead, verify's, `bun run dev`'s, `test:file`'s and `check-types:tests`' too, and says to run from your own worktree.
On every run, built or not, pr:merge and pr:train also stop on a worktree whose install predates its `bun.lock`, a workspace package's dependency linked neither in its own `node_modules` nor the root's (`staleInstall`, through `prebuildStep`), naming the `bun install --ignore-scripts` that fixes it, since a build would otherwise stop on `tsdown: command not found` and a run on `Cannot find module` (2 Nov, after a canary merge made `packages/settings` depend on `@packages/safe-delete`).

## When canary moves

A PR behind `canary` that merges with it clean merges on its own head's checks and 5/5 once the `types` gate's check of the merged tree passes (its type check, and its bundles step for a PR touching `scripts/hooks/` or `packages/`), so several gated PRs merge back to back with no new GitHub run.
When its head conflicts with `canary`, merge `canary` in and resolve it; the new head then needs GitHub's checks and a 5/5 of its own.
A refusal `--explain` shows to be wrong goes to the Builder, who alone may merge that PR by hand with `gh pr merge <n> --squash --body <body> --match-head-commit <head>`, `<body>` the one pr:merge would pass (above), on an override in the factory's **override** shape, and has pr:merge fixed.

## The merge queue

`bun run pr:train` (`train.ts` beside it; `--help` gives each command) reads the merge queue, `merge-queue.json` beside the merge lock (`PLAYGROUND_MERGE_QUEUE` moves it, as the tests do): the owner's open PRs in its order, then any other by number; an outside author's PR never merges on ready.
`ready` is merge-on-ready (`ready.ts`, which the merge-train ops job runs every cycle): the first PR, in that order, whose every gate passes at its head merges at once through pr:merge; one merge a call.
`forecast` merges each open PR, gated or not and drafts included, onto `canary` and the PRs ahead of it in the queue, as GitHub's squash merge will, and prints each predicted conflict with its files and the PR it comes from, so a worker rebases onto the PR ahead before its next review round rather than after that PR lands; it writes nothing.
