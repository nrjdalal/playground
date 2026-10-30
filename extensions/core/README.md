# Core

Playground's own skills, which every session gets; core's upstream skills are listed in its NOTICE.

## Model-invoked

Model- or user-reachable.

- **[code-review-loop](./skills/code-review-loop/SKILL.md)**: Review one PR as its reviewer session, round by round until 5/5: core's code-review on two axes (the right thing, built well), a score out of 5 checked against the ticket, inline comments, a re-review on every push, its own threads resolved, and a fresh full read before the last 5/5. Its recovery scan lists the open PRs whose head nobody has scored.
- **[playbook](./skills/playbook/SKILL.md)**: Run Playground's factory of cmux sessions by one set of rules: the roles (the dispatcher, the Planner, the two leads Builder and Ops, workers with their reviewers and testers, runners, probes), who reports to whom, how work is routed and bundled, how sessions start and end, the leads' sweep, and the standing rules every session keeps.
- **[pr](./skills/pr/SKILL.md)**: Use when writing a PR body.
- **[to-inbox](./skills/to-inbox/SKILL.md)**: Write an Inbox item the owner reads at a glance: a picture of the point first (a diff, an ASCII drawing, before and after shots, or an HTML demo page), then emoji bullets in ASD-STE100 plain English, one callout when a fact must not be missed, and what Approve does. Every factory session loads it before `playground ask new`.

## User-invoked

Reached only by typing them.

- **[setup](./skills/setup/SKILL.md)**: Check and set up what the skills need on this machine: the command-line tools and the gh login, the home skill set, the Linear connection, and each extension's own needs through its setup check. Run once on a new machine, or when a skill fails for a missing tool or connection.
