# Lifecycle

When each kind of factory session starts and ends, what the Dashboard shows for each role, and the ops jobs that run with no session.
The commands for each start and end are in [SESSIONS.md](SESSIONS.md), and every start and end lands in the roster ([ROSTER.md](ROSTER.md)).

## Roles on the Dashboard

The dashboard lists the dispatcher and dispatcher-2 in the sidebar's header, above the session groups, lists the Planner and both leads under Orchestrators, A to Z by roster title or in the order the owner dragged them into,
nests each checker under the worker whose PR it checks (by the `worker` key on the checker's roster entry, set at spawn, else its `pr`, else its name: `reviewer-sloth-2-sendtop` under `worker-sloth-2`),
and puts probes in Other, where they never wait on the owner.
Each row reads by a plain name with no @: a manager by its role word alone (Builder, Ops, Planner, Optimizer), a worker by its ticket and pull request with no role word (`ENG-1591#1598`), else its title, and a reviewer,
tester or runner the same way with its role word after (`ENG-1591#1598 Reviewer`, `Keep the dashboard up · runner`).
A new session is named `<id>-<kind>` by `bun run name <kind>`, a checker with an id of its own ([SESSIONS.md](SESSIONS.md#spawn)); one started before keeps the name it has.
A worker's dev stack runs only while it tests: it stops the stack through its own background task once a round of testing ends, and starts it again for the next; anything that must outlive a chore gets a runner.
No session builds or holds a demo stack for the owner (the owner, 9 Oct: "I won't be trying it.
I will only be trying Dashboard Playground."): what he should try reaches him on the live dashboard once it merges into canary, and a tester's stack serves its tests alone.
A **preview worker** holds a combined preview worktree, canary plus the lane heads, so several changes can be checked together before they merge; it is a worktree for diffs, not a demo stack, and serves no one an app.
After every lane push it rebuilds the combination: from `<acc>` = `origin/canary`, for each lane head `h` in turn it takes `tree=$(git merge-tree --write-tree <acc> <h>)`, stopping when that exits 1, a conflict between the lanes, and sets `<acc>` to `$(git commit-tree $tree -p <acc> -p <h> -m preview)`.
It is done when `git diff --stat <acc> HEAD` in the preview worktree reads empty.
When it shows a diff, the hand merge drifted: move the worktree to the rebuilt one with `git -C <preview> checkout --detach <acc>`.
When the stop at a conflict fired, run `git merge-tree --write-tree origin/canary <h>`: a conflict there means lane `h` is behind canary, and its worker merges `canary`; otherwise `h` conflicts with an earlier lane, so tell both lanes' workers and leave `h` out of the preview.

## Starts and ends

The factory's sessions start and end as its work needs them; none of that waits on the owner (a request from outside the chain is the one exception, under [DISPATCH.md](DISPATCH.md)).
Sessions that work together share a workspace as full-height columns ([SESSIONS.md](SESSIONS.md#spawn)): the managers one (the dispatcher, the Planner, the Builder, Ops), and each worker its own, with its checkers and probes beside it.

- **Workers** are spawned by the Builder, one per chore, and close with their checkers once their chore is done.
  A worker ends when its chore is done: its PR merged (or dropped with the Builder's ok), its branch pushed (`git push -u origin <branch>`), so its commits show on origin even with no PR,
  its worktrees, branches, containers and probes cleaned up from the main checkout (`cd` there before `git worktree remove`, since the session sits inside its own last worktree: the one `cd` a worker runs), and its final report sent, naming the pushed head.
  Remove a worktree another session holds only once that session is closed or off the roster and no live session's cwd is inside it: a clean tree is not a free tree, since a reviewer keeps its worktree across PRs (**rounds**).
  The Builder then closes its workspace, which takes any split still open in it, and its slot returns to the pool.
  Ending is automatic, by [SESSIONS.md](SESSIONS.md#end)'s path: `pr:merge` and the train's land end the merged PR's worker, reviewer and tester, and ops-tick's auto-end beat ends the rest every 5 minutes, each with one line to its lead.
  The Builder closes a session by hand only on a `Not ended` line, whose reason names what to fix first.
  The Builder may also end a worker mid-chore to drop or reassign the chore, recording why.
  A parked chore gets its branch pushed (`git push -u origin <branch>`) and a handoff note ([SESSIONS.md](SESSIONS.md#write-a-handoff)), `~/.playground/handoffs/<ID>.md`, and its worker closes, its final report naming the pushed head; the chore restarts later from the note, its branch and its PR.
- **Runners** belong to Ops.
  A long-running job joins an open runner; Ops spawns a runner when none is open, or another one for isolation or load.
  Each job runs as its own background task with its own log and health check, all listed in that runner's roster task.
  Ops closes a runner once it holds no job that is still needed.
- **Ops jobs** Ops runs as scripts with no session (ops-awake, ops-changelog, ops-dashboard, ops-flow, ops-herdr, ops-channel-watch, ops-loom-relay, ops-machine, ops-merge-train, ops-report, ops-session-resume, ops-sweep, ops-tick, ops-unstick, ops-zai-usage) beat a heartbeat, `~/.playground/ops/<job>.json`,
  named `ops-*.json` so the Dashboard finds a new job by its file alone,
  in the shape `heartbeatSchema` in `api/hono/src/lib/dashboard/ops.ts` reads (`job`, `pid`, `startedAt`, `lastBeatAt`, `lastResult`, `cycleSeconds`), written atomically each beat by a loop that does not wait on the work.
  The Dashboard lists each under Scripts, by its plain name and its `jobs.json` `schedule`: Running while `lastResult` is `ok` and the beat is within three cycles, Waiting while it starts `waiting: ` (a job with nothing to read yet, muted and not broken), Failing on any other result, Down once the beat goes stale, the pid goes or the loop writes `loop exited <code>` or `supervisor exited`.
  ops-dashboard runs the dashboard checkout's own `scripts/ops/dashboard/`, swapping onto it in the same pid at each start and after a roll that changes it (`.agents/dashboard/live.md`).
  ops-merge-train is merge-on-ready, a job and never a worker: every 60 seconds it reads the open PRs' heads and checks, and on any change runs `bun run pr:train ready`, which merges the first PR in queue order whose every gate passes; its beat's `lastResult` is `ok` or the command that failed and why.
  ops-unstick (`scripts/ops/unstick/run.py`) watches for stuck sessions, by the **unstick** rule.
  ops-session-resume is `bun run ops:session-resume` in a checkout of `canary`: every 60 seconds it reads the state each session's hooks write (`session-state/<session id>.json` in the data folder),
  and to each live factory session (never a probe, nor one of the owner's own) at its usage limit whose reset passed a minute ago, unless Claude Code announced it carries on by itself (the **unstick** rule),
  it queues one resume line in the ops outbox, which the relay sends with `SendMessage` (**voice**), and one carry-on line to each such session whose turn a restart lost (its newest state `working`, written before its process started, 2 minutes on, with no Escape after it in the transcript),
  and one to each such session whose state reads `failed` on an API error, alerting its lead and the dispatcher once when a later pass finds the same record still standing or a new failure follows its line within 30 minutes;
  it tells the dispatcher of a live session still `stuck` once the `unstick.escalateMinutes` setting's minutes pass (5 by default, read at each pass), and a live session's manager of one reading `working` with no transcript write for 15 minutes (**unstick**); `--once` runs one cycle with no beat.
  ops-sweep is `bun --no-env-file <dashboard checkout>/packages/scripts/src/ops-sweep/cli.ts no-headroom`, its `jobs.json` command naming the script by its absolute path so `up.py` keys it by its folder (each word after `cli.ts` a finding known at start and never told):
  every 300 seconds it brings up any ops job that is down, then reads the runners (a parked one is never down), the probes, the managers' asks, the unclosed answers (`bun run ask stale`), the heartbeats and the usage forecast,
  and the `playground-*` databases (and the older-named ones) idle 2 hours with no client (never the dashboard's own, found by `POSTGRES_URL`'s port, nor a Checks lane's `playground-chk-<k>-db` while a run holds `ops/checks/lane-chk-<k>.lock`, whose idle clock starts again after), telling ops each finding once, while it is new, and keeping its state in `ops/sweep/` in the state folder.
  ops-tick is `bun run ops:tick` in a checkout of `canary`: the factory's timed beats, each at its old cron in machine wall time with no model call, running the same script as before and queueing what it prints in the ops outbox for the seat or session it went to before, through `scripts/ops/notify.sh`, silent when nothing prints:
  the roll gate, the tick (usage marks, a `switch due`, load, the train's slot wait, near-limit marks, and the switch watch, which at a full week writes ops-unstick's move file and tells both dispatchers and both leads), the usage-limit watch (each session on the usage-limit screen named to the builder once with its account, and the lowest-week account with its 5-hour window under 90% to move to),
  the auto-end beat every 5 minutes (`scripts/ops/optimizer/auto_end.ts` over `idle_sessions.ts`'s flags, [SESSIONS.md](SESSIONS.md#end)), each end or `Not ended` line to the session's lead, a `Not ended` line once until its words change,
  ops-up every 5 minutes (`scripts/ops/up.py`, each line it prints told to ops once until it changes, so a reboot or a quit cmux brings every job back with no hand step, and its warning that a job runs outside cmux while cmux holds a factory session also shown as a macOS banner once per holder),
  the sweep (each felled session to its lead once, never a probe or one the roster holds parked, paused, ended or starting, but runner-plain-relay, the relay itself, whose resume line it runs through spawn.sh's capacity gate at every sweep that prints it, with `--brief brief-runner-plain-relay.md` so the relay starts its wait task again,
  never marked told since a resume keeps the session id and the line returns with the next outage,
  rather than queueing it for a relay that is down, naming the outcome to ops, and load past 30 once a crossing), the GLM credits log line, the optimizer's wake words,
  the canary pull (every clean worktree on `canary` fast-forwarded to origin's head every 5 minutes,
  then installed through run-slot when the pull changed `bun.lock` or a `package.json` and again each beat until one exits 0, a failed pull or install told to ops once until its words change),
  the turbo prune (weekly, each file in the shared turbo cache `~/.cache/turbo/playground` last modified over 7 days ago removed, one line to `ops/log/turbo-prune.log`),
  the dashboard watch (every minute: once the live dashboard's `/api/health` has failed 5 minutes in a row, a gap of over 2 minutes with no check starting the count again, one macOS banner and one ops line through `notify.sh` with `NOTIFY_MAC=1`, since the Inbox shows only on the dashboard, and one more when it answers again,
  its state in `ops/tick/dashboard-watch.json`) and the relay watch (every 5 minutes:
  a line the relay would send, read by ops-outbox's `pending()`, is timed from the first cycle it reads pending, and once it has waited 10 minutes with no relay cursor moved since, one Inbox alert update is posted straight to the dashboard with `bun run ask new` under the ops manager's name, and resolved with `bun run ask resolve` once a cursor moves or its item is gone);
  `--dry` prints each beat's next due time and target, and `--once <beat>` runs one beat now.
  The relay, runner-plain-relay, sends every line `outbox/relay.py` prints to its `to`, since relay.py applies quiet mode before it prints; only the drops the relay's brief names hold a line back.
  ops-flow is `bun run ops:flow` in a checkout of `canary`: every 60 seconds it reads the process table and each run-slot `.holder`,
  and queues one line each for the builder and ops seats (`roster.ts who`) in the ops outbox when one session has held a run slot for 15 minutes, naming the holder, its command and its age; each hold alerts once, again only after it clears and comes back, and it signals nothing; `--once` runs one cycle with no beat.
  ops-loom-relay is `bun run loom-relay`: once Claude Code's usage export (`OTEL_EXPORTER_OTLP_ENDPOINT`) and Loom's transcript backfill (`LOOM_COLLECTOR_URL`) point at it on 127.0.0.1, in place of Loom's own setup script, which sends straight to Loom,
  both reach the work org's Loom as usage alone, each body built from an allowlist once a fixed blocklist of known text, path and name keys is dropped,
  so no prompt, transcript, summary, path, or skill, agent, tool or subagent name leaves the machine, and every login's usage goes out under one login: `LOOM_RELAY_LOGIN`, required with no default, each person's own, with no other account's email, id or organisation, and usage on a model that is not Claude's (a GLM session's) dropped whole, since Loom counts Claude usage;
  it sums the backfill's rows per day and model in memory, since Loom replaces a backfill row, so the backfill runs over the whole machine (no `--only` or `--exclude`), and again the same way when the relay restarts during one; it reads Loom's token from the Keychain (service `loom-ingest`) and beats its own heartbeat (`--help` has the rest).
  ops-ext-sync is `bun run ops:ext-sync`, off until its registry setting `jobs.opsExtSync` is enabled (`packages/settings/src/jobs.ts`).
  At 02:30 machine time it syncs each scope's clone in the data folder's `extensions/` with its private repository, `<login>/playground-<scope>` unless the setting `ext.repos` names another: a pull with rebase, then a push, so every machine's commits meet in one history.
  It scans every file with the extensions' secret shapes and the history with gitleaks when installed, and pushes only when clean; a public repository is refused, a scope with no repository stays on the machine, a refusal or failure goes to ops naming the scope, the file and the kind of secret, never its text, and `--once [<scope>]` runs one sync.
  ops-zai-usage is `bun run ops:zai-usage`: every 5 minutes it reads Z.ai's quota endpoint, writes `zai-usage.json`, the readings the GLM spawn gate reads, and beats its own heartbeat; `--once` runs one read and writes only `zai-usage.json`, no beat.
  Five jobs took over what runners held as background tasks, each `bun <checkout>/packages/scripts/src/<job>/cli.ts` with its script named by absolute path, so `up.py` keys it by its folder:
  ops-awake holds `caffeinate -s -i` by default, the system awake on AC power and on battery with the display free to sleep and lock (#i19); the repo job alone reads `ops-awake.json` in its data folder, so a machine whose file sets `"lidSleep": true` runs `caffeinate -i` after a restart, to sleep with its lid shut, while a launchd `awake/run.sh` keeps its own flags and reads no setting.
  Add ops-awake to `jobs.json` only on a Mac with no launchd `com.playground.ops-awake`, since both would post the same battery alerts; the repo job runs the battery check each minute (`ops-awake/battery.ts`), as a launchd `awake/run.sh` runs its own where it is installed.
  ops-awake and ops-machine write only under the data folder their `--data` names, which the jobs render passes; run with no `--data` from any checkout but the live dashboard's, each exits 2 before it writes.
  ops-changelog (`bun run changelog sync`, `4-59/5 * * * *`, skipped quietly while a `bun run changelog seed` runs) runs from the live dashboard's checkout, as its runner's cron did:
  skipped with a line to ops while load5 (the third field of `sysctl -n vm.loadavg`) passes 12 or memory pressure reads critical, never overlapping, its output appended to `dashboard-changelog.log` in the data folder, and a failure sent to ops with its last 5 lines.
  ops-channel-watch is the factory channel's watch: a quick pass every 3 minutes and a full one, which also relays edits, at minutes 7 and 37, each new post sent to the dispatcher as one outbox line; each pass runs `watch.ts` under `vault.py run -e SLACK_TOKEN=local.slack.channel_token`, so the token reaches only that process, and a failure goes to ops once per kind until a pass succeeds.
  Add ops-changelog this way only on a Mac whose `jobs.json` has no job by that name, and ops-channel-watch only on the Mac of the person whose Slack id `watch.ts` skips (`SKIP`).
  ops-herdr is `bun run ops:herdr` in the main checkout: every minute it starts each herdr server that is down, `playground` for every session and `playground-probes` for drills and upgrades (names of Playground's own, since herdr keeps each server's state and logs under `~/.config/herdr/sessions/<name>`), under `env -i` with HOME, LANG, LOGNAME, PATH, SHELL, TERM and USER alone,
  on the absolute path the repo's `packages/scripts/src/ops-herdr/pin.json` names, as launchd's child, so stopping the job leaves it running.
  It refuses to start a binary whose version or sha256 differs from the pin and beats the mismatch, naming both, and never restarts a running server, since a stop exits every pane.
  Once it has started a server, any of `PLAYGROUND_HERDR_SESSIONS` (`playground,playground-probes` by default; a name that is not a word is named on its beat and skipped), it runs `spawn.sh restore` (SESSIONS.md, Spawn) pointed at that server, which resumes the sessions whose records name it, and again each cycle until restore passes, its beat naming each session not restored;
  `<session>.restore` beside the server's socket marks a restore still owed, set as the server starts, so the job finishes one that `start` (`bun run dev`, the dispatcher) began, or gave up on at 10s, and the gate cut short; herdr's own resume stays off in the pinned config (`resume_agents_on_restore = false`), since it runs a bare `claude --resume` without the session's settings.
  It copies `config.toml` from beside the pin into `~/.playground/herdr/`, so both change only through a merged PR, and applies a changed config with `server reload-config`; it copies the pin there too, for the scripts that open herdr panes.
  Its `lastResult` names a pin mismatch, a server it could not start or read, and every config warning in the server's log since its last start or reload, since herdr falls back to a default with only a warning.
  Each server's socket is `$HOME/.playground/herdr/<session>.sock`, reached with `HERDR_SESSION`, `HERDR_SOCKET_PATH` and `HERDR_CONFIG_PATH` set (`--session` would ignore the socket path); its state and log stay in `~/.config/herdr/sessions/<session>/`, so the socket follows `$HOME` too, never `$CLAUDE_CONFIG_DIR`, and every Claude login reaches the same servers.
  `start` runs one check and exits (`bun run dev` on the live dashboard or an own clone runs the main checkout's, never the dashboard checkout's), `stop <session>` refuses while the session holds a pane and names each (`stop default` stops herdr's own default server on `~/.config/herdr/herdr.sock`, which no job starts, refusing only while one of its panes runs an agent),
  `attach <session>` opens a client on a running server with its environment alone (prefix `ctrl+alt+b`), refusing a binary off the pin or a server that is down, `status` prints one line a server (down, or up with the sessions its panes hold), and `env-check`, run inside a pane, prints its environment as names and lengths only.
- **The `playground` command** (`dispatcher` is its name from before the rename) is the owner's way in from his own terminal, linked into `~/.bun/bin` by `scripts/link-skills.sh`; `playground --help` and the docs site's `/docs/cli` give its words.
  Bare `dispatcher` first runs ops-herdr's `start`, so it brings back every herdr server that is down and names each it started; then, from any terminal while the Dashboard's API does not answer 200 on `/api/health` (portless's 404 for a stack that is down is no answer), it runs ops-up (`scripts/ops/up.py`), which starts each ops job that is not healthy,
  ops-dashboard's stack and follower among them,
  and stops a job's holder a cmux restart left outside cmux by its recorded pid; it starts no Claude session, and names a missing dispatcher for you to start.
  When up.py exits with its outside-cmux code (named in its docstring: the Dashboard's cmux job is down and the pass runs outside cmux), `dispatcher` stops right after up.py's "open a cmux terminal" line with a non-zero exit.
  Otherwise it waits for the Dashboard's API, printing a progress line every 10s, and stops with an error once ops-dashboard's supervisor is gone or its heartbeat is past three cycles (after a 30s grace for the start), else at 15 minutes (`waitOutcome` in `packages/scripts/src/playground/plan.ts`).
  A job's `runtime` in `~/.playground/ops/jobs.json` places it: `cmux` as a split in cmux's Ops workspace, `auto` in cmux while cmux holds a factory session and in herdr once it holds none (`cmux_held()` in up.py, read as the dashboard's cmuxHeldOf() reads it),
  so a quit cmux moves ops-dashboard to herdr on the next pass and a copy healthy in herdr moves back to cmux once cmux holds a factory session again, or `herdr` (the default for a job ops starts) as a pane labelled with its name in the Ops workspace on the factory herdr server, by the binary herdr's `pin.json` names,
  skipped while herdr fails spawn.sh's checks (its pin's sha256, its version, its server's socket and that server running);
  when it changes, the next pass stops the copy in the old runtime by its recorded pid and starts the job in the new one.
  A pass outside cmux (ops-tick, ops-sweep) skips a job placed in cmux, since cmux answers only its own terminals, and a start that fails is logged whole in `up.log` and tried again on the next pass, with no GRACE wait.
  A job moved to herdr keeps `needsCmux: true`, which is how the way back to cmux finds it.
  `playground add` starts one session through `spawn.sh` under all its gates, one start at a time (`~/.playground/spawn.lock`), under a name from `bun run name <kind>` or a given name that gives its kind, as spawn.sh asks.
  `playground view` runs ops-herdr's `attach factory`, opening the server the sessions run on, and takes no other word; probes stay on their own server.
  `playground update` touches ops-dashboard's `roll-now`, and `playground status` only reads, ops-herdr's `status` lines among its own.
  `playground sweep <lead>` reads what changed since that lead's last sweep and prints it, or `quiet`, writing only its cursor, `sweep/<lead>.json` in the data folder ([SWEEP.md](SWEEP.md)).
- **Probes** need the ok of their spawner's lead, open as a column in their spawner's workspace, and their spawner closes them by their surface the moment the test is done.
- **the dispatcher, the Planner, the Builder and Ops** stay open: they never close, except to be respawned with their settings after a cmux restore (below), to be resumed onto a new binary when Claude Code updates ([Updating Claude Code](#updating-claude-code)),
  or from a handoff ([SESSIONS.md](SESSIONS.md#write-a-handoff)) when their guidance changes (a rewritten brief or standing rule their running context contradicts, which the dispatcher names when it sends the change, or Ops when the change is to the dispatcher's own guidance):
  Ops respawns the dispatcher, the Planner and the Builder, the dispatcher respawns Ops, and no two managers restart at once, Ops first and alone when a change reaches it and another, and never as an Inbox item.
  The dispatcher spawns a manager under its fixed name when `ListAgents` lists none.
  A fresh the dispatcher session, after a cmux restart, reads the previous the dispatcher transcript and re-checks its open items against the roster and the managers before it answers the owner.
  A session resumed after any restart, an account switch included, re-arms its background tasks and re-sends its unanswered messages first, by the **context** rule ([rules/context.md](../../rules/context.md)), which the `after-resume` hook puts in front of it.
  No session reports Playground as running until its own `ListAgents` lists a session named `dispatcher`; a roster entry, a cmux record or a Dashboard row does not count.
  Ops' sweep has each factory session cmux restored without the factory's hooks respawned with its settings ([SWEEP.md](SWEEP.md)).

A Mac restart clears `/private/tmp`, so every scratchpad is lost.
Anything a session needs across a restart goes under `~/.playground/scratchpad/<name>/`, which the restart leaves alone.
After a restart, a PR body is pulled back with `gh pr view <n> --json body -q .body` before it is edited, so a stale local copy never overwrites the live one.

Every start and every end, with its reason, lands in the roster the moment it happens (**roster**).

## Updating Claude Code

Factory sessions and sessions started in this checkout update Claude Code only when someone runs the update: `DISABLE_AUTOUPDATER` in `scripts/factory-settings.json` and `.claude/settings.json` turns their background updates off ([Claude Code's setup docs](https://code.claude.com/docs/en/setup#disable-auto-updates)).
A Claude Code session elsewhere on this machine still updates in the background and replaces the one binary every factory session runs, so after any version change you did not run, start at step 1 and skip step 2.
An update deletes the binary every running session was started from, so each one is resumed onto the new one.
Ops runs an update when the owner asks for one:

1. List every running Claude Code process: `deleted` or `live` for its executable, its pid, its folder and its command line, whose `-n` names the session and whose `--resume` or `--session-id` value is what its resume takes.
   A line without `-n` is the owner's own session or a `claude` run outside the factory: tell him.
   A process that exits while the loop runs prints as `deleted`, and step 4's run settles it.

   ```sh
   ps -axo pid=,comm= | awk '$2 == "claude" {print $1}' | while read -r p; do
     f=$(lsof -a -p "$p" -d txt -Fn | sed -n 's/^n//p' | head -1)
     d=$(lsof -a -p "$p" -d cwd -Fn | sed -n 's/^n//p')
     [ -e "$f" ] && s=live || s=deleted
     echo "$s $p $d $(ps -o args= -p "$p")"
   done > "$LIST"
   ```

   **Done when** `$LIST`, a file in your scratchpad you set once, holds one line per `claude` pid.

2. Note what `claude --version` prints, then run `claude update`.
   **Done when** `claude --version` prints a newer version than the one you noted.
3. Resume each named session on the list onto the new binary, one at a time: close it by [SESSIONS.md](SESSIONS.md#end), then run its resume record, `bash ~/.playground/resume/<name>.sh`, which resumes it with the `--account` its start was given and the model it started with ([SESSIONS.md](SESSIONS.md#spawn) says how a resume picks a login).
   A session with no record resumes with `"${PLAYGROUND_REPO:?}/scripts/spawn.sh" resume <name> <folder> <session-id>`, adding the `--model` its line shows when it runs on Claude, and `--account` with the account it started on when that is a second account ([SESSIONS.md](SESSIONS.md#spawn)).
   The managers go in [Starts and ends](#starts-and-ends)'s order, Ops first: Ops sends the dispatcher the list's path and asks for its own resume, and once Ops runs again the dispatcher tells it to carry on at step 3.
   Ops also does dispatcher-2 and optimizer; the Builder does its workers, Ops its runners, each worker its checkers, each spawner its probes, and the owner his own; Ops sends `$LIST`'s path to each session that resumes others.
   A session that ended on its own since step 1, its roster row `ended` with a report saying why, stays ended.
   **Done when** every other named session on the list runs again under its name.
4. Run step 1's loop again, into a second file.
   **Done when** no line with `-n` reads `deleted`; each one that does goes back to step 3.
