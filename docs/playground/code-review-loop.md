## What it does

`code-review-loop` is how a reviewer session scores one PR out of 5, round by round, until nothing but nits is left to change. Each round reads what was asked (the plan item and the brief for a Playground PR, the Linear ticket and its comments for an org's one), reviews the change on two axes, posts a verdict and inline comments, and closes the threads the new head settles.

It treats a review as a **subscription**, not a one-off: every push gets a round, a finding stays open until a round sees it fixed in the code, and a faultless push does not raise the score while anyone's finding is still open. The score is the PR's, never the delta's.

It replaces review-bot. What review-bot learned stays; what changed is who runs it: one reviewer session per PR, spawned by the PR's worker, rather than one loop polling every repo in an org.

## When to reach for it

It is model-invoked: a reviewer session loads it from its brief, and you can type `/code-review-loop` too.

| Your situation                                 | What it does                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You are a reviewer and your worker sent a head | One round: recover, place the push, read the spec, review, score, post                                                                                                                                                                                                                                                                                                                    |
| A push lands that nobody announced             | Its background waiter ends with the new head, which starts the next round                                                                                                                                                                                                                                                                                                                 |
| A round would score 5/5                        | A fresh full read of the whole diff first, again at a head made only by merging canary in after it, `bun run check-types` through run-slot, and, when canary changed a file the PR changes or the PR adds or changes a repo scanner (with canary moved), the touched tests on a local merge with canary; 5/5 only if the read finds nothing blocking or should-fix and every run is green |
| A lead's sweep                                 | The recovery scan: open PRs whose head no verdict scored, and who holds each                                                                                                                                                                                                                                                                                                              |

## Two axes

The review itself is core's `code-review`, loaded by name and never copied: a **Spec** axis (is this the right thing: every requirement delivered, nothing unasked, and in an org's PR nothing beyond its ticket and the Product team's answers) and a **Standards** axis (is it built well, against AGENTS.md, the skills it touches and the reviewer's brief). A changed skill, agent guide or docs page is also held to core's `writing-for-agents`, which the reviewer loads first, so an agent doc that sprawls or leaves a step with no completion criterion costs the score as code would. The two stay apart in the verdict, so a well-built change that misses the ask cannot hide behind its quality. Its two sub-agents start with no memory of earlier rounds, which is what makes the read before the last 5/5 fresh.

## State lives on the PR

A reviewer session keeps nothing it cannot read back: the skill's `state.py` asks GitHub and git each time for the head, the newest verdict, the open threads and what others said since. So a session that restarts, or a new reviewer taking over, picks up exactly where the last verdict left off, and when GitHub cuts a list at its page size the script says so rather than reading the rest as absent. When the shared GraphQL budget is spent it reads the same facts over REST and says so, marking each review thread's resolution unknown rather than reading it as settled. The same script tells a base merge apart from new work: any commit of the PR's own in the push is new work, and otherwise it compares the PR's own changed lines on each side of the push, because a range diff across a merge of `canary` shows `canary`'s work as the PR's; a conflict resolved by hand that kept both sides reads as a base merge too. Its waiter for the next push polls GitHub's REST API, so a reviewer waiting all afternoon spends none of the GraphQL budget every session shares.

## It's working if

