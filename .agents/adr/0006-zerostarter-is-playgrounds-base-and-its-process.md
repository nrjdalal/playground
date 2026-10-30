# ZeroStarter is Playground's base and its process

Playground began as a skills repo with its own rules in CLAUDE.md. On 6 Oct 2026 the owner chose a local app as Playground's front and set the build's shape: a new app is initialised from ZeroStarter, Playground moves into it and it becomes the base, ZeroStarter is the template Playground is based on and the source of truth for how everything is built, and Playground is reset to a ZeroStarter init state and built on top of it.

## Decision

- The repo is a ZeroStarter fork: the two `zerostarter init` commits are its base, and Playground's history is merged into them whole, with every conflict resolved to ZeroStarter's side.
- ZeroStarter's AGENTS.md is the one guide (CLAUDE.md is its symlink); Playground's own rules are a `## Playground` section of it.
- ZeroStarter's process applies to Playground's skills too: Conventional Commits through lefthook and commitlint, PRs squash-merged into `canary`, and `main` reached only by a release, on the owner's go-ahead.
- Playground's skills, scripts, tests and docs keep their paths, so the symlinks in `~/.claude/skills` still resolve.

## Consequences

- This supersedes the merge step of [ADR 0004](./0004-an-independent-reviewer-is-the-gate.md): the reviewer is still the gate for a merge into `canary`, and a skill change reaches the installed skills only when a release lands on `main`.
- Once lefthook's hooks are installed, every commit in every worktree runs lint-staged and `bun run build` and must be a Conventional Commit, so a branch cut from the pre-ZeroStarter `main` rebases onto `canary` before it can commit.
- The PR that made the fork merges into `canary` with a merge commit rather than a squash, so the two init commits and the merge of Playground's history stay in `canary`'s history, as the base this ADR names. Every later PR squash-merges.
- 0005 is skipped: the closed lightdesk branch holds an ADR under that number.
