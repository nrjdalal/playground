# pr:merge and pr:train

A Playground PR reaches `canary` only through `bun run pr:merge <n>` or a merge train (`bun run pr:train`), once it is ready at 5/5.
This file holds the stamp every gate reads, the gates, the merge lock and the train.

## The stamp

Every CI verdict a merge reads is the **stamp**: one comment by the repo's owner holding one YAML block, every key always present but `remark` and each check's `comment`.

```yaml
status: green # green | red | wait
commit: 9d77e97
checks:
  verify:
    status: fail # pass | fail | skip
    source: local # a GitHub run id | local | agent
    comment: The cursor check failed. # optional
remark: The verify check failed. # optional
```

- The stamp's `remark` and a check's `comment` are each one ASD-STE100 sentence of at most 20 words, and may be left out, a comment for each step and the remark for the final verdict.
- Each check's `source` says where it ran: a GitHub run id, `local` (Checks, the train) or `agent` (the tester's `agent-drive`, the reviewer's `agent-review`); every check an agent makes is named `agent-`, so an agent's check reads apart from CI's.
- `packages/config/src/verdicts.ts` alone renders (`stampText`) and parses (`verdictOf`) the block, refusing a missing or extra key (an older stamp's `runner`, `run` or `note` among them), a value outside its list or a long remark or comment; every reader takes the parsed object, and only the module's own tests touch the text.
- `bun run stamp post <sha> <status> --pr <n> --check "<name>=<pass|fail|skip>[@<source>] [<comment>]" --remark "<sentence>"` is the one writer, each check's source `agent` for an `agent-` check and only there, else a GitHub run id or `local`, the default: Checks (`checks.py`), the tester, the reviewer's look and the train post through it; with no `--pr` it posts on the commit, as `canary`'s own run does on its tip.
- `bun run stamp jobs <n> <sha>` posts the stamp GitHub's `Audit, Lint, and Build` and `test` jobs earned (`JOB_CHECKS` in `verdicts.ts`), each check's source its run id: wait while a job is queued, running or cancelled, else green or red once both have finished with their steps run (a job the carry skipped stamps nothing), with `verify` skipped when the diff has no dashboard code; ops-checks-go runs it on every PR with a go, since a GitHub job posts as a bot and only the owner's stamps count.
- `bun run stamp carried <n> <sha>` prints `green=true` when the stamp at the head is green and passed every check those jobs run, and `canary`'s tip is not stamped red; both workflows then skip their steps.
- `bun run stamp read <n> <sha>` prints what the walk reads as JSON, for ops-checks-go.

What a head's stamp is (`stampAt` in `stamp.ts`): pr:merge walks back along first parents from the head, past each clean canary merge (its second parent on `canary`, and `git merge-tree --write-tree` of its two parents gives its own tree, so no conflict and no edit in the merge) and each commit whose stamps are all the reviewer's look, to the first commit holding a stamp.

- **Carry**: a clean canary merge needs no stamp of its own, whatever files the two sides share, a `bun.lock` included, and the 5/5 carries along the same walk.
- **Look**: a canary merge that is not clean stops the walk until the PR's reviewer posts a stamp on it, green with a passing `agent-review` check, or wait when it needs CI (code-review-loop's look step).
- On one commit the newest stamp from each place its checks ran holds (GitHub, `local`, `agent`), a tester's (one with an `agent-drive` check) apart from the reviewer's look, and a look's wait gives way to a run's stamp posted after it, while a red look stands; together they read red if any is red, else wait if any waits, else green.
- A check passed when the nearest stamp naming it on the walk is green and passed it.

### Edge cases

Each case is one line, the stamp that decides it, and a test of its gate result in `tests/packages/scripts/src/pr-merge/edge-cases.test.ts`, which parses every example here, so every case has its example.
An example shows only the checks that matter; a green that merges passes every `JOB_CHECKS` name too.