- Every verdict's first line reads `## ReviewBot · round <r>: <s>/5 at <sha7>`, at the head it names, and `bun run pr:merge` accepts the last one.
- Each finding of a round below 5/5 sits on its line in Files changed as well as in the verdict, while a 5/5's nits sit in the verdict alone, and the threads still open are exactly the findings still open.
- A push gets its round within a few minutes, announced or not.
- No verdict stands on stale CI: the reviewer reads the head's checks again right before it posts, and a check gone red since its earlier read is a blocking finding in that verdict.
- A reviewer stays up after its 5/5, its waiter on the head, until the PR merges or stays closed a poll later (Checks closes and reopens a PR to rebuild its merge commit), so a canary move after the score gets its merge round from the same session, not a new one.
- A reviewer idle 30 minutes with every head scored may be ended by the factory's 5-minute check, and its worker resumes it under the same name on the next push.
- A 5/5 can go stale with no push and no conflict: each time the reviewer sees canary move, it diffs what landed since each waiting 5/5's canary, checks that PR for any file:line or quoted text in those files, and scores each match again.
- The touched tests a reviewer runs come from the diff: the test of every file the PR changes, every test file it changes, every test that names or imports one of those files, by its path or from the test's own folder, plus the tests that scan the whole repo; `state.py touched-tests` lists them, and in a Python repo it adds each test that scans a folder holding a changed file and, when a prompt template changes, each test that pins a built prompt's digest.
- On a large app repo, when the touched tests run past about 100 files, green PR CI at the exact head stands as the merge evidence, and the reviewer runs the changed modules' own tests locally.
- When canary has moved and changed a file the PR changes, or the PR adds or changes a repo scanner, the 5/5 verdict names the touched tests it ran on a local merge with canary, since a merge git calls clean can still break; a red run or a conflict there blocks the 5/5. It names that canary from the merge commit itself, since a fetch after the merge would name one the run never merged.
- A dependency-bump PR whose advisory is answered as exactly pinned is scored only after the audit skill's rung 2 read of each parent's newest in-range version, since a parent's range often already carries the fix.
- A stacked child is scored on its own lines, read from its parent's branch, and a child that fails playbook's stack test is a blocking finding.
- The touched tests run in one form, `bun --cwd=<clone> run test:file <files>` through run-slot with no `NODE_ENV`, which reads the same on the runner box as on the Mac.
- Neither side of a review queues a run the other side has already measured at the same head: the result is asked for and cited. A box run's id is `ci-<first 12 of the tree>-<random>`, so a cited run's prefix is checked against the first 12 characters of `git -C <clone> rev-parse <head>^{tree}` before citing.
- When a merge with canary moves a path a test fixture uses, the reviewer points the fixture's reader at a missing path and checks each fixture-reading case goes red, since a reader that fails open passes a fixture left at the old path.
- A claim about one environment of a deploy-config repo reads that environment's values on the branch its ArgoCD app targets, not on the PR's branch.
- A finding against a rule written in the code, such as a ratchet that never rises, stays blocking when the brief lists the bend as agreed, unless that agreement quotes the rule's owner.
- A branch is called untested only once a grep of the tests for its effect and its entry point finds nothing, a mutation of it turns no test red, and the repo's testing guide has been read, so a suggested test never breaks that guide.
- A test that fails only on the runner box counts against the score once a rerun on the Mac fails too, so a difference in the box alone never lowers a score.
- A report that fails to send by name reaches the worker anyway, sent again to the `uds:` address its newest message came from.
- The reviewer's small fix goes to the worker as a patch, never as a commit of its own, since ADR 0004 makes the gate a reviewer independent of the code it scores: save `git -C <clone> diff > <scratch>/fix.patch`, restore the clone, check it with `git -C <clone> apply --check <scratch>/fix.patch`, and hand it over, since the worker applies it word for word.
- After a compaction, a resume, or a notice that background tasks did not finish before the previous session ended, the reviewer runs `state.py pr` for each PR it holds and re-arms every `state.py wait` with none running, since an account flip kills the waiters with no notice.
- A finding that asks for a behaviour states the behaviour wanted, not only the defect.
- On a collaborator's org PR whose review ask came to you, the session that posts your review replies to the ask right after, in the same DM or thread, with what you approved and any blocking note.
- A reviewer agrees with an author's reply only once it has reproduced the author's reason with one command, named in its reply.
- A 5/5 verdict says the fresh full read found nothing blocking or should-fix and `bun run check-types` ran green; a red run is a blocking finding.
- The reviewer posts the 5/5 verdict and its `Review • 5/5` label; GitHub's two checks green at the head are the next gate, never an input to the score.
- A round left with only nits scores 5/5: the reviewer lists them, or hands the small edit over as a patch, so a nit the worker leaves sends no PR through another test round.
- A PR body with no `test:skills` result in it is a nit, since GitHub Actions runs the suite at the head.
- When the ticket carries samples, the verdict holds a samples table, and a sample left unhandled holds the score down.
- A PR that changes a skill, an agent guide or a docs page has its writing judged against writing-for-agents in the verdict, beside the code.
- A FAIL a lead overruled on the PR (`Lead ruling:`) no longer counts against the score, once the issue the ruling names exists.
- The recovery scan lists no unscored PR held by a worker without a live reviewer, and no PR as lost: every open PR is held by an agent, parked by a plan, or another author's for the Builder to triage.

## Where it fits

[playbook](./playbook.md)'s **gate** names it: a reviewer session, spawned by the PR's worker, scores through code-review-loop, then the PR waits for GitHub Actions' `Audit, Lint, and Build` and `test` green at the head, which run on every push to the pull request. The Builder's sweep runs its recovery scan. It leans on core's `code-review` for the two axes; for an org's PR the **classified** rule holds, so its comments carry only the `ReviewBot` name.
