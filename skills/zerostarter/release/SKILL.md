---
name: release
description: Cut a production release by promoting canary to main. Use when asked to cut, ship, or publish a release, tag a version, or push canary to production.
source: https://github.com/nrjdalal/zerostarter
---

# Release

A ship promotes `canary` to `main` by hand: one PR `canary -> main`, merged with a **merge commit**, then a tag and a GitHub release on that merge.
`auto-canary-into-main.yml` runs on each push to `canary`, and by hand (`workflow_dispatch`), and only opens the draft ship PR when none is open, moving no version; it opens the PR with `GITHUB_TOKEN`, so it needs the repository's "Allow GitHub Actions to create and approve pull requests" setting on.
No workflow tags a ship or writes a changelog, so every step below is yours.
`main` deploys to production, so ship only on the user's go-ahead (playbook's **release** rule gives it to Ops).

Run every command from a cwd inside the Playground checkout, so `gh` reads the right repository.

## 1. Pin the content

Every PR meant for this ship is squash-merged into `canary`. Pin the head you ship:

```bash
gh pr list --base canary --state open   # anything that should ship still open?
CANARY=$(gh api repos/{owner}/{repo}/branches/canary --jq .commit.sha)
```

Run the new-user gate on it, `bun run gate:new-user "$CANARY"` (`.agents/testing.md`, End-to-end tests), and name each FAIL and INCONCLUSIVE line in the ship PR's body.

Done when `CANARY` holds the SHA you mean to ship and the gate's PASS and FAIL list for it is in hand. When `canary` moves before step 3, read it again.

## 2. Open the ship PR

Write the body to a file first. It opens with two or three plain sentences the owner reads first, then `## What ships`, one line per PR since the last tag (`gh release view --json tagName --jq .tagName` names it).

```bash
gh pr create --base main --head canary \
  --title "ci(release): 🚀 merge canary into main" --body-file <file>
```

When a dispatch of `auto-canary-into-main` already opened it as a draft, `gh pr create` refuses: edit that PR's body instead and mark it ready (`gh pr ready <n>`). Done when `gh pr list --head canary --base main --state open` shows it, ready.

## 3. Merge into `main`

```bash
gh pr merge <n> --merge --match-head-commit "$CANARY"
MERGE=$(gh pr view <n> --json mergeCommit --jq .mergeCommit.oid)
```

Done when the PR reads `MERGED` and `MERGE` holds its merge commit. A refusal for a moved head means `canary` moved: go back to step 1.

## 4. Tag and publish

The tag is the last tag's patch plus one (`v0.0.98` is followed by `v0.0.99`); the root `package.json` version is not moved and does not decide it.

```bash
gh api -X POST repos/{owner}/{repo}/git/refs -f ref=refs/tags/vX.Y.Z -f sha="$MERGE"
gh release create vX.Y.Z --verify-tag --latest --generate-notes
```

Done when `gh release list -L 1` shows `vX.Y.Z` marked Latest.

## 5. Pull the main checkout

Run `playground update` (`packages/scripts/src/playground/update.ts`) in a run slot; the command is the main checkout's own, linked into `~/.bun/bin`:

```bash
~/.playground/ops/run-slot.sh <your name> -- playground update
```

It runs each step below and stops at the first that fails, naming it:

1. Fetch and fast-forward onto `origin/main`, since `pull --ff-only origin main` there fails with "Cannot fast-forward to multiple branches". A checkout on another branch with a clean tree moves to `main` at `origin/main` first, and a dirty one stops here.
2. `link-skills.sh`, before anything else, since every later step and every ops job reads `~/.playground`, which it links to `~/.playground` on a machine holding only the old folder; when the merge changed a skill, `playground update` then prints `skills changed:` with each one's folder in the checkout, which you send every lead, for each live checker to read the new text there (the `release` rule says why).
3. Install when the merge changed `bun.lock` or a `package.json`, with `--ignore-scripts`, since the postinstall's `deps-manager.ts` can rewrite a `package.json` there (v0.0.141's pull left a newly added `nanoid` uninstalled, so `bun run name` failed).
4. Build `packages/*` when the merge changed a package with a `dist` (`packages/scripts` runs from source, so a change there alone builds nothing), since the `playground` command imports their `dist`, with env validation off, since the main checkout has no `.env`.
5. Restart each ops job whose source the merge changed ([ops-restart](../../../scripts/ops/README.md#when-a-job-restarts-onto-new-code)).
6. Roll the Dashboard, which answers `Already up to date` when `canary` has not moved.

A build that fails part way can leave another package's `dist` cleaned and empty (`packages/redis`, which pr:merge's lock imports, on v0.0.107): after a failed build, fix its cause and run `env NODE_ENV=production SKIP_ENV_VALIDATION=true <main checkout>/node_modules/.bin/turbo run build --filter='./packages/*' --cwd <main checkout>` by hand, since the merge has landed and a second `playground update` sees nothing changed.

Done when the main checkout's `HEAD` equals `origin/main`, `playground update` exits 0, no `ops-restart:` line reads `still runs` or a non-zero `up.py exited`, every package but `packages/scripts` holds a `dist` with files in it, and each folder a `skills changed:` line names has reached every lead.

## Notes

- **Merge method is load-bearing.** `canary` PRs squash; the ship PR merges with a **merge commit** so `main` keeps shared history with `canary` and the next ship's diff stays clean.
- **The notes are GitHub's.** `--generate-notes` lists the PRs since the last tag, so a ship makes no changelog commit on `canary`.
- **Each tag is made once.** A tag that already exists fails the `git/refs` call: read the last tag again and take the next number.