1. **Green**: a green stamp that passed every `JOB_CHECKS` name merges, from a GitHub-hosted or self-hosted run (its run id) or from a `local` run.

   ```yaml
   status: green
   commit: 69a6a4c
   checks:
     audit:
       status: pass
       source: 18234567890
     build:
       status: pass
       source: 18234567890
     check-types:
       status: pass
       source: 18234567890
     format:check:
       status: pass
       source: 18234567890
     lint:
       status: pass
       source: 18234567890
     test:
       status: pass
       source: 18234567890
     test:skills:
       status: pass
       source: 18234567890
   ```

2. **Dashboard code**: a diff on `DASHBOARD_PATHS` also needs `verify` passed, from Checks; GitHub's jobs stamp a diff with no dashboard code `verify: skip`, with the comment "The diff has no dashboard code.".

   ```yaml
   status: green
   commit: 69a6a4c
   checks:
     verify:
       status: pass
       source: local
   ```

3. **UI**: a diff on `web/next/` also needs `agent-drive` passed, from its tester.

   ```yaml
   status: green
   commit: 69a6a4c
   checks:
     agent-drive:
       status: pass
       source: agent
   ```

4. **Red**: one failed check makes the stamp red, with a comment, and the PR does not merge.

   ```yaml
   status: red
   commit: 69a6a4c
   checks:
     verify:
       status: fail
       source: local
       comment: The cursor check failed.
   remark: The verify check failed.
   ```

5. **Wait**: while a GitHub job is queued or running, its stamp waits, and the PR waits with it.

   ```yaml
   status: wait
   commit: 69a6a4c
   checks:
     test:skills:
       status: skip
       source: 18234567890
       comment: The test job is queued.
   ```

6. **Cancelled**: a cancelled job ran nothing, so it stamps wait, never red.

   ```yaml
   status: wait
   commit: 69a6a4c
   checks:
     test:skills:
       status: skip
       source: 18234567890
       comment: The test job ended cancelled.
   ```

7. **Clean merge**: a clean merge of `canary` carries the stamp and the 5/5 from the commit under it, with no stamp of its own.

   ```yaml
   status: green
   commit: 0d1e2f3
   checks:
     test:skills:
       status: pass
       source: local
   ```

8. **Merge with a conflict**: a merge of `canary` that is not clean needs the reviewer's `agent-review` at the new head before it carries.

   ```yaml
   status: green
   commit: 69a6a4c
   checks:
     agent-review:
       status: pass
       source: agent
   remark: The merge changed no line a test covers.
   ```

9. **Own commit**: a worker's own commit needs a new stamp and a new 5/5, since nothing carries past it.

   ```yaml
   status: green
   commit: 69a6a4c
   checks:
     test:
       status: pass
       source: local
   ```

