The live Dashboard runs `origin/canary`'s latest head and belongs to the runner holding it; everyone else asks Ops and tests on a stack in their own worktree.
One owner for the live stack keeps the owner's real sessions on a build every merge has passed, never a branch or a worktree.
Only that runner starts, stops or restarts its stack and changes its checkout, and its supervisor rolls it onto each new `canary` head and back when the head fails.
Done when `curl -fsS -o /dev/null "$(bunx portless get playground --no-worktree)"` exits 0.
How the live Dashboard rolls is in `.agents/dashboard/live.md`.
