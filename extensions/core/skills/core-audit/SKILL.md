---
name: core-audit
description: "Check that Playground's core holds nothing beyond its generic self: no linked org's terms, read at run time from the extensions, and no value or process shaped like one org's. Report each hit by its place and kind, never its text, then fix them in one PR and keep the run as an audit doc."
license: Complete terms in the repository's NOTICE
disable-model-invocation: true
---

# core-audit

Core is generic: an org's terms, values and processes live in that org's extension, never in this repo ([ADR 0016](../../../../.agents/adr/0016-playground-is-generic-with-a-small-core.md)). This audit finds what slipped in. It names no org: leg 1 reads every linked org's terms at run time, and leg 2 needs no list, so it runs with no org linked at all.

Every hit is a **place**: `file:line`, its kind and where it belongs. The matched text stays out of the report, the fix PR's body and the doc, since it is the very term core keeps out.

## 1. Run both legs

In a Playground checkout whose HEAD is `origin/canary`'s (a fresh worktree under `.claude/worktrees/`, its install done), run `bun run core-audit`. It prints one line a hit, `path:line`, the leg, the kind and where the hit belongs, then a count per kind, and exits 1 on any hit. It exits 2, naming the file, when an org is linked and its list, its policy or the login cannot be read: fix that first, since leg 1 would read nothing.

- **Leg 1** runs when an org scope sits under the data folder's `extensions/`, and says so when none does. Its terms are no-public-leak's derived list (names, handles, companies, Slack ids, tracker keys), each org scope's own name, and its GitHub orgs and repository (`ext.links`, `ext.repos`). A tracker key counts keyed (`MADE-12`) and bare (`MADE`, `worker-made`, `MADE 12`).
- **Leg 2** always runs: a Slack id, a person's home path or a tracker key written into the tree. A placeholder passes: an id holding `EXAMPLE` or `MADE`, a home of `you`, `me`, `owner`, `someone`, `runner` or `x`, a key whose team holds `MADE` (`MADEDUNE-4`) or is the factory's own `PG`, a made-up team (`AB`, `ABC`, `ACME`, `FIX`) or a standard (`ISO`, `PDF`, `SHA`, `UTF`). A team a real org could hold, such as `ENG`, stays off that list, so a doc writes `AB-12` for its example key.

**Done when** the run printed its count per kind for both legs, or leg 1's line that no org is linked.

## 2. Read for one org's process

Leg 2's other half is judgement, so read it yourself: list core's skills (`extensions/core/skills/`, `skills/`), rules (`extensions/core/rules/`), brief templates (`scripts/briefs/`), scripts and ops jobs (`scripts/`, `packages/scripts/src/`), settings keys (`packages/settings/src/`) and spawn flags (`scripts/spawn.sh`), and judge each by its purpose.

A job, skill, settings key or spawn flag whose purpose is one org's process (its incident rota, its ticket flow, its watch on one chat tool) is org content, even when every value comes from settings. The test: would a second org with a different process run it as it is? A step only one org's tracker, team or customer takes, a default that is one org's value, or an input only one org's own job writes fails it.

Worked example: an incident-rota start job reads its ticket prefixes, hours and brief from settings, so its code holds no org term, yet its purpose is to start a worker for each ticket on one org's incident rota. A second org with another rota, or none, would not run it as it is, so the job, its keys and its docs are org content and belong in the org's extension. What any org's job uses (spawn.sh's pass past the load gate, `playground focus`, the ops-job framework) stays in core.

**Done when** every item on that list has a verdict by the test, and each one-org item is a place on the report.

## 3. Report

Group the hits by kind, each as `file:line` and where it belongs:

| Hit                                             | Belongs                                  |
| ----------------------------------------------- | ---------------------------------------- |
| A list term in a test or a fixture              | a made-up value in core (`MADE`, `acme`) |
| A list term anywhere else                       | the org's extension                      |
| A Slack id or a home path                       | config with a sensible default           |
| The same in a test or a fixture                 | a placeholder id or home                 |
| A tracker key (leg 2)                           | a placeholder key such as `PG-1`         |
| A one-org skill, rule, script, job, key or flag | the org's extension                      |

A bare tracker key that is also a word or an abbreviation hits in plain prose too: give each such hit a verdict, a trace or plain prose, and drop the prose ones from the report.

**Done when** each hit of steps 1 and 2 has its row or a prose verdict, and no row holds a matched term.

## 4. Fix in one PR

Open one PR into `canary` that moves each piece out or swaps in a made-up value, by the Shipping flow in `AGENTS.md`; its body names places and kinds alone. A hit an open PR already fixes counts as taken: name that PR instead.

**Done when** `bun run core-audit` prints zero hits on the PR's head, or each hit left names the PR that takes it.

## 5. Keep the run

Write the report of step 3, counts and `file:line` alone, as a file at mode 600 in your scratchpad, then put it in the owner's login scope: `playground ext put <login> doc audit-YYYY-MM-DD-core <file> --reason "<why>"`. It lands as `proposed`, for another session's score or the owner's accept.

**Done when** `playground ext list --kind doc --scope <login>` lists `audit-YYYY-MM-DD-core`.

## Limits

- Leg 2 has no shape for a company or a person's name, since a made-up one reads like a real one without a list: leg 1 covers those once an org is linked.
- Leg 2's tracker key is a shape alone: a real key whose team is on its placeholder list or holds `MADE` passes it, and leg 1's list finds that one.
- Leg 1's bare tracker key also hits a word or an abbreviation spelled the same, which step 3's verdict sorts out.

## Keep the skills learning

When you get past a hurdle this skill did not foresee, find a fix, or find a faster way, tell the `dispatcher` session: `SendMessage` to `dispatcher` with what happened, what worked, and which skill and section it belongs in, in a few plain lines. When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on. A finding never carries prod data, secrets or customer details.
