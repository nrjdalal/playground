## What it does

`playbook` holds the operating rules of Playground's factory, the Claude Code sessions cmux or herdr runs on the owner's behalf: who does what, who reports to whom, how sessions start and end, how the leads keep watch,
and the standing rules (override, gate, comments, release, dashboard, clock, eta, roster, ask, tickets, classified, channel, signal, main, zerosdk, voice, terminal, local page, correction, upstream, verify, memory, writing, ci, slots, unstick, usage, glm, battery, context, rounds, polling, github, workers, meetings).
It lives in the repo rather than in one session's memory, so every session loads the same rules.

## When to reach for it

| You are, or you are about to                                                                              | It gives you                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| the dispatcher, the Planner, the Builder, Ops, the Optimizer, a worker, reviewer, tester, runner or probe | your role, who you report to and the rules you keep                            |
| Spawn, brief, rename, check or end a session                                                              | the lifecycle (`LIFECYCLE.md`) and the cmux and herdr commands (`SESSIONS.md`) |
| Update Claude Code                                                                                        | the update steps in `LIFECYCLE.md`                                             |
| Route a new ask, or run a lead's sweep                                                                    | `DISPATCH.md` and `SWEEP.md`                                                   |
| Answer the owner's DM while Slack mode is on                                                              | `DISPATCH.md`'s Slack mode and `playground dm send`                            |
| Merge a Playground PR, or release `canary` to `main`                                                      | the **gate** rule (`bun run pr:merge <n>`, `bun run pr:train`) and **release** |
| Comment or review on one of the owner's repos                                                             | the **comments** rule                                                          |
| Touch the live dashboard or the roster                                                                    | the **dashboard** and **roster** rules (`ROSTER.md`)                           |
| Ask the owner something, or pass on his override                                                          | the **ask** and **override** rules                                             |
| File a Linear ticket                                                                                      | the **tickets** rule                                                           |
| Write anything an org sees                                                                                | the **classified** rule                                                        |
| Post in the factory's channel, or take an ask from there                                                  | the **channel** rule (`CHANNEL.md`)                                            |
| Stop a process                                                                                            | the **signal** rule                                                            |
| Hand off a build, a read or research                                                                      | the **workers** rule                                                           |
| Run long, spawn a reviewer again, or wait on something                                                    | the **context**, **rounds** and **polling** rules                              |
| Write a skill, an agent guide, a docs page, a handoff or a brief                                          | the **writing** rule                                                           |

A factory session reaches for it on its own, and every brief tells the new session to load it.
A session outside the factory has no reason to.

## How it is laid out

`SKILL.md` is the part every session keeps in view: the roles, the chain, and under **Standing rules** a pointer to where the rules live, short enough to fit inside what Claude Code re-attaches after a compaction (its first 5,000 tokens, within a budget that can drop an older skill whole).
Each rule is its own intent file, `extensions/core/rules/<name>.md`: its first line is the glance, the lines after it its what and why, with each value a `{key}` slot.
A rule that belongs to the owner alone (**zerosdk**) sits in its scope's own `skills/<scope>/rules/` until the switch imports it into the extensions, and keeps its glance line in `SKILL.md` until then.
The lifecycle, dispatch and sweep are in `LIFECYCLE.md`, `DISPATCH.md` and `SWEEP.md`, each read when its moment comes.
At every session start, resume and compaction the `rules` hook puts each rule file's glance in front of the session, its slots filled with this machine's settings (`playground rules <name>` prints one whole), and after a compaction a second hook tells it to load the skill again, so the rules arrive even when the skill was dropped.
A test holds `SKILL.md` under 14,000 characters, its pointer to the rules folder, and its glance lines to the rules that wait in a scope's own folder.

## The shape

