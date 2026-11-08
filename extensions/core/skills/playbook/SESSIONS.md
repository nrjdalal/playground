# Sessions

The commands behind the factory's lifecycle, for the sessions it runs in herdr.
A session's place is its herdr pane, labelled with its name (Spawn); sessions that work together share a workspace, each in a pane of its own, so a command aimed at one session names its pane.
Sessions run in bypass-permissions mode, yet some commands still prompt (`rm`, an `sh -c` wrapper) and a subagent may not inherit bypass, so a session can sit waiting on a prompt.

## Spawn

1. Pick the name: `bun run name <kind>` in the Playground checkout prints a new one, `<id>-<kind>`, a 6-letter id that no roster entry, ended ones included, no registry file and no backend pin holds, then the session's kind, as `k3m9px-worker` (a reused name would bring back an old session's history, a bloated context).
   Every new session takes one, a checker with an id of its own: spawn.sh writes its worker into the roster's `worker` key, which nests it under that worker.
   spawn.sh takes lowercase words joined by hyphens that give the kind its mode names, as `<id>-<kind>` or an old `<kind>-<words>` (the Dashboard capitalises each word it can see, so `probe-anne-liaison`, never `probe-anneliaison`), and refuses a name that gives no kind or another (`k3m9px-reviewer` started as a worker).
   Give a worker its title with `--title "<title>"`: plain words of up to 40 characters saying what it does, which the sidebar shows in place of its first ask; spawn.sh refuses a worker without one.
   Keep it to 32 characters, so `Review: ` before it still fits the roster's 40.
   A checker takes `Review: <worker's title>` or `Test: <worker's title>` from its worker's roster row by itself, so a checker's start needs no `--title` while its worker has one.
   A runner's title is its own name: a new one whose roster row holds none takes it, as a probe takes `Probe: <name>`, so neither row shows its first ask, and it takes no `--title`.
   A lead or manager also starts under its `sessions.names` name (`builder`, `dispatcher`, `ops`, `planner` by default, the second dispatcher the dispatcher's with `-2`), an old name `sessions.aliases` maps to its kind, `optimizer`, or one the roster gives its kind, and a resume keeps whatever name the session has.
   A session started under an old name (`worker-brave-otter`, `reviewer-brave-otter`, `probe-sdk`) keeps it, and a checker spawned again for a PR takes the name it had (**rounds**).
   A session respawned after a restore takes the name of the session it replaces, since it starts fresh from a handoff rather than resumed.
   Live means `ListAgents` lists it or `herdr pane list` shows a pane running it; a roster entry, or a resume record in `~/.playground/resume`, proves nothing about life.
2. Spawn a new session only for a chore that needs its own context; a short job (a probe-sized check, a one-off script) runs as a background task in the session that wants it.
   Run spawn.sh by its absolute path, `"${PLAYGROUND_REPO:?}/scripts/spawn.sh"` (every launch exports `PLAYGROUND_REPO`, the main checkout), from your own folder, so your shell stays out of the main checkout, where `no-main-checkout` refuses git moves.
   A pane started by hand has no `PLAYGROUND_REPO`, so the `:?` stops the call with its name; set it there to the main checkout as the factory's hooks find it: `export PLAYGROUND_REPO="$(dirname "$(git -C <any playground worktree> rev-parse --path-format=absolute --git-common-dir)")"`.
   Start it in the background that way, the one way a factory session starts another:
   the factory's `no-raw-spawn` hook refuses every cmux call but its help or version, a `claude --resume` or `--continue`, and every herdr call but its reads (`get`, `list`, `read`, `agent wait`, `pane wait-output` and the like)
   and a scratch world's of the session's own ([scripts/README.md](../../../../scripts/README.md#spawnsh)),
   naming the script; type every program by its literal name, since one held in a variable (`$V integration add`) reads as herdr when a herdr command group follows it.
   It holds the machine's room in code (the room is the cores in use, not a count of slots), through a capacity gate that refuses, failing closed, unless four checks pass in order, the first failure naming its gate and its reading,
   and counts no live sessions or workers (no cap; Ops watches the live board for the risk of a terminal that stops answering, as cmux did at 49 live sessions and load5 97):
   the higher of load1 and load5 (the third field of `sysctl -n vm.loadavg`), plus the starts of the last 5 minutes (`gates.startsWindow`), its own and each `slots.peers` folder's, each weighing half its item's load units, under the core count (`sysctl hw.ncpu`) times `PLAYGROUND_LOAD_MULT` (default 1.0),
   less a quarter (`gates.smallReserve`) kept for small items unless the start is small (`--size small|medium|big`, else small for a reviewer or tester, else the roster's or plan.json's size, else medium; [rules/slots.md](../../rules/slots.md)), while a small worker keeps an eighth (`gates.reviewReserve`) in its place for the checkers,
   refusing at or over that line whatever the CPU's idle share, since the owner's rule keeps the load under the cores, and the refusal names the load, the starts and the line;
   a `--priority` start passes it while `priority.json`, an org's own `priority-<name>.json` or a job's own `priority-start.json` stands in the data folder, since priority work comes first,
   and so does a resume within 15 minutes of `spawn.sh close` ending a row that read live, since that session already counts in the load it comes back into;
   memory pressure level 1 or 2 with 8% or more free (`gates.memoryFreeMin`),
   and for a fresh worker start alone swap-ins under 100/s (`gates.glmSwapinsMax`, `vm_stat -c 2 1`'s last second), refusing when vm_stat gives no reading, since free memory counts compressible pages and read 62% on 7 Nov while 150 pages swapped in a second; every other start keeps its pass, as at the slots gate;
   for a fresh worker start alone, a run-slot lane free with the load units for a run, or an empty queue (`scripts/ops/run-slot.sh room`), so a new worker never joins a queue it has no room in, while checkers, resumes and moves skip it,
   and a `--priority` start passes a full queue with a priority file standing, as at the load gate; and the launching backend's usage:
   Claude's from `usage.json` (written in the last 15 minutes, the 5-hour window under 90%, the week within its pace, or under 98%, a sanity backup, while `~/.playground/usage-pace-off-until` holds a future ISO 8601 time with its zone,
   which the dispatcher writes on the owner's go (#i509) and the pass line names, a missing, empty, past or unreadable time leaving the pace on;
   a `usage.json` never written, as on a fresh install before the ops-usage job first runs, passes every start, its pass line reading `unread (usage.json not yet written)`, while one that exists still has to read, be fresh and be under its limits;
   each other login's `usage-<name>.json`, and each account login-flip probes by its reading in `login-flip.json`'s `seen`, takes the same checks, its reading valid for 60 minutes, a missing 5-hour window reading as no 5-hour limit;
   `--account` skips it, since the other login's usage is not this machine's, but refuses a week a reading names at 100% until its `resets_at`, or one `usage.json`'s `accounts` map names until its `weekReset`)
   or GLM's from `zai-usage.json` (the 5-hour window under 95% of its credits and no empty `balance`, with no week check (full use, judged on the 5-hour window), only while the ops-zai-usage job's last beat is ok and within 3 cycles,
   so every GLM spawn refuses until `bun run ops:zai-usage` has beaten once).
   A GLM start takes its own load and memory gate in place of the load and memory checks above: load5 (the third field of `sysctl -n vm.loadavg`) under 30 (`gates.glmLoad5Max`), memory pressure level 1, and swap-ins under 100/s (`gates.glmSwapinsMax`, `vm_stat -c 2 1`), so GLM starts while Claude's gate holds.
   Every pass and refusal is one line in `~/.playground/ops/capacity.jsonl`, which the load check counts its starts from, a refusal's carrying the words it printed as `detail`.
   Every manager start takes the gate, an orchestrator's included, but the first dispatcher's, which starts past a failing gate so the owner always has one: the gates after a failing one still read and pick its login, and its one row reads `skipped`, naming each gate it went past with a refusal's words, and counts as a start.
   `bun run verify system` reads how many more workers and how many more orchestrators fit now, and what limits each.
   It also refuses while a live session already holds the name (below).
   A refusal names its gate and what it read: close a session that is done ([End](#end)), or wait for the reading to fall, and run it again.
   Its one bypass is the first dispatcher's (above); past the gate otherwise only the owner starts a session, from his own terminal, whose sessions load no factory hook, or a PR changes the gate.
   A session that works with others opens as a full-height column to the right of the newest one in their workspace, never wrapped into a grid (side by side gives the most room, so nothing wraps): a worker's workspace reads worker | reviewer | tester, and the managers' reads `dispatcher` | `planner` | `builder` | `ops`.
   A session already running stays where it is until its next restart.
   spawn.sh starts each as `env PLAYGROUND_ROLE=<role> claude -n <name> --model claude-opus-5-5 --effort high --settings $HOME/.playground/factory-settings-400k.json --dangerously-skip-permissions` (a probe's file is `factory-settings-sandbox-400k.json`):
   every session starts at high effort; the owner picks a dispatcher's, the Assistant's or the hosted session's effort in the menu left of Send in its Dashboard composer, and a lead picks any other session's with spawn.sh's `--effort` at a start or a resume, high for every class by brief-rush's model rule unless the owner's word in the **override** shape names another;
   every session runs on `models.default` (Opus) unless it starts with `--model` naming another of `models.claude` (Fable, Sonnet or Haiku by default; spawn.sh refuses any other id, `--model` beside `--backend glm`, and any but `models.checker` (Opus) for a reviewer or tester, whose verdict gates a merge, and records none of them,
   so a resume takes `--model` afresh and one without it runs on Opus) or with `--backend glm` (below) (Opus at extra-high effort for research and everything else, never Sonnet), and every subagent a session starts runs on Sonnet unless it names a model,
   from the factory settings' `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` (the owner approved #i492, 17 Oct; on GLM the alias maps to GLM), so a brief or subagent call that needs Opus names `model: opus`; a scheduled ops job that calls a model keeps its own.
   The owner picks another model for a dispatcher, the Assistant or the hosted session in the menu left of Send in its Dashboard composer, and a resume of that session keeps neither that pick nor an effort picked there.
   Its first prompt names the session, its role and who it reports to, and has it load this skill and read `<brief>`, a file under `~/.playground`, which spawn.sh refuses to start without (a Claude worker's adds that `brief-rush.md` binds it on its Claude lane, within the lanes its own header scopes, while that file exists; a GLM worker's leaves it out).
   - **A worker** opens its own workspace, named after it, in the Playground checkout, or in the folder `--in <dir>` names under the code root or the folder of an org `ext.links` guards, reporting to the builder, or to the session `--reports-to <session>` names when its brief reports elsewhere; **a runner** the same, reporting to ops, with no `--reports-to`.
     spawn.sh names each with `roster.ts who builder` and `who ops` ([ROSTER.md](ROSTER.md)), each seat's live holder, else its `sessions.names` name, so a manager respawned under a new name takes its new workers at once:

     ```bash
     "${PLAYGROUND_REPO:?}/scripts/spawn.sh" worker <name> <brief> --title "<title>" [--reports-to <session>]
     "${PLAYGROUND_REPO:?}/scripts/spawn.sh" runner <name> <brief>
     ```

   - **A checker or probe** opens as a column in its spawner's herdr workspace, to the right of the newest member's pane (the worker for its reviewer, the reviewer for its tester), run from its spawner's session, which it reports to:

     ```bash
     "${PLAYGROUND_REPO:?}/scripts/spawn.sh" column <reviewer|tester|probe> <name> <reports-to> <the newest member's herdr pane id> <brief>
     ```

     A reviewer or tester adds `--pr <url>`, the PR it serves (its issue's URL while the PR is not yet opened): spawn.sh refuses its start without it, and writes it to the checker's roster row before the pane opens, since no-outside-pr-code reads that row at the checker's first tool call.

   - **A manager** opens the same way as a column in the `Managers` workspace, to the right of the newest manager, named once: `column <name> <pane> <brief>`.
     A name whose roster kind, else its name (an `<id>-<kind>`, a `sessions.names` name or a `sessions.aliases` one), is builder, ops or planner opens as a lead reporting to the first dispatcher (a new name gets its kind first, `scripts/roster.ts set <name> kind=builder task=<what it does>`, which writes a `starting` entry that `managerOf` keeps behind the live one until it answers);
     the first dispatcher (its `sessions.names` name, an alias of it, or an `<id>-dispatcher`) opens briefed by the session running spawn.sh, its prompt reporting to no one, and from outside a session (no `CLAUDE_PID`) takes the long form `column dispatcher <name> <the lead that briefs it> <pane> <brief>`.
     The first dispatcher (`sessions.names`' dispatcher, which `playground dispatcher` starts, working with the owner and reporting to no session), the second dispatcher (Inbox #i520), a dispatcher's name with `-2` or an `<id>-dispatcher` it records as `slot=2`, the optimizer (which `playground optimizer` starts), and the Planner,
     the Builder and Ops (which `playground planner`, `playground builder` and `playground ops` start the first time the dispatcher routes work to each) open instead in a workspace of their own, named after each,
     in the main checkout's `.claude/worktrees/leads` (`manager <name> <brief>`, the optimizer by its name or its roster kind, a new name given `kind=optimizer` first the same way;
     an orchestrator of any other manager kind in `kinds.ts`, such as the Assistant or the seatless `orchestrator` kind the sidebar's plus starts, any number at once, opens there too, as a lead reporting to the session its row names, once `scripts/roster.ts set <name> kind=<kind> reportsTo=<session> task=<what it does>` has given it both, and spawn.sh refuses it naming that line until it has;
     spawn.sh refuses the second dispatcher on Claude without `--account <email>`, a second account, so it never shares the first's login, and a resume of it whose pin reads claude needs `--account` again, since nothing records the account).
     After a restart, `python3 scripts/ops/up.py --sessions` prints the `spawn.sh resume <name> <dir> <session-id>` line that brings each session back, with `--backend glm` for a session whose newest turn ran on GLM and, for a reviewer or tester, `--pr` with the PRs its roster row serves, its `pr` first;
     `--brief <file>`, with resume alone, makes the resumed session's first prompt tell it to read `~/.playground/<file>` and follow it, so it comes back working rather than idle.
     Without it, the first prompt has the session act on the `after-resume` hook's instruction (re-arm its background tasks, re-send its unanswered messages, the **context** rule), so a session idle at the restart still takes a turn, and names whom it reports to now, from its roster row ([scripts/README.md](../../../../scripts/README.md#spawnsh) holds the order).
     After a resume, restart any dev stack you served, then re-arm your watches: run CronList before CronCreate, since a resume keeps the session's crons and drops only its background tasks.
     Done when the restarted stack answers its `/api/health` and each watch is armed once.
     Before a close that a resume follows (an account move), wait until the session has no run-slot run in flight, since the close kills that run.
     Before an account move, its dispatcher tells every session that serves a dev stack, so what it serves does not go down unannounced.
     A resume within 15 minutes of its close passes spawn.sh's load gate (Spawn, above); later resumes go about 2 minutes apart, since the gate counts recent starts and refuses a burst, and a refused resume waits and runs again.

   It prints herdr's answer (`herdr pane <id> workspace <id>`) and records the session's `kind`, a checker's `worker=<its worker's full name>`, a worker's or runner's `reportsTo=<the session it reports to>` and, for an entry with no task, a `task` as [ROSTER.md](ROSTER.md) says, in the roster,
   by `set` through the checkout's `scripts/roster.ts`, which keeps a respawned session's work.
   The kind comes from the mode (`worker` for a worker, `runner` for a runner, the column's role for a checker or probe) or, for a manager, from its name (through `sessions.names`, then `sessions.aliases`, or `optimizer`), else an orchestrator's roster kind; a resume reads the roster's kind for the name first and refuses a name that neither the roster's kind nor a factory name places.

   It refuses a name a live session already holds (a `claude -p` run, whose registry file reads `entrypoint` `sdk-cli`, holds none), naming that session's pid, since Claude Code would start the new one under a generated name while the roster still pointed at the old one: a respawn under the same name spawns only once the old session has closed (after a `spawn.sh restore`).
   It launches every session with `--dangerously-skip-permissions`, the factory's bypass mode, so it never rests on the machine's own settings (a session in another mode holds every cross-session message for approval);
   the machine's `~/.claude/settings.json` (`$CLAUDE_CONFIG_DIR`'s when that is set) should also set `"permissions": { "defaultMode": "bypassPermissions" }` and `"skipDangerousModePermissionPrompt": true`, so a session started any other way lands there too with no prompt to stop on, which setup's check reports as `bypass mode`.
   On a Mac whose inscope exports a workspace's own `CLAUDE_CONFIG_DIR` (its `inscope.zsh` names it, or `INSCOPE_CCD` is set), it launches with `env -u CLAUDE_CONFIG_DIR -u INSCOPE_CCD`, where a session would otherwise start with no login, and reads the live sessions and the roster under `~/.claude`; elsewhere it leaves the environment as it is.

   `--account <email>`, with any mode and anywhere among its words, has the session log in as that Claude account: the lead names it to pin a login (`spawn.sh resume dispatcher <dir> <session-id> --account <email>`, `spawn.sh worker <name> <brief> --title "<title>" --in <dir> --account <email>`), and a running session never switches accounts by itself.
   spawn.sh refuses, before it opens a pane, an email that is not a plain `local@domain`, the machine's own login (`oauthAccount.emailAddress` in Claude Code's `.claude.json`, under `$CLAUDE_CONFIG_DIR` else in `~`, matched in any case), since a session on it would share that login's usage while `--account` skips the usage check, and one with no item in the Keychain under `usage.keychainService`,
   checking only that the item exists.
   It also refuses an `--account` whose `usage.accounts` row sets `parkedUntil` to a later time, naming `parkedUntil`.
   It also refuses an `--account` whose week a reading names at 100% (`usage.json`, `ops/usage/stored-login.json` or a `usage-<name>.json`, until its `resets_at`, or `usage.json`'s `accounts` map, until its `weekReset`), naming the account and its reading, and, for the map's reading, the account with the most room, in any mode, a resume included.
   The launch then starts with `CLAUDE_CODE_OAUTH_TOKEN="$(security find-generic-password -s <usage.keychainService> -a <email> -w)"` as text, so the new pane's own shell reads the token into the session's environment and it never reaches herdr's argv, spawn.sh's output, the roster or a log; a read that comes back empty stops the pane there, before claude runs, naming the save-it-again command.
   With no `--account`, spawn.sh picks among the machine's own login (the one in `.claude.json`'s `oauthAccount`, judged by `usage.json`, or by `ops/usage/stored-login.json` while `usage.json` reads the factory account, which then counts as another login), each other login with a `usage-<name>.json`, and each account login-flip probes with a reading in `login-flip.json`'s `seen`,
   keeping those that pass the usage gate, a login whose `usage.accounts` row sets `parkedUntil` to a later time counting as over it.
   It takes the one next in the account split: `ops/usage/login-flip.json`'s `split.shares`, each account's week left per hour to its week reset or, for an ending account, 2 hours before its end, whichever comes first, a fifth of that for an account whose row sets `own` while that deadline is over a day away, none for a parked one, read under 30 minutes old (two of the ops tick's 15-minute beats).
   The pick is a smooth weighted round robin: each start adds every passing login's share to its credit in `ops/usage/split-picks.json`, takes the highest, and takes the shares' sum off it.
   With no fresh split, or none of it passing, it takes the one with the lowest week.
   It prints `no --account, so it starts on <email>, next in the account split (<share>% of new sessions)` (or `the login with the most room this week`) when that is another login, which then starts on it as `--account <email>` would, and `so it stays on <email>` when it is the machine's own.
   A bare `resume` or `restore` picks the same way and prints the same line, so a session can come back on another login than it ran on: the resume record's exec line keeps only an `--account` you gave, while its `# account:` line names the login the session runs on, a pick included.
   It refuses only when every login is over the gate, naming each one's reading, a stale one's file and age included.

   `--backend glm`, with any mode and anywhere among its words, runs the session on Z.ai's GLM through Claude Code, so its hooks, skills and transcript stay as they are: a lead picks it per spawn for the work **glm** gives GLM, and never for a reviewer or a tester, whose verdict gates a merge.
   That work stays off the Opus paths: the factory's `no-glm-heavy-path` hook refuses a GLM session's `git commit` or `git push` that touches `web/next/`, `scripts/hooks/`, `scripts/spawn.sh`, the `pr-merge` or `verify` scripts, `lefthook.yml` or `.github/workflows/`, naming the files, so a worker it stops reports them to its lead, who moves that change to a Claude worker.
   While load5 (the third field of `sysctl -n vm.loadavg`) is over 15 the hook also refuses a GLM session's install, node_modules clone, commit or push whatever the paths, so the session waits for the load to fall.
   The same hook refuses a GLM session's headless `claude -p`, its calls to an org's tracker, chat, docs and repos, its shell reads of an org's checkout and its database clients aimed off this machine, every MCP tool or resource read, and a Read, Grep or Glob of an org's checkout once its matcher takes them.
   Each refusal names the **glm** rule, so the session reports to its lead and the task goes to a Claude worker (`scripts/hooks/README.md`).
   spawn.sh refuses `--backend glm` for a reviewer or tester, as a column or on resume, and for a session in a checkout of an org `ext.links` guards (a folder on its path, or its GitHub origin's owner) or on a brief naming a word of the `glm-refused-sources` guard list ([rules/glm.md](../../rules/glm.md)).
   `tests/guarded-on-glm.test.ts` holds the repo's jobs (`scripts/ops`, `packages/scripts/src`, `api/hono/src` and `skills`) to the same line: it fails on a file that names a refused source and wires GLM, or that starts a headless `claude` on the environment it inherits; a job kept under `~/.playground/ops/`, outside the repo, is outside that scan, so the rule alone holds it.
   Its key is a `usage.accounts` row of provider `glm`: the one `--account <label>` names, else the first; `playground accounts add --provider glm --label <label>` adds one.
   It refuses another backend, an `--account` that labels no GLM row, `usage.accounts` with no GLM row, and a Keychain with no item for the label under `models.glmKeychainService` (default `playground-glm`), before any herdr call.
   The launch starts with `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN="$(security find-generic-password -s <models.glmKeychainService> -a <label> -w)"` as text (an empty read stops the pane there, before claude runs, naming the save-it-again command) and every model mapped to GLM (`models.glm` with `[1m]`, `glm-5.3-flash[1m]` by default,
   which carries 3x the plan's quota of glm-5.3 and keeps the 1M window the `[1m]` gives Claude Code; the small fast one `models.glm` bare), `ENABLE_TOOL_SEARCH=true`, since on a base URL that is not Anthropic's Claude Code would load every MCP tool's schema at start, past that window, and runs `--model 'glm-5.3-flash[1m]'` with `--settings ~/.playground/factory-settings-glm-400k.json`,
   which spawn.sh rebuilds from the factory's settings on every GLM launch with the telemetry turned off (`CLAUDE_CODE_ENABLE_TELEMETRY=0`, `OTEL_METRICS_EXPORTER=none`), since the user settings may export usage to an org's usage collector, which counts Claude usage alone; that file's env outranks the user settings' env, and it holds every factory hook.
   The session compacts in the factory's one 400k window (**context**).
   A start records its backend in `~/.playground/backends/<name>` once herdr has the session (`--backend claude` names the default), and a resume runs that backend: it refuses `--backend` while a pin stands, a resume with no pin and no `--backend`, and a pin that reads neither glm nor claude.
   So a running session moves to GLM only by a close and a fresh start under `--backend glm`.
   The 98% switch to GLM is retired by his decision on Inbox #i827: the account rotation moves the factory between Claude accounts in its place (`scripts/ops/usage/login-flip.py`).

   `--runtime herdr`, with any mode but restore or close and anywhere among its words, opens the session in herdr, as every start does without it, on the playground server `bun run ops:herdr start` (or `dispatcher`) keeps up, by the binary its pin names; spawn.sh never starts or stops a server, and refuses while it is down.
   A column's anchor is then a herdr pane id (`w1:p2`, or lettered as `wN:p1A`; your own is `$HERDR_PANE_ID`), and a name holds at most 32 characters.
   A probe on a server with no pane to split beside opens in a workspace of its own, in this checkout: `spawn.sh probe <name> <reports-to> <brief>`, with no `--runtime` or with `--runtime herdr`.
   It opens on the playground server; `PLAYGROUND_HERDR_SESSION=playground-probes` before the command puts it on the probes server.
   When herdr refuses a placement, spawn.sh quotes herdr's own error in its refusal.
   It labels the session's pane with its name, and that label is where the session is found, so the session's roster entry records no `workspace` or `surface`.
   The Dashboard lists it by name, for any session to read; `herdr pane list` shows the labels only when run in a pane on the playground server, since from a pane on another server herdr's reads reach that server's socket.
   It waits for Claude's REPL with `pane wait-output`, and answers the folder trust and MCP picker for you only under the code root (`paths.codeRoot`, else the folder that holds the main checkout) and `~/<org>` for each org `ext.links` guards; anywhere else the session waits at the prompt for the owner, and spawn.sh says so.
   Every start and resume records its runtime, herdr, in `~/.playground/runtimes/<name>`, rewriting whatever word an older pin held.
   With no `--runtime`, every start and resume opens in herdr, from any terminal, and spawn.sh refuses a `--runtime` other than herdr and a column anchored on anything but a herdr pane id.
   After a herdr server's restart, which brings each pane back as a shell under its label, ops-herdr runs `spawn.sh restore` for that server (LIFECYCLE.md, Ops jobs), which resumes every session whose resume record in `~/.playground/resume` names it on that server (its `# server:` line, the factory's when it has none) and whose roster row is not done, ended, parked or paused,
   each through `spawn.sh resume` and its gate with the `--account` its start was given, the `--model` it started with, an `--effort` other than high and, for a reviewer or tester, `--pr` with the PRs its roster row serves,
   in the pane holding its label, printing one line a record: `restored <name>`, `skipped <name>: <reason>` (`live`, the roster row's down status, a record that does not read, or an exec line that does not parse or that it does not run) or `not restored <name>: <reason>`, a gate's refusal included; it is safe to run again, one at a time:
   while another restore holds `resume/.restore.lock` it prints `another restore is running (pid <n>)` and exits 1.
   A readable record on another server gets no line, since that server's own restore reads it.
   A session that never took its first turn has no transcript, so its resume starts it afresh under its own id and name, with the prompt its start recorded in `resume/<name>.prompt`.
   Done when each line reads `restored`, `skipped <name>: live` or a roster row's down status, or you have acted on it (a full gate: run it again once a session closes; a broken record or a missing backend pin: resume the session by hand).

   `--check`, with any mode but restore or close, runs every gate but the live-name one and starts or closes nothing.

   `<role>` is the session's kind: `dispatcher` (both dispatchers), `lead` (the builder, ops, the planner and `optimizer`), `worker`, `reviewer`, `tester`, `runner` or `probe`.
   It turns on the factory's guards, such as the `no-linear-ticket` hook (**tickets**); a session the owner opens himself has no role, so they leave it alone.
   `--settings` adds the factory's own hooks, such as the `no-playground-leak` hook (**classified**), on top of the owner's settings, wherever the session works;
   `scripts/link-skills.sh` links that file to the checkout's `scripts/factory-settings.json`, whose hooks find the main checkout through `PLAYGROUND_REPO`, which spawn.sh exports to every session it starts, so they run wherever the session works.
   A session gets exactly one `--settings`, since Claude Code keeps only the last one given, and anything extra is merged into that file, as a GLM launch merges its telemetry off.
   Every launch merges its compact window (**context**): spawn.sh rebuilds the linked file on each launch into `factory-settings-400k.json` for every kind but a probe, `factory-settings-glm-400k.json` on GLM, so a resume keeps the same window.
   A probe takes `factory-settings-sandbox-400k.json` (`factory-settings-glm-sandbox-400k.json` on GLM), the same file plus Claude Code's sandbox around its shell commands (scripts/README.md, spawn.sh).
   herdr's own resume is off (`resume_agents_on_restore = false` in ops-herdr's `config.toml`), since it would bring a session back without `--settings` or the role, as a bare `claude --resume` by hand does.
   A session resumed that way gets its hooks from its folder alone: Claude Code loads `.claude/settings.json` from the session's own folder, and in a checkout whose settings carry the same hooks they load from there and read the role from the session's name, but anywhere else (a work-org checkout, an older checkout, a subfolder) nothing does,
   so a factory session resumed without its settings where its own folder's `.claude/settings.json` lacks them is respawned from its handoff through spawn.sh, never left running as resumed.
   Every Ops sweep runs `python3 -I <main checkout>/scripts/ops/up.py --sessions`, which names each one (and none once each is respawned), and sends each to the one it reports to (a checker's or probe's spawner; the dispatcher's goes to Ops), which respawns it, since a live session keeps its name:
   the session writes a handoff ([Write a handoff](#write-a-handoff), `~/.playground/handoffs/<name>.md`), its pane closes ([End](#end)), and a spawn under the same name ([Spawn](#spawn)) briefs the respawned session with the handoff, which the respawned-session row of ROSTER.md records.
   A resume's `<dir>` is a folder Claude Code already trusts (the Playground checkout or a worktree under it), never a scratchpad or /tmp path.
   In a folder it has never trusted, the session stops on the folder-trust dialog, which no session may approve, and `ListAgents` never lists it.
   A resumed session, a checker included, runs in the worktree or clone it ran in: spawn.sh resume refuses to move a session into the main checkout unless it started there, and refuses a removed folder, naming its branch and, for a the dispatcher worktree, the `git worktree add` line that brings it back.

3. Brief it with `SendMessage` once `ListAgents` lists the name, writing the brief with writing-for-agents loaded (SKILL.md's **writing** rule).
   The brief carries its name and role, who it reports to, the task (for a bundle, its items and its test area, the pages and files it touches, and each `.agents/dashboard/<topic>.md` its item touches, since AGENTS.md holds only their pointers and ALWAYS lines),
   the words the task came from quoted verbatim, the done criterion (the **gate** for a PR; a worker marks its PR ready at 5/5, and the merge path marks a green draft ready itself), "load the playbook skill",
   an ETA with its first reply (**eta**), and that it runs only commands that need no approval: one plain command per call, no `sh -c` or `bash -c` wrapper, no `rm`, no `cd` (absolute paths, `git -C` and `bun run --cwd` instead: inscope's zsh hook runs 1Password's `op` on every `cd` and new shell, prompting the owner's fingerprint)
   apart from the one at a worker's end (LIFECYCLE.md), which prompts once, the **signal** rule, a literal absolute path for `gh --body-file`, since `no-playground-leak` and `no-release-comment` each refuse a path built from a shell variable, a scratch script written through the Write tool and run as `bun <path>` (new-worker.md says why),
   that a worker starts its fixture stack outside run-slot, only while it takes shots, since a command that never exits would hold a slot until it is stopped (**slots**), that a multi-stack ask (a bisect, an A/B) builds one stack at a time, and the **writing** rule: load writing-for-agents with the Skill tool before writing any agent-facing doc, a handoff included.
   A worker's brief says that any change under `web/next/`, a docs `.mdx` included, gets its tester's drive, posted as a `## TesterBot · PASS at <sha7>` comment.
   A guard's plan and its brief (a hook or a gate that refuses calls) each name its threat model as a closed list of literal forms (for a path guard: an Edit or Write tool call on the path, and a shell write, copy, move or delete that names the path literally),
   say plainly that a same-user session can still get past the guard by a form outside that list, and hold a Done when that names only forms from that list.
   A guard's brief tells its worker that it, and every harness it starts, tests each form only as data, through the hook's own `check()` or test entry point, and runs no recursive-delete form at all, since a form can name a path outside HOME, so pointing HOME at a scratch folder contains nothing.
   A loosening's plan and brief name the one class of forms it lets run, and every other form keeps canary's verdict, as `tests/scripts/hooks/refused-forms.test.ts` checks row by row.
   By round 3 on that guard, or at its reviewer's ask for a scope ruling, the lead narrows the PR to that list or moves the protection to a layer that parses no shell, since a guard asked to stop every form never closes: on 1 Nov one ran 16 rounds over 299 minutes, each finding one more shell form, then shipped refusing read-only awk.
   A worker starts its checkers in one step, once its PR's head is ready (its checks green at it): its reviewer always, and its tester (`bun run name tester`) with it when a tester's drive is due, since a reviewer started later left heads waiting over an hour; ops-sweep tells the worker's lead of a head ready 20 minutes with no review round and no live reviewer.
   Done when both are briefed, or the reviewer alone for a PR with no `web/next/` change.
   A worker's brief says that before a push it runs only the touched tests, the list `extensions/core/skills/code-review-loop/scripts/state.ts touched-tests <worktree> origin/canary HEAD` writes to a file it checks is non-empty before passing it to xargs (code-review-loop's two steps), and check-types, through run-slot, and leaves the full suite to GitHub Actions,
   whose `Audit, Lint, and Build` and `test` checks gate the head (**ci**).
   A worker's brief says that a PR holding a long-lived connection (a socket, a pub/sub subscriber, a retrying client) puts code-review-loop's lifecycle table in its Evidence before round 1, one row per path from connect to close.
   A worker's brief says that a PR loosening a guard puts code-review-loop's refusal table in its Evidence before round 1: a `canary | head` row for each row it adds to `tests/scripts/hooks/fixtures/refused-forms/` or names in a source file's `allowed` list, and the refused-forms test's pass count at canary and at the head for the rest.
   It also says that before each review round the worker sweeps: it runs canary's hook and the head's hook over that fixture plus forms of its own around the loosened class (a `source`, a function or alias defined in the same call, a name hashed in the same call), and fixes each form outside the class whose verdict differs, pinning each one canary refuses as a fixture row,
   since on 2 Nov the one hook PR that swept about 75 forms before round 3 found three classes there that the reviewer would otherwise have found one a round.
   The sweep is done when every form it ran outside the class gets canary's verdict at the head under review.
   The body labels both counts apart: the refused-forms test's own result as `refused-forms.test.ts: N/M` passing, and the sweep harness's form count as forms swept, since on 2 Nov a body gave a harness's 1,248 forms as the test's pass count and round 1 filed it as a should-fix.
   A worker's brief says that CI starts only on a pull request into `canary`, so the worker opens its draft PR before it waits on CI, cites a run by its run id or link, and records its branch on the roster at its first push (ROSTER.md's It pushes its branch), so ops-sweep tells its lead when the branch goes 15 minutes with no PR.
   A worker's brief says that a docs-only worktree still runs `bun install` through run-slot before its first commit, since lefthook's hook runs the worktree's own `node_modules/.bin/lefthook` and the commit stops without it, while a review worktree that only reads needs no install.
   It also says that after a merge of canary that moves a path a test fixture uses, the worker points the fixture's reader at a missing path, confirms each fixture-reading case goes red, then restores the reader with `git checkout --`, since a reader that fails open passes a fixture at the old path.
   It also says that a worker that merges `canary` or its stack's parent into its PR keeps the merge commit a plain merge, holding its conflict resolutions alone, and lands each edit after it as a commit of its own, since code-review-loop scores an edit inside a merge as blocking, and that a stacked child takes its parent's final head, by DISPATCH.md's bundles.
   It also says that a stacked child retargeted to `canary` after its parent merges pushes a merge of `canary` before it asks for review, since on 2 Nov GitHub kept one retargeted PR CONFLICTING with no CI run while a local `git merge-tree` was clean, and only a push made it recompute.
   A lead's instruction or a reviewer's brief leaves any raise of a ratchet, or bend of a check whose own rule says it never rises, to that rule's owner, asked on the PR or directly, before the code relies on it, and lists one as agreed only with the owner's words quoted (23 Oct: a raise a brief listed as agreed reached 5/5, and the code owner blocked it).
   A worker started `--in` another repository takes that folder's MCP tools, so its brief names the capability it needs (search Slack, read Datadog logs) and has the worker find the tool with its own `ToolSearch` (21 Oct: a brief named a Slack tool by the factory's own server, and the worker found it under its folder's server).
   A worker briefs its checker by filling a template: it copies `~/.playground/handoffs/new-reviewer.md`, or `new-tester.md` for a Playground PR, to a file of its own under `~/.playground/`, since the linked template is the main checkout's file, fills each slot and passes that file to spawn.sh as `<brief>`.
   The fill rule: a slot is a word of capitals and digits with two underscores on each side, in backticks since the formatter turns a bare one bold, such as `__NAME__` for the session's own name, and a fill replaces those tokens alone.
   So `<owner>/<name>` and every other angle-bracket word stays as written for the reader (22 Oct: a fill of `<name>` by `sed` also rewrote `--repo <owner>/<name>`), and a brief or template that names a token in its own text spells it in words (two underscores, NAME, two underscores), so a fill leaves that text alone.
   Fill the brief and read it back in one call, then run spawn.sh in a later call, once the read shows every slot filled: spawn.sh refuses a brief still holding a slot of its role's template, naming each one, and a fill a hook refused in the same batch as the spawn would leave one.
   The template points at code-review-loop, dev and ui-verify for every step, so the filled brief adds only what its PR needs beyond them.
   The reviewer template's `__SPEC__` slot, under its This PR heading, holds the PR's scope as the lead ruled it, the bar the review scores against and any harness the reviewer re-runs, so the reviewer scores the ruled scope rather than the issue's first Done when.
   Fill it from the lead's ruling and the PR body's scope, and where the lead ruled nothing beyond the ticket, say so.
   Unlike the other slots, the `__SPEC__` fill replaces the backticked token together with its backticks, since the spec runs to paragraphs that inline code would break; the template keeps the backticks only so the slots test, which wants every slot backticked, stays green.
   Done when the filled brief's This PR section names the scope, the bar and the harness, or that there is none, with no `__SPEC__` token left.
   The tester template carries no such slot, since a tester drives the diff's surfaces for CI and posts PASS or FAIL, not a score against the scope.
   A probe's brief adds that it ends by telling its spawner it is done, so the spawner closes its pane (End).
   A brief that has a script written for `/bin/bash` keeps it to macOS's bash 3.2.57, which stops on a fractional `read -t 0.5` (`invalid timeout specification`): wait in whole seconds (`read -t 1`), or run the script under zsh or bun.
   A rule that changes while a checker is live goes to it at once from its worker's lead by `SendMessage`, as an addition to its brief, since a checker that never heard of the change scores it as a finding (12 Oct).
4. Record the start by [ROSTER.md](ROSTER.md)'s start rows (a session respawned after a restore, by the respawned-session row, which keeps the entry's work).
   A worker that spawned a checker or a probe sends the Builder its name, and adds `pr=<its PR's URL>` to a checker's entry beside the `worker=` spawn.sh wrote, which the Dashboard nests it under its worker by.

Send the brief with `notify_when_idle: true`, so its next idle arrives as a notice.
Done when `ListAgents` shows the session busy on the brief and the roster shows the task.

## Write a handoff

A handoff, for a respawn, a parked chore or a priority close, counts as written only once `TZ=UTC ls -l <path>` prints its file, and the report that names it quotes that line.
A handoff names the session's open items, each PR with its head, its next step and its own transcript path, which `ls ~/.claude/projects/*/<id>.jsonl` prints, `<id>` the session id in `~/.playground/resume/<name>.sh`, so whoever picks the work up can read there a detail the handoff dropped.
A hook can refuse the write and leave nothing on disk, so a session whose write a hook refused answers the hook and retries the same write before it reports.
Done when `TZ=UTC ls -l <path>` prints the file, `ls` prints the transcript path it names, and the report quotes the `ls -l` line.

## Rename

A session takes its name at spawn (`claude -n <name>`), and that name is the one `ListAgents` and the dashboard show.
Nothing renames it later: typing `/rename` into its pane would read as the owner, and a `/rename` sent by `SendMessage` arrives as plain text, which Claude Code never runs.
Its pane's label carries that name too, and `spawn.sh close` and `spawn.sh restore` find the session by it, so the label stays as spawn.sh set it; the `no-raw-spawn` hook refuses `herdr pane rename`, which is no read.

The roster keeps the name the session took at spawn, since the dashboard pairs a roster agent with its session by that name.
Done when the roster and the pane's label both carry the name the session took at spawn.

## Check a session

A sweep reads each agent's state from four places:

- `ListAgents`: its row says whether the session is busy, idle or waiting, and its absence means the session is down.
- `herdr pane list`, run in a pane on the session's server: the pane whose `label` is the session's name has `agent_status`, which reads `blocked` while the session waits on a person, `working` while it runs, and `idle` or `done` while it waits.
- `herdr pane read <pane id> --source visible --lines 40` (raise `--lines` for more): what it waits on, a picker or a permission prompt; `visible` reads the screen as it shows now, where `recent` would scroll the session.
- the session-state record at `session-state/<session id>.json` in the data folder: its `state` reads `working`, `idle`, `stuck`, `failed` or `usage-limit`.
  The way from a session's name to its id: the `~/.claude/sessions/<pid>.json` file that names the session holds its `sessionId`.
  A `stuck` or `usage-limit` record goes stale once the transcript holds a newer turn (`stateNow()` in `packages/config/src/session-state.ts` reads it as over), so the positive check is the record reading `working` with `at` after the send.

## Message a session

`SendMessage` takes a live session's name.
A send that reports `Failed to send` may still arrive, so a sender re-sends it once at most, its first line marked `re-send`, and a receiver drops a `re-send` copy of a message it already holds.
When the failed send went by name to a session `ListAgents` lists, that one re-send goes to the `uds:/tmp/cc-socks/<pid>.sock` address the session's newest message came from (its `from`).
The after-resume re-send (Spawn's resume) takes the same `re-send` marker.
Before you report that a session is acting on your message, read its session-state record as Check a session reads it: a record still holding `stuck` or `usage-limit` holds the message unread.
Done when the send, or its one re-send, returns success.

## A headless run

A Claude session whose own toolset holds no Notion tools writes Notion through headless `claude -p` runs from `~`, which loads `notion-shared` (the path is a Claude session's alone, the **glm** rule).
Every run takes the shape the [no-headless-login](../../../../scripts/hooks/README.md#no-headless-login) hook's refusal gives: `CLAUDE_CODE_OAUTH_TOKEN` read from the Keychain item its account names, `PLAYGROUND_ROLE=<your role>` and `env -u CLAUDE_CONFIG_DIR -u ANTHROPIC_API_KEY`.
Every run also carries `--permission-mode dontAsk`, since the machine's bypass default leaves `--allowedTools` blocking nothing, and puts `--allowedTools` last, after the prompt, since that flag takes every word after it.
A run from `~` loads none of the factory's hooks, so `dontAsk` with `--allowedTools` is the only limit on what the run writes.
The write run's `--allowedTools` is `"mcp__notion-shared__notion-fetch,mcp__notion-shared__notion-update-*"`, and its prompt tells the run not to quote the page text in its reply, which a safety-classifier cut-off otherwise stops mid-way.
Before the write, the worker takes the backup itself, in a first, fetch-only run whose `--allowedTools` carries `mcp__notion-shared__notion-fetch` alone and whose prompt calls `notion-fetch` on the page and replies with nothing, on `--output-format stream-json --verbose`:
the worker copies that call's `tool_result` content into `<scratchpad>/notion-backup-<page id>-<utc>.md`, reading the page into neither its own context nor a message, and the model never repeats the page, so a reply cut-off has nothing to stop.
The backup outlives a stop because the worker writes the file, not the run.
The worker writes nothing until the fetch call's `tool_result` carries no error and the file passes `test -s` and a grep for the page's id; a cut-off, an empty file or a missing id means no write, and the worker reports it.
After the write, a second fetch-only run copies the page to an after-file the same way, and the worker checks the after-file with a grep for the change.
When the write stops or the after-file does not hold the change, the next write run restores the page from the backup piped on its stdin, and a third fetch-only run copies the page to a third file, which passes the backup's checks (no error in its `tool_result`, `test -s`, the page's id) before the worker greps it for the change gone.
The worker reports each write's read-back, and each restore with the after-file's check and the third file's.
Done when the after-file holds the change, or, after a restore, the third file passes the backup's checks and shows the change gone, with the restore and both checks reported.

## Answer a permission prompt

A manager answers the permission prompt its session's stuck alert names, by the key the alert gives its call (**unstick**), the session-state hook's alert or ops-unstick's alike:

```bash
playground picker <session> allow <key>
playground picker <session> deny <key> "<why, and the simpler shape to run instead>"
```

Allow presses Yes once in the session's herdr pane while its prompt shows that call, a subagent's command included; deny presses No (Escape), and the relay sends the session the reason.
Each answer is a line in `ops/picker.log`: the time, the manager, the answer, the session and the command's first 120 characters.
Done when it prints that line; it refuses any caller but the session's manager or the primary dispatcher, a deny with no reason, a dispatcher's session, a session in no herdr pane, and a key no waiting call or shown prompt matches, which means the prompt changed: wait for its next alert.
An ops-unstick alert that says picker cannot answer the prompt found no waiting call surely its own, and names the close and resume below.
Picker also refuses a prompt that may be another waiting call's, as a subagent's file or URL prompt always is while its parent waits.
A herdr pane takes no key from your hand, since `no-raw-spawn` refuses every herdr call but a read, so end that prompt by a close and a resume under the session's name:

```bash
"${PLAYGROUND_REPO:?}/scripts/spawn.sh" close <session>
# the exec line ~/.playground/resume/<session>.sh holds, whole but its exec, so the session keeps its account, model and effort
<that line> --brief <a file under ~/.playground of the reason and the simpler shape to run>
```

The session comes back by its session id with its transcript, and the prompted call never runs.
Done when the session works again from its brief.

## Keep the sweep running

A lead keeps two cron jobs in its own session:

1. The sweep: `CronCreate` with `cron: "*/15 * * * *"` and the sweep as its prompt, which starts with `playground sweep <your name>` ([SWEEP.md](SWEEP.md)).
2. Its renewal: recurring jobs lapse after 7 days, so `CronCreate` with `recurring: false` 6 days out, whose prompt deletes the sweep job (`CronDelete`), creates it afresh, and schedules the next renewal.

Done when `CronList` shows both.
A lead's new session creates both again.

Every manager (the dispatcher, the Planner and each lead) also keeps one background task waiting on its stuck alerts, so a stuck session reaches it in seconds rather than after the relay's turn (**unstick**):

```bash
playground alerts-wait <your name>
```

Run it with Bash `run_in_background`; when it exits it has printed one alert: start it again at once, then act on the alert.
A waiter started after time down skips the alerts queued over 5 minutes before it began and names how many, since the relay sent each; while none runs, each alert also goes to Ops to send on, which is fast only while Ops' own waiter runs, so each line to Ops names Ops' restart while it does not.
A worker a probe reports to keeps no waiter, and its probe's alert comes by the relay alone.
Done when the task is running; the relay sends the same alert later, so drop that copy.

## Wait on a signal

A lead waits on the signals the **polling** rule names, never a `sleep` loop or a repeated `gh` read.
A signal that stops coming may be the Mac asleep: read `pmset -g log | grep -E ' (Sleep|Wake) {2,}'` before you name a gap in a relay, a tick or a sampled series, and leave the sleep out of any rate.
A Monitor or watch script runs under zsh, which does not word-split `$list`: loop over literal values or write `${=list}`, since zsh reads `$list` as one item.
Done when every wait ends on a signal and every gap you name is checked against the sleep log.

## Answer a picker

Sessions in the chain ask by `SendMessage`.
A picker that shows anyway (a skill's own `AskUserQuestion`) sits in a herdr pane, which takes no key from your hand, as Answer a permission prompt says:

- When a rule or a sound default decides it, end it by that section's close and resume, with a brief that gives the answer.
- When only the owner decides it, give the resume brief the choice to post as an Inbox decision (**ask**), so the session carries on.
- When the owner is answering the picker in that pane or on the Dashboard, leave it to the owner and wait for the session's report.

Done when the session's state record reads `working` with `at` after the resume, or the owner has the picker.

## End

A finished worker, reviewer or tester ends automatically (`scripts/ops/optimizer/auto_end.ts`), so a lead ends one by hand only on a `Not ended` line:

- `pr:merge` and the train's land end the merged PR's sessions by their roster `pr`, right after the merge; a worker `assign` gave a next task holds no `pr` of it, a checker whose worker's row names another PR stays to serve it, and a session with another of its PRs open, its roster `prs` list's among them, stays, as the sweep holds it.
- ops-tick's auto-end beat, every 5 minutes, ends a checker whose PRs are all merged or closed or whose worker is gone, a worker whose PRs are all merged or closed, and a reviewer idle 30+ minutes whose every head carries its verdict.
  A session's PRs are its roster `pr` and `prs` list, its open branch PRs, its worker's, and every PR its own or its worker's transcript links, so one still open keeps it.
- Each end runs `spawn.sh close <name>`, then `roster.ts report <name> "ended automatically: <why>" status=ended`, the merged sha in the why, and sends its lead one line: its roster `lead`, else its worker's.
- Then it cleans each worktree the session used, one at a time (`cleanWorktree`), and the lead's line names what went and what stayed, with why; a reviewer ended idle keeps its worktrees for its resume.
  A Playground worktree in `.claude/worktrees/` with uncommitted work, unpushed commits or work not on canary stays until `playground rm` confirms its PR has merged or closed (its own PR, by its branch or its exact head), then goes through `playground rm --worktree <path> --discard` whatever it holds, with no Inbox decision; another repo's such worktree stays.
  The live dashboard's checkout stays, by its branch.
  A Playground worktree in `.claude/worktrees/` that a live session or a clone holds stays, where a hold by the merged PR's number alone, from the worker still merging it, does not count, nor does a row naming it by its branch or its own PR's number once that PR has merged or closed and the worktree sits at that PR's head (`playground rm`'s `freed by` line;
  commits past that head keep the hold, named with them).
  So does one a symlink outside it points into (another worktree's, a marked scratch folder's or a session scratchpad's, at its top level or one level into its `node_modules`), and its line names the first three links.
  Any other whose `.turbo/dev.pgid` records a stack has it stopped first (`bun run dev:stop` there, whose refusal keeps it), so a clone with no record, a reviewer's with no `node_modules` among them, goes on with nothing to stop.
  Then it goes to the 7-day trash through `playground rm --worktree` (`--pr <url>` at a merge), which keeps one a process holds, and then loses its `playground-<worktree>-db` and `-redis` containers (`docker rm -fv`, each name matched whole, never the live dashboard's database) and its local branch.
  Another repo's worktree goes through `git -C <repo> worktree remove <path>` with no force flag, then `git worktree prune` and `git branch -D`; the main checkout is never one.
- Guards: only a worker, reviewer or tester, not busy for 10+ minutes, with no uncommitted or unpushed work in a worktree it used (the main checkout, where every session starts, is not one, nor a Playground worktree whose PR `playground rm` confirms merged or closed, which the cleanup discards); otherwise its lead gets a `Not ended` line saying why, and the session waits.
- A reviewer ended idle is resumed by its worker on the next push, under the same name (**rounds**): `"${PLAYGROUND_REPO:?}/scripts/spawn.sh" resume <name> <dir> --pr <its PR's URL>`, since spawn.sh refuses every checker start that names no PR; its `Ended` line goes to its worker too.

A session ends by closing its pane, so the workspace's other sessions live on, by the one it reports to, through spawn.sh, since the `no-raw-spawn` hook refuses `herdr pane close` to every factory session (herdr's socket has no access control):

```bash
"${PLAYGROUND_REPO:?}/scripts/spawn.sh" close <name>
```

A session does not close its own pane, since that kills its claude mid-call: it tells the one it reports to that it is done (a checker or a probe, its spawner), who closes it.
Before you close a checker by hand, read its roster entry and ask it which rounds it still holds, since it may be serving another PR (on one PR a reviewer closed mid-round).
It closes the one pane spawn.sh opened for that name, found by the label it set, on the server the session's resume record names (the factory's when the record has no `# server:` line), and prints `closed <name> (pane <id> on <server>)`.
It refuses a session whose runtime pin does not read herdr or that has no resume record, a server that is down or a herdr that is not the pinned one, no pane or two panes carrying the label, and your own pane, quoting herdr's words when herdr refuses the close.
Once the pane closes it sets the session's roster row to `ended` itself, and leaves the pins and the resume record in place, so `spawn.sh resume` can reopen the session, setting the row back to `starting`, as any new start of that name does; a reviewer or tester comes back with `--pr <the PR it serves now>`, which replaces the PRs its row lists (scripts/README.md, spawn.sh).

Record why it ended with `report <name> "<why it ended>"` (ROSTER.md, It ends).
`"${PLAYGROUND_REPO:?}/scripts/spawn.sh" resume <name> <dir>` reopens the session later if it is needed, in the folder it ran in, or anywhere with its session id after `<dir>`: a resume by name alone refuses a folder whose transcripts hold no session of that name.
A reviewer or tester adds `--pr <the PR it serves now>`, as every checker start does.
A herdr session's end is its roster `ended`: with any status but done, ended, parked or paused, `spawn.sh restore` brings it back after the server's next restart.
Done for a herdr session when `bun run --cwd <dashboard checkout> verify ended <name>`, read-only against the live dashboard, which it finds through portless from that checkout (`.agents/dashboard/writes.md`), passes:
it reads the session Ended as the Dashboard does, the roster showing `ended` and no live session holding its name, and fails while live sessions or a herdr server could not be read.
A session that closes to be respawned after a restore (Spawn) records no end, since the respawned session keeps the entry, and comes back by Spawn instead, briefed with its handoff, since a resume brings the old context back.
