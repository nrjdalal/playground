## What it does

`core-audit` checks that Playground's core holds nothing beyond its generic self: no linked org's terms, and no value or process shaped like one org's.
An org's work lives in that org's extension ([ADR 0016](../../.agents/adr/0016-playground-is-generic-with-a-small-core.md)), and this audit finds what slipped into core anyway.
It names no org and keeps no list of one: it reads every linked org's terms at run time, and half of it needs no list at all, so it runs the same with no org linked.
Each hit is reported by its place and kind (`file:line`, leg, kind and where it belongs), never by the text it matched, since that text is the very term core keeps out.

## When to reach for it

Type `/core-audit` when you want to know whether core is still generic: after a run of org work, before core is shared, or when a review spots one org's term in a merged change.
Nothing fires it on its own.

| Leg                     | Runs                        | Finds                                                                                                                                                             |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, a linked org's terms | when an org scope is linked | no-public-leak's derived list, each org's own name, GitHub orgs and repository, a tracker key keyed or bare                                                       |
| 2, org-shaped values    | always                      | a Slack id, a person's home path or a tracker key written into the tree, and a skill, rule, script, job, settings key or spawn flag that serves one org's process |

The runner, `bun run core-audit`, prints the hits and exits 1 on any, or 2 when an org is linked and its list, policy or login cannot be read; the skill adds the read for one org's process, the report, the fix PR and the audit doc.

## Where a hit belongs

| Hit                                             | Belongs                                  |
| ----------------------------------------------- | ---------------------------------------- |
| A list term in a test or a fixture              | a made-up value in core (`MADE`, `acme`) |
| A list term anywhere else                       | the org's extension                      |
| A Slack id or a home path                       | config with a sensible default           |
| The same in a test or a fixture                 | a placeholder id or home                 |
| A tracker key (leg 2)                           | a placeholder key such as `PG-1`         |
| A one-org skill, rule, script, job, key or flag | the org's extension                      |

A placeholder passes leg 2: an id holding `EXAMPLE` or `MADE`, a home of `you`, `me`, `owner`, `someone`, `runner` or `x`, a key whose team holds `MADE` or is the factory's `PG`, a made-up team or a standard such as `UTF-8`.
Leg 2 reads every file, `tests/` and the fixtures included, for all three kinds.

## One org's process

A job, skill, settings key or spawn flag whose purpose is one org's process (its incident rota, its ticket flow, its watch on one chat tool) is org content, even when every value comes from settings.
The test: would a second org with a different process run it as it is?
An incident-rota start job is the worked example: its ticket prefixes, hours and brief all come from settings, yet it starts a worker for each ticket on one org's incident rota, so it belongs in that org's extension, while what any org's job uses (spawn.sh's pass past the load gate, `playground focus`, the ops-job framework) stays in core.

## It's working if

- The report lists places and kinds, and you never see an org's term in it.
- One PR moves each hit out, and the runner prints zero on its head.
- Each run leaves a `doc audit-YYYY-MM-DD-core` item in your login scope.

## Where it fits

A check beside trace-count, which ratchets the same list kinds at each commit: trace-count counts, core-audit locates and fixes.
It reads the list no-public-leak's guard reads, and its fix PR goes through the usual review loop ([code-review-loop](./code-review-loop.md)).