The dispatcher keeps the owner's conversation and the Inbox, and routes each task by role: a new ask goes from the dispatcher to the Planner, which researches it, orders it and writes the plan, and stays free for the next ask, since its research goes to read-only research workers;
then to the Builder, whose workers build, review and merge it; then to Ops, which ships it, rolls the dashboard and watches the machine.
The Optimizer runs retros over everything the factory did and routes each lesson to the dispatcher as a fix, parking later ideas in its icebox, and never builds.
Each manager is found by what it does, its kind (the builder, ops, the planner and the optimizer), not by a fixed name, so a manager started again under a new name gets its reports, its alerts and the Dashboard's place for it at once:
`roster.ts who builder` prints whoever holds the builder's seat, and every script, hook and Dashboard read that looks for a manager follows the same rule, falling back to today's names.
Four routes skip the planner, which hears after: two fast lanes (a live break or a tiny fix the owner points at, straight to the Builder; a machine or ops incident, straight to Ops), a backlog fix a free slot takes, and a task the owner calls priority.
An org's work skips it too and stays outside the planner's lanes.
As it routes an ask, the dispatcher routes it to a thread of its own, so the Dashboard can show his chat grouped by what he asked: a message that opens with a thread's marker, `[thread:<id>]`, routes there as it is read, so the dispatcher opens each reply and update about that ask with the same marker and asks a peer to open its report with it,
and an ask with no marker gets a thread through `playground thread` (each Inbox item about it goes to the same one).
Work goes out in bundles: the Planner groups the issues that touch one surface, such as the sidebar or the chat, into one bundle, and a bundle is one worker, one PR, one review loop and one tester pass per head, its tester driving only the pages and files the bundle touches.
Two pieces of work that depend on each other in meaning stack only for no line overlap: the test is a merge-tree of the two heads against the parent's merge base with canary, and the child holds behind its parent until the parent merges.
Anything else bundles into one PR or sequences one PR after the other.
A worker is spawned for one chore and ends when the chore is done, so the room it held fills again as work finishes: a fix for live breakage or security first, then a queued org ticket, else the next item of the planner's first lane with no worker, where his own asks sit ahead of the chores the factory proposed.
Before a lead spawns a worker it reads the machine's room, the Dashboard's System panel through `bun run verify system`, so the factory grows as far as the Mac allows, counting every membership rather than holding for usage.
Every factory session starts through one script, `scripts/spawn.sh`, which refuses when the machine has no room for it (its gate reads the load and the processor's busy cores against the cores, memory pressure and the model's usage windows, and names the reading that failed), or a live session already holds the name it would start;
it counts no sessions, so Ops watches the live board, since cmux once stopped answering at 49 live sessions and load 97; a hook turns back a session started any other way; a worker runs its dev stack only while it tests.
A heavy run, such as a suite, takes one of a few run slots and gives it back when it ends, so nothing long-lived holds one.
Nobody builds a demo stack for the owner: he tries changes on the live dashboard alone (the owner: "I won't be trying it.
I will only be trying Dashboard Playground.").
A runner hosts long-running jobs and closes when none is left; the ops jobs Ops runs are scripts with no session and show on the Dashboard under Runners from the heartbeat each writes.
One of them, ops-unstick, reads every session's screen every 2 minutes, clears a usage-limit dialog when there is room, takes one with no room to the builder and the dispatcher (a probe's to its spawner), and takes any other block no hook recorded to the session's manager,
as the session-state hook does for one it did,
and the Dashboard shows each one it finds as Stuck, with a red alarm, or as Paused · usage limit, with gray pause bars, when the usage limit alone holds it.
Another, ops-loom-relay, passes Claude Code's usage on to the org's Loom as counts alone once the usage export points at it rather than straight at Loom, so no skill, agent, tool or subagent name leaves the Mac, with no prompt, summary or other text, and every login's usage on the Mac under the one login its settings name,
each person's own.
A worker spawns its own reviewer and tester, each briefed from a template it fills in, and the Dashboard nests them under it; the reviewer scores the PR through [code-review-loop](./code-review-loop.md).
A probe lives for one test and never waits on the owner.
The dispatcher, the Planner and the two leads never close, except to be started again with their settings after a cmux restore or from a handoff once their guidance changes; they compact their own context in one 400k window (`autoCompactWindow` 400000) and keep their surface and name.

