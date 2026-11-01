---
name: gh-commit
description: Create atomic commits in the conventional format. Use when the user asks to commit or save changes.
source: https://github.com/nrjdalal/zerostarter
---

> [!CAUTION]
> Synced from https://github.com/nrjdalal/zerostarter. Customize this skill or remove this note to stop syncing.

# Git Commit

ATOMIC commits, conventional format. Stage and commit only; never push unless the user explicitly asks.

## 1. Inspect

```bash
git status --short
git diff
git diff --staged
```

Read the staged and unstaged changes before deciding what belongs together.

## 2. Stage

One logical unit per commit (ATOMIC): split unrelated changes into separate commits so every staged file belongs to the same unit.

```bash
git add <paths>
```

## 3. Commit

```bash
git commit -m "<type>(<scope>): <subject>"
```

| Element     | Rule                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**    | `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `style`, `build`, `revert`. Type `ci` is RESERVED for pipeline-generated commits (no workflow writes one now); real CI work uses `fix(ci)`/`feat(ci)`/`docs(ci)`. Dependency refreshes use `build(deps)`. |
| **Scope**   | Optional area in parentheses (package, component, feature).                                                                                                                             |
| **Subject** | Imperative, lowercase, no period. The commit-msg hook rejects a header over 100 chars or a capitalized subject (`subject-case`).                                                          |
| **Body**    | Optional; explain "why", not "what". Wrap lines at 100 (the hook rejects longer).                                                                                                       |

Leave out a `Co-authored-by` trailer (repo rule): the commit-msg hook refuses one in any case, whatever an attribution reminder asks. It also runs commitlint (`@commitlint/config-conventional`), and `pg-scope`, which refuses a `(PG-<n>)` scope that names another item than the branch's `PG-<n>-` prefix, naming both; commit it on that item's branch. Pre-commit runs these steps in order, and the first that fails stops the commit:

1. `main-checkout` refuses a commit in the factory's main checkout (the one `~/.playground/ops/run-slot.sh` links into), naming the fix: commit in a worktree under `.claude/worktrees/`.
2. `conflict-markers` refuses a staged `<<<<<<<` or `>>>>>>>` line, named by file and line, before the formatter can rewrite it into Markdown that reads clean.
3. `skills-manager` regenerates the AGENTS.md skills tables when a skill changed.
4. `lint-staged` formats and lints the staged files, and stages what it fixed.
5. `agents-rules` runs `bun run test:file tests/AGENTS.test.ts` when AGENTS.md, CLAUDE.md, a `.agents/dashboard/*.md` file or `tests/AGENTS.test.ts` is staged (Markdown alone included; a reworded `ALWAYS:` rule, a dashboard topic file with no pointer, or AGENTS.md grown past 97% of its `BUDGET`, the test's `MARGIN`, fails it).
6. `docs-wrap` refuses a staged wrapped doc (`PATTERNS` in `packages/scripts/src/docs-wrap/cli.ts`) that holds a line of more than one sentence or one over its limit, reading the docs as lint-staged's formatter left them: run `bun run docs:wrap`; the wrap rule is the `doc-sync` skill's.
7. `dev-stack` refuses while this worktree's `bun run dev` runs, since the build rebuilds `packages/*` under the stack and hangs it: stop the stack, then commit.
8. `trace-count` runs the trace ratchet's test (`tests/packages/scripts/src/trace-count/count.test.ts`) on any commit but one of images and fonts alone, and refuses when a count over the working tree rises past `counts.json`: it counts every tracked and untracked file as it stands on disk, staged or not, and names the kind alone. Find the hit in the new text of `git diff HEAD` and in each untracked file `git status --short` lists, then write it in plain words; for `issueRefs`, describe the case in words, since a doc cites no issue number.
9. `env-keys` names every key `.env` lacks or leaves empty, but `POSTGRES_URL`, which first run's setup fills: fill each from `.env.example`.
10. `build` runs `bun run build` through `packages/scripts/src/commit-slot.ts`: in a factory worktree it waits for a run slot first, and anywhere else (a fork, a plain clone) it builds at once.

`dev-stack`, `env-keys` and `build` skip a commit whose every staged file is Markdown (`*.md`) or a Python file anywhere under `tests/`.

`lint-staged` writes its fixes into your files, so read a file again after each commit before you edit it: an edit made from the copy you held before the commit lands on stale text (a test was once duplicated this way).

**Examples**:

```
feat(auth): add OAuth provider support
fix(api): prevent duplicate webhook delivery
refactor(web): extract auth middleware into separate module
docs(readme): update installation steps
build(deps): bump dependencies to latest versions
```

A merge keeps git's own message, which commitlint passes: `git merge origin/canary --no-edit`, and `git commit --no-edit` to finish a merge you resolved by hand. Merge canary with git's default strategy and resolve each conflict yourself: the ours strategy (`-s ours`) and the ours option (`-X ours`) drop what canary added while canary still reads as merged in, so the PR's squash deletes it with every gate green. The factory's no-ours-merge hook refuses both, and pr:merge's keeps canary gate (`packages/scripts/src/pr-merge/README.md`) refuses a head whose canary merge dropped canary's lines. Work you set aside is typed like any other commit: `chore(<scope>): wip <what>`.

### Resolving a merge conflict

Resolve each conflicted file hunk by hunk, keeping the lines both sides need, then run `git diff HEAD -- <file>` before you stage it. Every `-` line there is a line of your branch the merge drops: a file rebuilt whole from one side (`git checkout --theirs`, or canary's copy with your edits typed back) drops your branch's own lines outside the conflict hunks too. Done when every `-` line is one canary itself removed or changed.

## 4. Push (only when explicitly requested)

Stop after the commit. Push only when the user says "commit and push", "push the changes", or confirms when asked.

## Notes

- Never commit directly to canary (the default branch); branch first, then PR.
- The pre-commit build prints the size table only. Refresh the graph svg manually: `bun packages/scripts/src/build-sizes.ts --graph`.
