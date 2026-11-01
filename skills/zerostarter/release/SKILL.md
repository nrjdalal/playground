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

## Rehearse an invitee's update

When the candidate changes the update path anything in the ship's step 5 runs (`update.ts` itself, `link-skills.sh`, an ops job, the Dashboard roll), rehearse the update an invitee runs, from the last tag to the candidate, before the ship's step 3: a machine whose own checkout cannot take the update yet still gets the proof. The whole rehearsal lives in one scratch folder, and nothing outside it changes. A `--to` run stops before the Dashboard roll, which `playground update` reaches only without a tag, so the rehearsal proves the rest of the path; a candidate whose update-path change is only the roll proves itself on a dashboard stack of its own.

a. **Mirror.** Give the rehearsal an origin of its own: clone the repository bare into the scratch folder, then clone that mirror and, in the clone, fetch the pinned `$CANARY` from the repository, merge it into `main` with `--no-ff` (the merge commit a ship makes), tag the merge with the tag this ship will cut, and push `main` and the tag to the mirror.
   Done when the mirror's `main` holds the merge commit, the tag names it, and the repository holds neither.

b. **Contain.** Run every later command under `env -i`, so the run inherits nothing from the real environment, `PLAYGROUND_REPO` included, with `PATH` holding the stub folder first, then the throwaway `HOME`'s bin and the system basics, and `HOME` at a throwaway folder inside the scratch folder.
   Put a stub on `PATH` for each side-effecting tool the update can call, one that logs each call and refuses; read `update.ts`, `ops-restart/cli.ts` and what they call for the list.
   Leave `claude` off `PATH` altogether: `link-skills`' `orgs home` step waits for an absent `claude` and fails a stub that refuses.
   Record the before-state (listings and checksums) of everything outside the scratch folder the update could reach, the home folder's bins and links among them, before any install runs.
   Done when every tool on the list is stubbed or absent, and the before-state is saved.

c. **Invitee.** Clone from the mirror, check out the last tag on `main`, and install and build inside the containment, running the install and build steps of an invitee's install from the clone, since `install.sh` itself stops without `claude`:

   ```bash
   bun install --frozen-lockfile
   env NODE_ENV=production SKIP_ENV_VALIDATION=true node_modules/.bin/turbo run build --filter='./packages/*'
   bash scripts/link-skills.sh   # links this clone's playground command into the throwaway HOME's bin, already on PATH
   ```

   Done when `playground doctor` from the clone, still contained, reads `held at <last tag>, N commits behind origin/main`.

d. **Update.** Run `playground update --to <tag>`, then `playground doctor`, still contained.
   Done when the update exits 0, doctor's version line reads `at <tag>`, and every MISSING line names the containment's own doing (`claude`, or a tool a stub stands in for), so no need of the update itself reads MISSING; the after-state reads unchanged against the before-state, and each stub's log names the calls the real machine would have taken. A step that fails names its caller: when a stub took that call, the update needs it, so contain that call another way (a flag, an env) and run the rehearsal again.

The rehearsal's result goes into the ship PR's body beside the new-user gate's PASS and FAIL list.

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

It runs each step below and stops at the first that fails, naming it.
Steps 2 to 5 read what changed since the commit the last finished update reached, which it records in the data folder's `ops/update-head` once step 5 passes, so a run after one cut short (a crash, a killed terminal, a failed step) still installs, builds and restarts what that merge changed; with no record yet, they read from `HEAD` at the run's start, which it records before step 1 moves the checkout.

1. Fetch and fast-forward onto `origin/main`, since `pull --ff-only origin main` there fails with "Cannot fast-forward to multiple branches". A checkout on another branch with a clean tree moves to `main` at `origin/main` first, and a dirty one stops here.
   When the fast-forward fails because `main` holds a local commit no remote holds (a session's stray commit there), run `git -C <main checkout> reset --keep origin/main`, the one reset no-main-checkout lets through while the tree is clean, then run `playground update` again.
   When no-main-checkout refuses that reset (a dirty tree, or a commit some remote holds), stop there and send its reason up the chain, since that work or commit is someone else's to keep.
2. `link-skills.sh`, before anything else, since every later step and every ops job reads `~/.playground`, which it links to `~/.playground` on a machine holding only the old folder; when the merge changed a skill, `playground update` then prints `skills changed:` with each one's folder in the checkout, which you send every lead, for each live checker to read the new text there (the `release` rule says why).
3. Install when the merge changed `bun.lock` or a `package.json`, with `--ignore-scripts`, since the postinstall's `deps-manager.ts` can rewrite a `package.json` there (v0.0.141's pull left a newly added `nanoid` uninstalled, so `bun run name` failed).
4. Build `packages/*` when the merge changed a package with a `dist` (`packages/scripts` runs from source, so a change there alone builds nothing), since the `playground` command imports their `dist`, with env validation off, since the main checkout has no `.env`.
5. Restart each ops job whose source the merge changed ([ops-restart](../../../scripts/ops/README.md#when-a-job-restarts-onto-new-code)).
6. Roll the Dashboard, which answers `Already up to date` when `canary` has not moved.

A build that fails part way can leave another package's `dist` cleaned and empty (`packages/redis`, which pr:merge's lock imports, on v0.0.107): after a failed build, fix its cause and run `playground update` again, which builds again, since a run that stopped short records nothing.

Done when the main checkout's `HEAD` equals `origin/main`, `playground update` exits 0, no `ops-restart:` line reads `still runs` or a non-zero `up.py exited`, every package but `packages/scripts` holds a `dist` with files in it, and each folder a `skills changed:` line names has reached every lead.

## Notes

- **Merge method is load-bearing.** `canary` PRs squash; the ship PR merges with a **merge commit** so `main` keeps shared history with `canary` and the next ship's diff stays clean.
- **The notes are GitHub's.** `--generate-notes` lists the PRs since the last tag, so a ship makes no changelog commit on `canary`.
- **Each tag is made once.** A tag that already exists fails the `git/refs` call: read the last tag again and take the next number.