In cmux, sessions that work together share a workspace as full-height columns side by side, never wrapped into a grid: the four managers (the dispatcher, the Planner, the Builder, Ops) share a `Managers` workspace, and each worker has one of its own that reads worker | reviewer | tester, with any probe of its chore beside them.
A session ends when the one it reports to closes its column, never the others; the last one left goes with the workspace, since cmux will not close a workspace's last surface.
A finished worker, reviewer or tester also ends by itself: right after its PR merges, and from a check every 5 minutes, while one with work left unsaved stays open and its lead gets a `Not ended` line saying why.
Sessions already running move at their next restart, so nothing is closed just to re-arrange it.

The leads keep watch with a sweep: every 15 minutes each one runs `playground sweep`, which prints only what changed since its last sweep (new alerts, the merge queue, the load, ETAs that have passed, and for Ops, once an hour, each ops switch still on with its reason) or `quiet`,
and on news it checks its own agents for a picker waiting, a permission prompt, silence with no report, or a session gone, and acts on it.
A stuck session tells its manager at once: the manager allows a permission prompt when the command is needed and otherwise denies it with a simpler way to do it (`playground picker`), and a session still stuck after 5 minutes goes to Playground; what only the owner can answer becomes a decision in Playground's Inbox, since he reads the Inbox rather than every chat.
A worker silent for an hour after a review round, with no push and no report, is asked why, and a bug it found outside its chore becomes an issue of its own at once rather than a detour, unless it blocks the PR.
The Builder also chases any open PR of the factory's that has seen no commit, verdict or comment for 30 minutes and is truly stuck, not just waiting its turn on merge-on-ready.
An ops job reminds the poster of every answer of the owner's in the Inbox that its poster has not confirmed within 15 minutes, whether it failed to reach the session or reached it and was never carried out, and a lead hears only when that poster is down, so an answer he gave is never left undone.
An agent confirms a go only with a link to where it landed (the Slack message, the pull request, the Linear ticket) or a reason there is none, and every draft or decision that will post somewhere names that place before he answers.
No factory session blocks on him: one that posted a decision carries on or ends its turn, and reads Waiting on your inbox, in orange, until he answers; Playground itself is always free, running nothing long and waiting on nothing.

## Tickets