10. **Reviewer's patch**: a reviewer's fix reaches the branch only as the worker's commit of the reviewer's patch (code-review-loop's step 5), and that commit is an own commit, so its gate result is case 9's.

    ```yaml
    status: green
    commit: 69a6a4c
    checks:
      lint:
        status: pass
        source: local
    ```

11. **Look on an own commit**: `agent-review` on a commit that is not a merge of `canary` carries nothing.

    ```yaml
    status: green
    commit: 69a6a4c
    checks:
      agent-review:
        status: pass
        source: agent
    remark: The commit changes one comment.
    ```

12. **Red canary**: a red stamp on `canary`'s tip stops every merge; the fix merges `canary` in and needs its own full green at its head.

    ```yaml
    status: red
    commit: 6f3db1e
    checks:
      test:skills:
        status: fail
        source: local
        comment: The SKILL.md size test failed.
    remark: The test:skills check failed on canary.
    ```

13. **Skipped job**: a GitHub job that skipped its steps posts no stamp, so it counts only through a carried green that passed every `JOB_CHECKS` name.

    ```yaml
    status: green
    commit: 0d1e2f3
    checks:
      check-types:
        status: pass
        source: 18234567890
    ```

14. **Other author**: a stamp from an account that is not the repo's owner reads as no stamp.

    ```yaml
    status: green
    commit: 69a6a4c
    checks:
      build:
        status: pass
        source: 18234567890
    ```

15. **Two stamps**: of two stamps from one place at one head, the newest holds.

    ```yaml
    status: green
    commit: 69a6a4c
    checks:
      verify:
        status: pass
        source: local
    remark: The second run passed.
    ```

16. **Other commit**: a stamp at a commit that is not the head counts only when the walk carries it there.

    ```yaml
    status: green
    commit: 5740cea
    checks:
      audit:
        status: pass
        source: local
    ```

17. **Review below 5/5**: a red `agent-review`, or a review score below 5/5, holds the merge whatever CI says.

    ```yaml
    status: red
    commit: 69a6a4c
    checks:
      agent-review:
        status: fail
        source: agent
        comment: The merge drops a line canary added.
    ```

18. **Train**: a train's step stamps a `train` check on every PR in it, which a train's land reads.

    ```yaml
    status: green
    commit: 69a6a4c
    checks:
      train:
        status: pass
        source: local
    ```

## Gates

A draft left green reaches `canary` too: when the owner's draft passes every gate but ready, pr:merge and a train's land mark it ready (`gh pr ready`) just before its squash, `pr:train build` takes it, `--explain` names it, and an outside author's draft is never touched (`marksReady` in `gates.ts`).
ci:go takes the same flag: `bun run ci:go <n> <sha7> --outside-author <login>` labels and logs an outside author's PR as it does the owner's and stamps its goAt when `merge-queue.json` lists it, and a go without the flag, or naming someone else, refuses it.
Its forecast reads the owner's open PRs alone (`openPrs` in `train.ts`), so a go for an outside author's PR prints no forecast line, and a conflict with it first shows at pr:merge's up-to-date gate.
Checks runs that head only when `checks.outsideAuthors` names its author (`outside.py` reads it) and the go's `by` is `builder`.
pr:merge refuses a PR the repo's owner did not open unless `--outside-author <login>` names its author (an outside PR's code runs here, so it merges only on a lead's go, after its read-only review), refuses a PR `~/.playground/ops/report/held-prs.json` lists, naming its reason (`PLAYGROUND_HELD_PRS` moves it, as the tests do; a file that does not read holds every PR), and refuses unless:

- `up to date`: the head holds everything on `canary`, or merges with it clean, which carries its stamp; a conflict waits for a merge of `canary` and the reviewer's look.
- `canary`: no red stamp on `canary`'s tip, the net canary's own run posts after each batch, unless the head holds that tip and its own stamp there passed every check GitHub's jobs run, which is how the fix merges.
- `review`: the newest `## ReviewBot · round <n>: <s>/5 at <sha7>` on the head, or on the nearest commit the walk reaches, reads 5/5.
- `stamp`: the head's stamp is green; a diff touching `web/next/`, `api/hono/` or `packages/{auth,config,db,env}/` (`DASHBOARD_PATHS`, which `checks.py` names alike and a test holds equal) also passed `verify`.
- `suite`: a green stamp on the walk passed every check GitHub's jobs run (`JOB_CHECKS`), so no PR merges on Checks' `verify` alone; a train rides without it and lands without it only on a step stamp that ran them all (`trainGates`).
- `tester`: a diff touching `web/next/` holds a green stamp that passed the tester's `agent-drive`; a train keeps this gate.
- `body`: the PR body is the PR template, and its TL;DR holds no `Outcome:` label line (`bodyRefusal()` in `body.ts`, which names why it refuses).
- `ci`: the newest run of every GitHub check on the head, by workflow and name, has finished and passed, since a rerun or a close and reopen leaves the older runs listed (none reported, while GitHub Actions is off, passes), among them, on factory.repo (the checkout's origin when unset), a GitGuardian check, since a head GitGuardian never started on ran no secret scan.

suite.sh's `audit` fails only on an advisory the head adds over its merge base with `canary`.
It also refuses a head holding a merge of `canary` that dropped a line its `canary` side added, in a file git merges without a conflict, which git's own merge of its two parents (`git merge-tree --write-tree`) keeps, `canary` still holds and the squash onto `canary` lacks (`keeps canary`, `lost.ts`), naming each file and merge:
a merge with `-s ours` leaves exactly that while `canary` reads as merged in.
A read it cannot finish refuses too.
A blank line, a move (its text added elsewhere in the merge's diff) and a rewrite (a line its hunk adds is 80% alike) pass, and a merge train holds such a PR as not gated.
A line a merge of `canary` dropped clears once the squash holds it again or `canary` drops it too, so it stays lost after a new merge of `canary` and after a restore that a later own commit replaces: redo that merge plainly and re-apply the change in a commit of the PR's own, or keep the line.
Every gate comment is posted under the account that owns `factory.repo`, so it reads verdicts from the repo owner's comments alone; `--explain` prints each gate and what it found.
Take back a go with `bun run ci:go <n> <sha7> --take-back`: it removes `Cloud CI` first, since go.py relaunches a PR that carries it with a go at its head, then drops that head's lines from `ops/gos.jsonl` and clears its goAt; within a cycle go.py stops a run it started whose PR lost `Cloud CI` or whose head moved.
A PR's label names where its CI runs: a go puts `Cloud CI` on it (GitHub Actions on the runner host wait for it) and takes `Local CI` off, and the Checks lane (`parallel.py`) puts `Local CI` on a PR it runs that carries neither, so a PR never carries both.

## Holds, rulings and lanes

A hold is a line in the `held` object of `~/.playground/ops/report/held-prs.json`, `"<owner>/<name>#<n>": "<reason>"`, which Ops writes the moment a lead sends `hold <owner>/<name>#<n>: <reason>` and removes on the lead's word; pr:merge and a train's build and land refuse a listed PR, naming the reason (a PR merged through a train while its hold lived only in messages).
A lead that overrules a reviewer's FAIL or a red stamp posts one comment on the PR whose first line is `Lead ruling: <ReviewBot round <r>|stamp> at <sha7> overruled: <evidence>; the fault moves to #<issue>`, with that issue filed first; pr:merge reads no ruling, so the merge still waits for a fresh verdict at the head, or the Builder's merge by hand.
A red that `canary` caused needs a fresh run once `canary`'s fix lands: merge `canary` into the PR, since `gh run rerun` reuses the run's original merge commit, which holds the red `canary`.
The merge train checks each of its steps itself in lane chk-1; Ops runs standalone Checks through `~/.playground/ops/checks/parallel.py` in lanes chk-3 to chk-5, running verify's stack and browser only on a diff touching `DASHBOARD_PATHS` (else the stamp's `verify` reads `skip`),
at most two at a time when they share no files, each after a lane preflight (a frozen install, packages that resolve, a browser session that opens), and a lane whose PR fails at its head goes to the next PR at once.
An outside author's PR goes to the Builder, who gives its go only after a read-only review of its diff, and it is tested here merged onto `canary`.

## The merge lock

Only one merge into `canary` runs at a time: pr:merge takes the factory's merge lock (`mkdir ~/.playground/merge.lock`, its PR number, or `train <id>` for a train's land, inside; `PLAYGROUND_MERGE_LOCK_DIR` moves it, as the tests do), reads every gate and `canary` inside it, and lets it go into `merge-locks/<pr>-<epoch ms>-<random>` however it ends, a refusal included,
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

A PR behind `canary` that merges with it clean merges as it is, on its stamp, so several stamped PRs merge back to back with no new run.
When its head conflicts with `canary`, merge `canary` in and resolve it; the review and the stamp then come from the reviewer's look at that merge, or from a new run when the look answers wait.
Two PRs that each pass alone can still break `canary` together (two growths of one size-capped file): `canary`'s own run after each batch, ops-merge-train's check of `canary`'s tip in lane 1 once it has moved, at most once an hour after the last check ends, only while no train runs, and for up to an hour past that only while no ready PR's Checks wait for a run slot (`canary_net()` in `scripts/ops/merge-train/run.py`), posts its stamp on that commit, and a red one stops every merge but the fix.
The net checks a red tip once more, so a flake clears on a green re-run, then halves along `canary`'s first parents between its last green commit and the red one, one check a cycle, and tells the lead and the owner which merge turned it red, or names the red tip itself when no earlier commit is known green (`net_target` and `net_record`, state in `canary-net.json` beside it).
While `canary` is red, its re-check, its halving and the next tip skip the hour and the wait, since a red `canary` already holds every merge; a full check takes 45 to 60 minutes of a slot under load.
The fix, a revert of that merge or a repair, merges `canary` in, and the `canary` gate passes it once GitHub's jobs stamp its own head green.
A refusal `--explain` shows to be wrong goes to the Builder, who alone may merge that PR by hand with `gh pr merge <n> --squash --body <body> --match-head-commit <head>`, `<body>` the one pr:merge would pass (above), on an override in the factory's **override** shape, and has pr:merge fixed.

## The merge train

A merge train (`bun run pr:train`, `train.ts` beside it; `--help` gives each command) merges a batch instead of one PR at a time: `build` takes every open PR of the owner's whose gates pass at its head (pr:merge's, bar up to date and the stamp, which the train's own stamp replaces, and the suite, which its step runs; the tester gate stays) in `merge-queue.json`'s order,
with no head-of-line blocking (a PR not gated, or held because its stamp is red at its head, holds nobody; one red at an earlier head rejoins at the back, a green train stamp restores its place, and a green stamp at the head a PR left a train at leaves it at the back), squashes each in turn onto `canary` and the PRs ahead of it as GitHub's squash merge will, so each step's tree is the tree `canary` holds once that PR merges,
leaves out and tells each PR that conflicts, pushes `train/<id>` and keeps `trains/<id>.json` beside the merge lock; it reads the queue from `merge-queue.json` beside the lock (`PLAYGROUND_MERGE_QUEUE` moves it, as the tests do), and an outside author's PR never rides.
ops-checks checks the step `next` names and posts on every PR up to it a stamp at the step's commit holding a `train` check; a red train is halved until one PR is found to break it.
`land`, under the merge lock, refuses unless `canary` is still the train's and every PR up to the passed step is at its step's head, passes its gates (the suite too, unless that step's stamp passed every check GitHub's jobs run) and carries that step's green stamp, then squash-merges each in order,
checking `canary`'s tree after each against its step's, tells the PR that broke the train that it left (once per head, and even when the land is refused, since the bisect already named it) and every other PR that did not merge, ends each merged PR's sessions as pr:merge does, and deletes the branch.
A land that stops midway (a merge GitHub refuses, a tree that differs, or an error after a merge) says so on the last PR it merged and in its output, since `canary` then holds a tree no run stamped, and `canary`'s own run stamps it next.
A note GitHub will not take stops the run with its error and leaves the train, and `end` files a train whose land will not clear.
`forecast` merges each open PR, gated or not and drafts included, onto `canary` and the PRs ahead of it in the queue and prints each predicted conflict with its files and the PR it comes from, so a worker rebases onto the PR ahead before its next review round rather than after that PR lands.
`ready` is merge-on-ready (`ready.ts`, which the merge-train ops job runs every cycle): the first PR `build` would take, in its order, whose every gate passes, its stamp carried past clean canary merges included, merges at once through pr:merge; one merge a call.
