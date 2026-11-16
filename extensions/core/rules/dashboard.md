The live Dashboard runs `origin/canary`'s latest head and belongs to the runner holding it; everyone else asks Ops and tests on a stack in their own worktree.
One owner for the live stack keeps the owner's real sessions on a build every merge has passed, never a branch or a worktree.
Only that runner starts, stops or restarts its stack and changes its checkout, and its supervisor rolls it onto each new `canary` head and back when the head fails.
no-main-checkout refuses a git write in that checkout to every factory session but its runner and the ops lead (`scripts/hooks/README.md`).
Done when `playground status` prints `Dashboard web: up`, since it reads the Dashboard through the portless folder that serves, scheme and port included.
How the live Dashboard rolls is in `.agents/dashboard/live.md`.