A new Linear ticket waits for the owner's yes, and Playground's own work stays out of Linear, tracked in the roster (the Dashboard's status table and Next up), the login's `doc plan-<slug>` items and GitHub.
A session that needs a ticket asks up the chain; the dispatcher puts it to the owner as an Inbox decision, and on his yes writes that day's approval naming the team and title, which lets the ticket be filed.
Every spawn sets `PLAYGROUND_ROLE` (a session cmux restores without it is known by its name), and in a session that has it the `no-linear-ticket` hook refuses any call that would file a ticket with no approval, through the Linear MCP or a GraphQL `issueCreate` alike.
His own sessions have no role, so they file freely.
The hook is a guard, not a lock: when it cannot start (Bun missing, the checkout moved) or times out, Claude Code lets the call through, so a broken hook never blocks every call, and the rule still binds the session.
Only the dispatcher writes an approval, and the hook refuses any other session a write into the approvals folder.
Playground is classified: nothing about it appears in any guarded org's ticket, PR, commit, branch, comment, Slack message or DM, and file in its repos.

## Classified

Playground is classified.
Nothing about it, the factory or its sessions goes into any guarded org's ticket, PR, commit, branch, comment, Slack message or DM, and file in its repos.
Every session is spawned with the factory's own settings file, which `scripts/link-skills.sh` installs at `~/.playground/factory-settings.json` without touching your own settings, so its `no-playground-leak` hook runs wherever the session works, in a guarded org's checkout too.
cmux drops that file when it restores a session after a restart, so Playground's own project settings carry the hook as well, and a session restored where its folder's settings lack the hook is started again with the file.
The hook refuses a Linear or Slack write, a write to a guarded org's repository through gh, git, curl or the GitHub MCP, and a commit or push in its checkout, when its text names Playground, one of its skills, a session by the name the roster gives it or an older one such as `worker-envy`, the roster, the live dashboard or `~/.playground`.
The fixed names are one list, the leak hook's terms file in `scripts/hooks/`, and every skill folder under `skills/` and every agent's name in the roster join them, so a new skill or a renamed session is covered at once.
The guarded org's own name always passes.
Plain words such as "dashboard", "worker" or "envy" pass, so an org's work is not blocked by everyday language, and the refusal names the term it found so the session can rephrase.
Writes to Playground's own repo pass, and so do Slack posts made through the Slack MCP's chat tools in the conversations the owner cleared for talk about Playground:
the factory's channel the owner shares with a colleague and the direct messages listed in `extensions/core/lists/slack-cleared.json`.
The channel is where the owner's and the colleague's Playgrounds talk:
a post there speaks as Playground and ends with an italic _Sent via Playground_, since it goes out through the owner's Slack account, and the hook refuses a Slack MCP chat post there without it, and refuses any curl write that names the channel.
Its links go as link chips: rich text of plain words and links alone, each link labelled with its address and shortened, ending in the italic signature, and the hook refuses any other rich content there.
An observer in the channel is answered directly when they write there.
The dispatcher sorts each ask from the colleague, their Playground or the observer into three: it answers it, fixes a small shared bug and tells the owner after, or puts it to the owner first, and the owner's asks always come first (`CHANNEL.md` beside the skill).
A simple, working PR from the colleague is the dispatcher's to decide and record, and it merges as their own PR after a read-only review, so their name stays on the work; only a hard-to-undo change to how the owner works goes to the owner's Inbox.
The hook also refuses a guarded org's write it cannot read.
Like the ticket guard, a hook that cannot start lets the call through, and the rule still binds the session.

## It's working if

- Every session in the dashboard sidebar has a roster entry with a task, and every finished worker shows `ended` and is closed, its checkers with it, once its chore is done.
- Research and plans run in the Planner and its research workers, building in the Builder's workers, ops in Ops' runners and jobs; the dispatcher runs none of them.
- Each open Playground PR is one bundle, a fast-lane fix, or a priority of the owner's that could not wait for its bundle.
- cmux shows one `Managers` workspace and one workspace per live worker, with no checker or probe in a workspace of its own.
- Every working worker's ETA shows on its sidebar row's hover, and few have passed it.
- No agent sits on a prompt or a picker for longer than one sweep, unless the picker waits on the owner in its own pane.
- No session waits on a prompt for a delete Claude Code stops on: an `rm` or `rmdir` whose target has two or more parts that start with an unguarded variable, or a name directly in `/`, is turned back with a fix (the `no-prompt-stop` hook), and the session runs it again guarded, as a literal path, or in its own temporary folder.
- A manager starts no hidden helper: the `no-manager-subagent` hook refuses it the Agent and Workflow tools, so every build, read or research it hands off shows as a worker in the sidebar.
- A heavy run in a worktree (an install, a `node_modules` copy, a build, a type check or the whole test suite) waits for a free run slot, so the machine runs a few at a time: the `no-unslotted-run` hook refuses one typed without `run-slot.sh`, naming the form to use.
- No factory session starts unless the machine has room: `scripts/spawn.sh` refuses while the load and the busy cores are both at the core count, while memory pressure is critical or free memory is under 8%, or while the model's usage window is near its cap, naming what it read, and when a live session already holds the name, so a respawned session starts only once the old one has closed,
  and the `no-raw-spawn` hook refuses a session not started through it.
  A session started with `--account <email>` runs on that account, and its token shows in no command, message or log.
  A worker started with `--backend glm` runs on Z.ai's GLM model in place of Claude, with its key kept just as safe, and keeps that model when it is resumed; a reviewer or tester always runs on Claude.
  A GLM session takes tiny mechanical work as well as docs, skill text, research reads and plan drafts, and stays on Playground's own work, an org's work staying on Claude.
  No guarded org's data reaches GLM: spawn.sh starts a session in a checkout of an org `ext.links` guards, or on a brief naming a word of the `glm-refused-sources` list, on Claude alone, and a job that reads an org's data starts its `claude` with GLM's settings cleared.
  For a smaller build task, Claude writes the plan and a GLM worker builds it: the plan names the files the worker may touch, the lead checks that list against the hook's refused paths, and anything outside it goes back before it is edited.
  GLM's unused credits lapse at each reset (`~/.playground/zai-usage.json`, the Usage app), so the lead pulls the next eligible item forward while GLM has room before the reset.
  A GLM session's commit or push that touches the app's pages, the factory's hooks, spawn.sh, the merge and verify scripts, the commit hooks or the CI workflows is refused by the `no-glm-heavy-path` hook, naming the files, so that work goes to a Claude worker.
  While the Mac's 5-minute load is over 15, the same hook also refuses a GLM session's installs, node_modules clones, commits and pushes, so it waits for the load to fall.
  A session resumed with `--brief <file>` starts by reading that brief; without one, its first prompt has it act on the after-resume hook's instruction, so it re-arms its background tasks and re-sends its unanswered messages.
  A resumed session restarts any dev stack it served and re-arms its watches, CronList before CronCreate, since the resume kept its crons and dropped its background tasks.
  The factory no longer moves sessions to GLM at 98% usage (retired on Inbox #i827): the account rotation moves it between Claude accounts in its place (`scripts/ops/usage/login-flip.py`).
- A session started with no `--runtime`, from any terminal, or with `--runtime herdr`, opens in herdr in place of cmux, in a pane labelled with its name, and its next resume opens there too.
  spawn.sh starts nothing in cmux: it refuses `--runtime cmux` and a column started beside a cmux surface, and a session that ran in cmux resumes in herdr.
  Claude's folder trust and MCP prompts are answered for it only under the code root (`paths.codeRoot`, else the folder that holds the main checkout) and `~/<org>` for each org `ext.links` guards; anywhere else it waits for the owner.
  A probe on a herdr server with no pane yet opens in a workspace of its own (`spawn.sh probe`), and when herdr refuses to open one, spawn.sh shows herdr's own reason.
  After a herdr server restarts, the factory's or the probes', its ops job runs `spawn.sh restore` for it, which brings back every herdr session that ran on that server and the roster has not ended, parked or paused, one that never got its first message included, on the account its start named, else the login with the most room, and the model it started with, and skips any still running.
  A factory session can only read from herdr: the `no-raw-spawn` hook refuses any herdr call that types into, closes or speaks for another pane, since herdr lets anything on the machine control it.
  The one exception is a scratch herdr server the session starts for a test, its socket in the session's own temporary folder, which it can drive through that socket alone, but never to start Claude.
  So a herdr session ends through `spawn.sh close <name>`, which closes only the pane spawn.sh opened under that name, never the caller's own, and marks the session ended on the roster.
  A live cmux session moves to herdr with `spawn.sh move <name>`: it skips the memory and load checks, since the copy it closes frees what the new one takes, keeps the usage check, closes the cmux surface only after every check passes, and resumes the session in herdr once the old process has exited.
- A new session's name reads like `k3m9px-worker`: a new 6-letter id, then what the session is, so no name is ever used twice, and its checkers get ids of their own, as `b7k2mq-reviewer` and `h4n8zt-tester`.
- Every session starts at high effort; another effort is the owner's choice alone, which a lead sets with spawn.sh's `--effort` at a start or a resume, on the owner's word relayed in the **override** shape.
- Every session runs on `models.default` (Opus) unless it was started on GLM or with spawn.sh's `--model` naming another of `models.claude`, and every subagent it starts for work runs on Sonnet unless its call names a model,
  from the factory settings' `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` (the owner approved #i492, 17 Oct; on GLM the alias maps to GLM), so a brief or subagent call that needs Opus names `model: opus`.
- A suggestion, from anyone, is tested before a session acts on it or repeats it.
- No worker is spawned while the System panel reads No room, and the panel's idle line stays empty: no worker's dev stack idles 15 minutes.
- Of the choices the factory could make itself, only the one-way doors reach the owner's Inbox as decisions: a Slack message to anyone but a developer (a collaborator writing code in an org's repo, about that work), a new ticket, an irreversible delete or another breaking change, a breaking schema change, an org's database change on one environment, and budget.
  A production bug's port, a request for work from a session outside the chain and a step only he can take (plug in the Mac, log in, add a key; Approve means done and Deny means he can't, and a secret value he holds goes to a Vercel project through a secret ask, whose card hands it straight to its sink, or anywhere else where the item says, 1Password or a file,
  never into chat or a stored row) go to him as a plain ask, its words saying exactly what Approve does,
  and ships to `main` run on his standing yes.
  Every two-way door, a design, an order or the scope inside an ask he approved, the factory picks itself and records in an ADR or on the issue, and a grilling sends him only the questions nothing in the repo or his past words settles, batched as one plain ask.
