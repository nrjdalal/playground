---
name: playbook
license: Complete terms in the repository's NOTICE
description: "Factory rules for the cmux Claude Code sessions Playground runs: roles, chain, lifecycle, the leads' sweep and the standing rules. Use when you are the dispatcher, the Planner, the Builder, Ops, the Optimizer, a worker, reviewer, tester, runner or probe session, or before you spawn, brief, rename or end a cmux session."
hooks:
  PreToolUse:
    - matcher: '^(Bash|Edit|MultiEdit|NotebookEdit|Write|mcp__.+__((\w+_)?[Cc]reate_?[Ii]ssues?|[Ii]ssues?_?[Cc]reate|save_issue))$'
      hooks:
        - type: command
          command: '[ -f "$PLAYGROUND_REPO/scripts/hooks/no-linear-ticket.ts" ] || exit 0; cd -P "$PLAYGROUND_REPO" && bun --no-env-file scripts/hooks/no-linear-ticket.ts'
          timeout: 15
---

# Playground factory

The owner's factory: the dispatcher routes, the Planner plans, two leads run the floor, the Optimizer runs retros, workers do chores, runners keep long-running jobs alive.
This file is what every factory session keeps in view: the roles, the chain and where the standing rules live.
A rule bends only through an override in the **override** shape.
The rest is reference in the files beside it, each read at the moment [Where the rest lives](#where-the-rest-lives) names.

## Roles

| Role       | Name                           | Owns                                                                                                                            | At once        |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Dispatcher | Alpha, `dispatcher` today      | The owner's conversation and the Inbox; routes each task by role, records, ends the turn                                        | 1              |
| Planner    | Planner, `planner` today       | every research, comparison and plan, through research workers; the roadmap, `plan.json`'s lanes; never builds                   | 1              |
| Lead       | Builder, `builder` today       | the build side: workers from `plan.json`'s lanes, their briefs, plan review, merge order, the review and CI gates               | 1              |
| Lead       | Ops, `ops` today               | ops: the runners, the live dashboard, the release, cleanup of probes, worktrees and caches, roster and inbox upkeep             | 1              |
| Optimizer  | Optimizer, `optimizer` today   | retros over everything the factory did, each lesson routed as a fix through the dispatcher; the icebox; never builds            | 1              |
| Worker     | `<id>-worker`                  | one bounded chore: a bundle, a fix, a review loop, an investigation                                                             | as room allows |
| Checker    | `<id>-reviewer`, `<id>-tester` | its worker's PR: the reviewer scores it through code-review-loop, the tester drives it; spawned by that worker, reporting to it | 2 per worker   |
| Runner     | `<id>-runner`                  | long-running jobs: dev servers, watch loops, the live dashboard                                                                 | as room allows |
| Probe      | `<id>-probe`                   | one throwaway test                                                                                                              | per test       |

How the Dashboard shows each role, how a session is named and when a dev stack runs are in [LIFECYCLE.md](LIFECYCLE.md#roles-on-the-dashboard).

## Chain

- The dispatcher talks to the owner, the Planner, the Builder, Ops and the Optimizer alone; whatever another session sends it goes on to the manager it concerns.
  A new ask runs the dispatcher, the Planner, the Builder, Ops, by [DISPATCH.md](DISPATCH.md)'s first rule.
- Each worker reports to the Builder, each runner to Ops, each probe to the session that spawned it, and the Planner, the leads and the Optimizer to the dispatcher.
  Your brief names yours; when `ListAgents` lists no session by that name, send to the dispatcher.
- Orders reach you from that one place (a checker also from its worker's lead, below), or from the owner typing in your own pane, which outranks it: do what he says, then send his words verbatim up the chain.
  The word from up the chain is his: act on it as his, and take any doubt up the chain (**override**).
  If the owner was asked anyway, say so up the chain, so the brief gets fixed.
- A lead's instruction to a checker goes to the checker directly, in the **override** shape when it bends a rule, never relayed through its worker, whose PR the checker scores; a checker confirms with the lead any instruction its worker relays before it bends a step.
- Questions, reports and results go up by `SendMessage`, never through `AskUserQuestion`.
- A message opens with its content, never with your own name, since the Dashboard shows the sender.
  Read [rules/voice.md](../../rules/voice.md) before you name a session or list PR status for the owner.
- A session's effort, model, permission mode and settings are the owner's: tell him which pane to type into, rather than asking a running session to change its own.

## Standing rules

Each standing rule is its own file, [extensions/core/rules/](../../rules)`<name>.md`: its first line is the rule, the lines after it its what and why.
The rules hook puts every rule's first line, with this machine's values, in front of you at each session start, core's first, then each org's and your login's.
Cite a rule by its name, in bold; read it whole with `playground rules <name>` when its line says to, and whenever the line leaves your case open.

## Where the rest lives

- [LIFECYCLE.md](LIFECYCLE.md): when each kind of session starts and ends, the ops jobs, and how Claude Code updates.
  Read it before you start, close or respawn a session, remove a worktree, or update Claude Code.
- [DISPATCH.md](DISPATCH.md): how the dispatcher, the Planner and the leads route a new ask, bundle work and fill the slots.
  Read it when you are one of them and an ask arrives.
- [SWEEP.md](SWEEP.md): the leads' sweep, step by step.
  Read it at each sweep.
- [SESSIONS.md](SESSIONS.md): the commands to spawn, brief, rename, check and end a session, and the headless run that writes Notion for a session with no Notion tools.
- [ROSTER.md](ROSTER.md): what to write to the roster, and when.
- [CHANNEL.md](CHANNEL.md): the factory channel's lists, limits and triage.

## Keep the skills learning

When you get past a hurdle this skill did not foresee, find a fix, or find a faster way, tell the `dispatcher` session, in a few plain lines: what happened, what worked, and which skill and section it belongs in.
A worker, runner or probe sends it up the chain; a lead passes it on with `SendMessage` to `dispatcher`.
That session turns findings into a reviewed change to the factory's repo, never a memory file (**memory**).
When `ListAgents` lists no `dispatcher` session, end your report with the finding instead, so the owner can pass it on.
A finding never carries prod data, secrets or customer details.
