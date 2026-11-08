# Auto-memory runs as a reviewed trial

[ADR 0009](0009-learnings-live-in-the-repo.md) turned Claude Code's auto-memory off on 7 Oct 2026 for two reasons: 310 memory files sat in six project folders, and no review read them. On 7 Nov the owner chose to try auto-memory again, with Playground managing it. ADR 0009's goal stays: every learning still reaches the repo. This trial adds the two parts it lacked, a review step and an owner view, and it becomes permanent only if its A/B meets its bar.

## Decision

spawn.sh picks each start's arm by role and writes it into that session's own settings file, so the shared files keep memory off:

- On, each in its own folder under the data folder's `memory/`: the dispatcher (`memory/dispatcher/`) and the builder, ops and planner leads (`memory/<kind>/`). Claude Code shares one memory folder across a repository's worktrees, so each role writes its own.
- Fresh worker starts take turns: every second one is on in `memory/worker-b/` (the B arm), and the one before it is off (the A arm). `memory/worker-arm` keeps the last turn, and a resume keeps its row's arm.
- Off: probes, GLM sessions, runners, orchestrators, reviewers and testers, so the gate's read stays independent of what the author remembers, and the optimizer, which reviews memory.

The roster row records the arm as `memory=on` or `memory=off`, for the A/B to read. Memory holds the verified rules and facts a later session of the role will need, never state that changes, which the roster and the handoffs hold. Claude Code loads only an index's first 200 lines or 25 KB, so the index stays a small top layer. `bun run verify memory` scans every memory file for a secret, a person's or org's name, a private record, or prod data by its shape (a production host, a public IP address), flags an index over 200 lines or 18 KB, and exits 1 on a hit. A production figure, such as a count or an amount, has no shape the scan can tell from a fair number, so the optimizer's review reads each note for one. ops-unstick raises nothing for a note of a memory-on session.

## The bar

The metric is review rounds to 5/5 per merged PR, and tokens per merged PR, both for workers, over 20 merged PRs per arm. B passes when its median rounds are at most 85% of A's, or its tokens per merged PR are at most 90% of A's, with the other figure no more than 10% worse. The guardrails: memory adds at most 5k first-request tokens, the scan finds 0 hits over the trial, under 10% of the notes the optimizer's review reads are wrong, no index write is lost, and each index stays at 18 KB or less.

## Revert

One session goes back to off at its next start or resume with spawn.sh's `--memory off`, which launches it on the shared settings file and records `memory=off`, so its later resumes stay off. When B misses the bar, spawn.sh's arm pick goes, so every start is off again. The memory folders are archived, moved and never deleted, after the optimizer's review has read them.

## Consequences

- Every session spawned after the ship starts in an arm. The shared settings files are unchanged, so a session spawn.sh did not start keeps memory off.
- A learning a session remembers still has to reach the repo through a PR, by the **memory** rule, before another role reads it.
- The trial's readout decides between this ADR and ADR 0009.
