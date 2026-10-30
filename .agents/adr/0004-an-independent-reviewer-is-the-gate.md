# An independent reviewer is the gate, not the owner

> Superseded in part by [ADR 0006](./0006-zerostarter-is-playgrounds-base-and-its-process.md): the reviewer still gates a merge, into `canary`, and `main` moves only by a release on the owner's go-ahead.

Playground PRs used to wait for the owner: a finding from another session merged only after the owner said yes, and the owner's own requests merged once seen. On 5 Oct 2026 the owner stepped out of development: the owner talks with the sessions, they push the roll, and no pull request waits on the owner's review, however many stand open.

## Decision

- Every Playground PR ships the same way: a draft, a review loop with a reviewer agent other than its author until it scores 5/5 on the latest head with CI green and nothing left to change, then ready, merge, relink, and a line to the owner saying what landed.
- A finding from another session goes through the same loop; it no longer waits for the owner's yes.

## Consequences

- The reviewer is the only check before a change reaches every session's installed skills, so it works in its own scratch clone and is never the PR's author.
- The owner learns what landed from the reply, after the fact; a change the owner dislikes is undone by another PR.
- A rule relayed by another session (a person's role, who is asked) can now land without the owner's eyes on it, so the PR states the ask it came from in plain words.