- No decision reaches the owner as a question in chat.
  The inbox gate, a hook on Playground and the leads, refuses to end a turn whose last reply asks him to decide (any question mark outside code, quotes and lines to other agents, rhetorical ones and headings included, or words such as "say yes", "your call" or "should I") until that reply names an item open in his Inbox, so the session names the one already open on the same thing,
  or else posts it there and says so; a pointer he is free to skip ("if you want to look") is no ask.
  It refuses a request for his own action the same way, such as "you need to", "please", "when you can" or "the owner, plug in the Mac", so a step only he can take goes to his Inbox too.
  A question quoted from someone else, or put to another agent, passes.
  Anything promised to him for later, and any later outcome of something he asked, reaches him as an Inbox update; chat answers only what he is asking now.
- Every Slack link in the Inbox opens in Slack's app: `playground ask` refuses an archives-style link, and triage-and-implement's `scripts/slack-links.py` rewrites one from the org's workspace (another workspace's is named on stderr, left as it is).
- Every mention in the Inbox reads as a name (@colleague, @platform-team): `playground ask` refuses Slack's raw tokens (`<@U...>`, `<!subteam^...>`, `<#C...>`, `<!here>`), and the poster resolves each name to its ID when it posts.
- An ask that has the owner quit, restart, close or stop something says what still depends on it (the owner: "You asked me, and the factory asked me, to quit cmux and then the app was not working.
  Relay the information"): `playground ask` refuses it until it carries `checked`, one line from four checks (the ops jobs, the processes and sessions running under the target, and the Dashboard's health), `none` when nothing does.
- An ask leads with a picture of the point (a diff or an ASCII flow; before and after pictures once the Inbox takes them), then short bullets, then what Approve does.
  `playground ask example` prints a template for each, and `playground ask new` posts a wall of prose or a too-wide code line with a hint on how to shape it.
- Each decision is one Inbox item, with its sub-choices inside it, and a changed plan closes its old item before the new one goes up.
- Every session compacts itself in one 400k window, GLM's included, which spawn.sh sets on every start and resume (Inbox #i706), with a summary shaped by AGENTS.md's Compact Instructions.
  It keeps its surface and name; after a compaction it gets the glance lines from a hook, loads the factory skill again, and rereads its roster entry, its open Inbox items, its PRs and the register of settled decisions before it acts.
  A session spawn.sh did not start, the owner's own in a Playground checkout included, compacts at the settings files' 400k.
- Each PR has one reviewer session across all its rounds, and from round 2 it reads only what changed since its last score, plus the findings still open.
- Leads wait on a message, a background task's notification, their sweep or an ops job, rather than a `sleep` loop or a repeated `gh` read.
- A changed draft reaches the owner through its Inbox item, never as a second Slack draft for an item he has already sent.
- No session polls a PR more often than every 5 minutes, and reads and comment posts go through GitHub's REST API where they can, so the shared GraphQL quota lasts the hour; a sweep over many PRs is the exception, one batched GraphQL query ([GITHUB-BULK-READS.md](../../extensions/core/skills/playbook/GITHUB-BULK-READS.md)).
- No session writes Claude Code memory: every learning arrives as a PR to this repo.
- Every skill, agent guide, docs page, handoff and brief a session writes reads as writing-for-agents shapes it: lean, each step ending on a completion criterion, phrased as what to do, a hook turns back a factory session's write to one until it has loaded the skill,
  and the reviewer scores the changed ones against it.
- After each of the owner's meetings, Playground reads its transcript from Wispr Flow on this Mac (`bun run wispr:latest`) and acts on the follow-ups, so he never pastes one by hand, and no transcript text leaves Playground's own chat and the Dashboard's local tables for Slack, Linear, GitHub, Notion or another session.
- No brief agrees in advance to raising a ratchet, or loosening any check whose own rule says it never rises: that call goes to the rule's owner, on the PR or directly, before the code relies on it.
- Every Linear ticket a factory session files traces to an Inbox decision the owner approved, and none names Playground.
- No guarded org's ticket, PR, commit, branch, comment or Slack message names Playground, a lead, a factory session or the live dashboard.
- Every Playground PR merges through `bun run pr:merge <n>` or merge-on-ready (`bun run pr:train ready`), so none lands unless the repo's owner opened it (an outside author's only on the Builder's word, with `--outside-author <login>`), nor while Ops' held list names it,
  nor while a merge of `canary` inside it dropped lines `canary` added (the `keeps canary` gate in [pr-merge's README](../../packages/scripts/src/pr-merge/README.md); a factory hook also refuses `-s ours` and `-X ours`),
  nor without a 5/5 and GitHub's `Audit, Lint, and Build` and `test` checks green at its head, with GitGuardian's among the checks.
  A merge of `canary` makes a new head, which needs its own checks and 5/5.
  Merges go one at a time, under the factory's merge lock, which pr:merge takes itself.
  A wrong refusal goes to the Builder, the only one who merges by hand, on an override.
- A lead that overrules a reviewer's FAIL says so on the PR, in one `Lead ruling:` line with the evidence and the issue the fault moved to, so the next reviewer reads the FAIL as settled; the merge still waits for a fresh verdict at the head, or the Builder's merge by hand.
- No session but the dashboard's runner restarts the live dashboard.
- No session, and no fork or sub-agent one runs, stops a process it did not start: the **signal** rule.
  The one handover is a dev stack whose starting session has gone, which `bun run dev:stop` ends in its worktree from the launcher's own record, never the live dashboard's without `--live-dashboard`.
  CI checks that nothing in the repo kills by name, pattern or port; a command a session types is the rule's to hold.
- No session builds, tests, commits or writes a file in the main checkout, which every installed skill follows: the **main** rule.
  A hook refuses each of those there, naming the fix, while its upkeep (a pull, a fetch, rebuilding the shared packages with env validation off after a pull that changes them, relinking the skills) and reads run.
- Nothing types into another session's pane in the owner's name: sessions and ops alerts reach a session through `SendMessage` (the **voice** rule), and the dashboard types only for his own clicks.
  A test fails on any other caller of the dashboard's `deliver()` and on any text in the repo that types into a pane, Escape on the usage-limit dialog and a manager's `playground picker` on a permission prompt aside.
- A page for the owner (a report, a comparison, a mock, a diagram) is a local HTML file in the session's scratchpad, kept and opened in his browser with `playground page` (the **local page** rule), since a claude.ai artifact publishes under whichever account the session holds; it then stays on the Pages tab of the session's view, of the one it was made for and of the dispatcher's.
  Every page's header shows its version, "Version N · <date> · <kind>", always, and a copy made to share outside drops the label.
  The factory's settings deny the `Artifact` tool, and a test fails without the deny.

## Where it fits

The rules every other session runs under.
The dashboard app ([AGENTS.md's dashboard section](../../AGENTS.md#the-dashboard-app)) shows the live sessions and holds the Inbox the owner answers ([.agents/dashboard/asks.md](../../.agents/dashboard/asks.md)).
A PR built under it follows AGENTS.md's "Shipping a Playground PR".
