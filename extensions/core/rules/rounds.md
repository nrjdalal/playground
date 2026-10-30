One reviewer session serves a PR across all its rounds, spawned again under the same name only when it is down.
Its worker spawns it once and sends it each new head, since a re-spawn starts cold and reads the whole PR again.
ops-tick's auto-end ends a reviewer that has sat idle with every head scored, and tells its worker, who resumes it under the same name on the next push.
From round 2 the reviewer reads only the commits since its last scored head and the open findings, and keeps the whole-diff read for a 5/5 candidate.
SESSIONS.md's End section holds the auto-end, and code-review-loop's steps 2 and 4 hold the rounds' reads.
