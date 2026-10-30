# A person's stack reads their own machine; the fixture is for factory and test stacks

Until 7 Oct 2026 `dashboardSource()` read the live machine only on the branch `live/desk`, or with `PLAYGROUND_LIVE_READS`. Every other clone showed the fixture's made-up machine, with nothing on screen to say it was made up, so someone trying Playground from a fresh clone saw fake sessions and fake tickets, and no professional app shows made-up data. The owner approved this design on 7 Oct, relayed by the dispatcher.

The fixture exists for good reasons: a factory worker's stack must never read the live machine, tests must be hermetic, and real rows must never reach a screenshot or a PR.

## Decision

The source is chosen by who runs the stack, not by the branch's name. `dashboardSource()` in `api/hono/src/lib/dashboard/fixture.ts` takes the first rule that matches:

| #   | Condition                                                                      | Source                                                          |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1   | Branch `live/desk`                                                             | live; `PLAYGROUND_FIXTURE` refused                                    |
| 2   | `PLAYGROUND_LIVE_READS` set                                                          | live; `PLAYGROUND_FIXTURE` refused                                    |
| 3   | `PLAYGROUND_FIXTURE` set                                                             | that fixture, or the shipped one for `PLAYGROUND_FIXTURE=shipped`     |
| 4   | The checkout is under `.claude/worktrees/`, or `PLAYGROUND_ROLE` is set          | the fixture                                                     |
| 5   | A test run (`NODE_ENV=test`, which `bun run test` sets)                        | the fixture                                                     |
| 6   | Anything else: a person's own clone, on any branch                             | live, refused under Claude Code (`CLAUDECODE`) with no role set |

> Superseded in detail, the table above: since 17 Oct 2026 the code runs a test run third, `PLAYGROUND_FIXTURE` fourth and a factory stack fifth, and adds three clauses this decision did not name - a test run's `PLAYGROUND_FIXTURE` counts for nothing (the suite reads the shipped fixture, or the live paths its `liveReads` opts into), `CLAUDE_CONFIG_DIR` alone never decides, and a test run can opt into live paths. The decision, that who runs the stack picks the source, holds; `dashboardSource()` in `api/hono/src/lib/dashboard/fixture.ts` holds the live order.

A fixture stack wears a "Test data" badge beside the brand and in the tab's title. A stack reading its own machine shows, where an area has nothing to show, one line saying what is missing and how to set it up, never invented rows.

## Consequences

- A first run shows the person's real sessions, or clear setup steps.
- Factory and test stacks read what they read before, and now say so on screen.
- `bun run verify screenshots` still refuses any stack whose `/api/health` does not read `dashboard: "fixture"`, so screenshots stay free of real rows.
- The rule depends on every factory session setting `PLAYGROUND_ROLE` or working under `.claude/worktrees/`. The refusal in rule 6 covers a factory session that does neither: an agent's stack runs under Claude Code, a person's from their own terminal. Rules 1 and 2 keep no such refusal, so the live dashboard's runner and a probe test behave as before.
- The launcher passes `CLAUDECODE` and `PLAYGROUND_ROLE` through turbo, so the API chooses the source the launcher checked, and prints the rule it matched.
- This supersedes AGENTS.md's rule "Read a fixture on every stack but the live dashboard's".
- 0007 never landed: its holder, a review PR, closed unmerged, and the reviewer checklist it carried became the code-review-loop skill.
