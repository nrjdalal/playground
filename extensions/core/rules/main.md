Build, test and commit in your own worktree under `.claude/worktrees/`; the main checkout runs only its upkeep and reads.
Every installed skill follows the main checkout, so a build, test or write there reaches every session at once.
Its upkeep is a fetch and `git merge --ff-only origin/main`, the install and the packages build a pull needs, `git reset --keep origin/main` off a stray local commit, and `scripts/link-skills.sh`, in the forms **release** names.
Start lefthook from a script whose `cwd` is a scratch repo, as `tests/lefthook.test.ts` does.
The `no-main-checkout` hook refuses the rest: scripts/hooks/README.md, no-main-checkout.
