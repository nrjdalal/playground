# Playground

Run a team of Claude agents.

Playground runs the Claude Code sessions on your Mac as a team, with a Dashboard to watch and steer it.
You talk to one session, the dispatcher. It hands each ask to the managers and workers that own it, and each worker builds in a git worktree of its own.
The Dashboard shows what every session is doing, what waits on you, and what they made.

Playground runs on your Mac only. It reads every session's transcript, so it never goes on a server.

Built on top of [ZeroStarter](https://zerostarter.dev).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/nrjdalal/playground/main/install.sh | bash
```

`install.sh` installs every tool Playground needs that is missing (`bun`, `claude`, `docker`, `gh`, `git`, `node`, `python3` and herdr, the terminal your sessions run in), signs Claude Code and GitHub in when it runs in a terminal, clones Playground into `~/playground`, builds it, links the `playground` command into `~/.bun/bin`, and starts it once every required tool is there. It prints a **Left for you** list of anything it could not do. A second run changes nothing.

You need a Mac, a Claude account and a GitHub account.

## Get started

1. Install starts Playground and opens the Dashboard; the first start takes a few minutes. After that, `playground` in a new terminal starts whatever is down and opens it.
2. On a first run, the Dashboard's chat checks this Mac: each missing thing the app can set up has a button that does it, the database's **Start a local container** among them. Once nothing is missing, click **Continue**. You are now this Mac's owner, signed in with no password, and later starts skip the checks.

   > **Warning**: the local database listens on every interface with the user, password and database `postgres`. Anyone who can reach this Mac on its port can sign in to it.

3. The same chat then lists the steps left, each ticked once done: GitHub, **Set up settings** (your settings in a private repo under your GitHub login), a Claude account, and **Start Alpha**.

   Install does the first two when it can, and its **Left for you** list names any it could not.

4. Once your dispatcher runs, its chat takes the steps' place: send it a message.

When something does not start, run `playground doctor`, or see [Troubleshooting](web/next/content/docs/troubleshooting.mdx).

## What you get

- **Chat**: talk to your dispatcher, send it files, and run its skills from the `/` menu.
- **Inbox**: answer the decisions and drafts your sessions post, and read their updates.
- **Agents**: each session's status at a glance, with its pages.
- **The team**: managers route and plan the work, workers build it, and a reviewer scores each PR until it reaches 5/5.
- **Skills**: every session gets Playground's skills, and an org adds its own in an extension.
- **Settings and extensions**: your own values, rules and skills in one place, in your private repo, synced each night once you turn that job on ([Export, import and backup](web/next/content/docs/backup.mdx)).
- **The `playground` command**: start, check, update and remove Playground from any terminal. `playground --help` lists every command.

The full docs start at the [Overview](web/next/content/docs/index.mdx), and the running app serves them at `/docs`.

## Skills

Core's own skills; the rest are in [Skills and orgs](web/next/content/docs/skills.mdx).

### Model-invoked

Model- or user-reachable.

- **[code-review-loop](./extensions/core/skills/code-review-loop/SKILL.md)**: Review one PR as its reviewer session, round by round until 5/5: core's code-review on two axes (the right thing, built well), a score out of 5 checked against the ticket, inline comments, a re-review on every push, its own threads resolved, and a fresh full read before the last 5/5. Its recovery scan lists the open PRs whose head nobody has scored.
- **[playbook](./extensions/core/skills/playbook/SKILL.md)**: Run Playground's factory of herdr sessions by one set of rules: the roles (the dispatcher, the Planner, the two leads Builder and Ops, workers with their reviewers and testers, runners, probes), who reports to whom, how work is routed and bundled, how sessions start and end, the leads' sweep, and the standing rules every session keeps.
- **[pr](./extensions/core/skills/pr/SKILL.md)**: Use when writing a PR body.
- **[to-inbox](./extensions/core/skills/to-inbox/SKILL.md)**: Write an Inbox item the owner reads at a glance: a picture of the point first (a diff, an ASCII drawing, before and after shots, or an HTML demo page), then emoji bullets in ASD-STE100 plain English, one callout when a fact must not be missed, and what Approve does. Every factory session loads it before `playground ask new`.

### User-invoked

Reached only by typing them.

- **[setup](./extensions/core/skills/setup/SKILL.md)**: Check and set up what the skills need on this machine: the command-line tools and the gh login, the home skill set, the Linear connection, and each extension's own needs through its setup check. Run once on a new machine, or when a skill fails for a missing tool or connection.

## Development

For contributors working on Playground itself. Install the dependencies first, then start the stack:

```bash
bun install
bun run dev
```

This serves named `.localhost` dev URLs through portless (`bunx portless list` shows them). `PORTLESS=0 bun run dev` uses fixed ports instead (web `:3000`, api `:4000`). `install.sh` sets portless's proxy up once with your Mac's password; by hand, from a terminal in the checkout: `sudo node_modules/.bin/portless service install`, then `node_modules/.bin/portless trust`.

A checkout with no `.env` gets one from `.env.example` on its first `bun run dev`, with `BETTER_AUTH_SECRET` generated. A stack in a worktree under `.claude/worktrees/`, a factory session or a test run reads made-up sessions and shows a **Test data** badge.

### CI

Two workflows run every check on GitHub's hosted runners, on every pull request into `canary` or `main`, with no label to start them: `auto-check-build.yml` (its job `Audit, Lint, and Build`: format, lint, types, the suite and the build) and `auto-test.yml` (its job `test`: `bun run test:skills`).
Both run on `pull_request`, never `pull_request_target`, with a read-only token, so a fork's pull request reaches no secret and waits for approval before it runs.

Playground registers no self-hosted runner, since a fork's pull request could then run its code on that machine. `runnerProblems` (`packages/scripts/src/workflow-runners.ts`) holds every workflow to hosted images, and its test fails on a self-hosted one.

## Maintaining

The rules are in [AGENTS.md](./AGENTS.md), which CLAUDE.md links to. [`lat.md/`](./lat.md/where-to-edit.md) maps each kind of change to the file or symbol to edit, and `bun run test:skills` fails when one of its links no longer resolves.
