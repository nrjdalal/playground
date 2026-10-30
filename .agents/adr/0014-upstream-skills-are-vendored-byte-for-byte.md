# Upstream skills are vendored byte for byte

Sessions reached the upstream skills through inscope, as links into its cache of the upstream repository at `main`: unpinned, so an upstream change reached every session unreviewed, and a public copy of this repo could not show which skills it calls. The owner first decided, through an Inbox decision, that the repository carries every upstream skill as it is, under its own license; a later decision keeps only the skills in use, inside the core extension.

## Decision

Core keeps the upstream skills in use, each flat at `extensions/core/skills/<name>/`, upstream's files byte for byte plus a `CREDITS.md` of core's; `extensions/core/upstream/` holds upstream's `LICENSE`, `SOURCE` (the commit and the date it was taken) and `MANIFEST` (each kept file's git blob sha), and core's `NOTICE` names the skills and their source.

- `bun run vendor:upstream [<sha or ref>]` is the only way those files change: it takes the kept skills (`UPSTREAM_SKILLS` in `packages/scripts/src/vendor-upstream/stage.ts`) and upstream's `LICENSE`, checks every file it writes against the tree's blob shas, leaves core as it was on any mismatch, and never commits.
- `tests/extensions/core/upstream/drift.test.ts` holds those files to `MANIFEST` offline, with no extra file and every kept skill present.
- The writing-first hook leaves the upstream skills alone, since no session edits them by hand, and the formatter and the trace ratchet read past them, since their text is upstream's.

## Consequences

- An upstream change reaches the repo only as a re-vendor PR, whose diff and drift test a reviewer reads, which answers ADR 0009's worry that a copy drifts silently.
- `pr` is core's one changed copy, `extensions/core/skills/pr/`, upstream's text plus the blocks the gates and the Changelog read, held by its own drift test against a pinned upstream copy; upstream's `pr` is not taken.
- The upstream skills keep their MIT license in `extensions/core/upstream/LICENSE`; the root `NOTICE` covers only this repo's own code, and `tests/NOTICE.test.ts` fails on any `LICENSE` at the root.
