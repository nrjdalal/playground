# Sessions

The cmux commands behind the factory's lifecycle; a herdr session's are under Spawn and End.
A cmux session's place is its workspace (`workspace:N`) and its split, the surface (`surface:N`), both in its roster entry; `cmux tree --workspace workspace:N` shows every surface in a workspace.
Sessions that work together share a workspace, so every command aimed at one session names its surface as well as its workspace: a command naming the workspace alone lands on whichever split has focus.
Sessions run in bypass-permissions mode, yet some commands still prompt (`rm`, an `sh -c` wrapper) and a subagent may not inherit bypass, so a session can sit waiting on a prompt.

## Spawn

1. Pick the name: `bun run name <kind>` in the Playground checkout prints a new one, `<id>-<kind>`, a 6-letter id that no roster entry, ended ones included, no registry file and no backend pin holds, then the session's kind, as `k3m9px-worker` (the owner: "The reason we don't want to reuse is that they have some memory in the history or something.
   Aka bloated context.").
   Every new session takes one, a checker with an id of its own: spawn.sh writes its worker into the roster's `worker` key, which nests it under that worker.
   spawn.sh takes lowercase words joined by hyphens that give the kind its mode names, as `<id>-<kind>` or an old `<kind>-<words>` (the Dashboard capitalises each word it can see, so `probe-anne-liaison`, never `probe-anneliaison`), and refuses a name that gives no kind or another (`k3m9px-reviewer` started as a worker).
   Give a worker its title with `--title "<title>"`: plain words of up to 40 characters saying what it does, which the sidebar shows in place of its first ask; spawn.sh refuses a worker without one.
   Keep it to 32 characters, so `Review: ` before it still fits the roster's 40.
   A checker takes `Review: <worker's title>` or `Test: <worker's title>` from its worker's roster row by itself, so a checker's start needs no `--title` while its worker has one.
   A runner's title is its own name: a new one whose roster row holds none takes it, as a probe takes `Probe: <name>`, so neither row shows its first ask, and it takes no `--title`.
   A lead or manager also starts under its `sessions.names` name (`builder`, `dispatcher`, `ops`, `planner` by default, the second dispatcher the dispatcher's with `-2`), an old name `sessions.aliases` maps to its kind, `optimizer`, or one the roster gives its kind, and a resume keeps whatever name the session has.
   A session started under an old name (`worker-brave-otter`, `reviewer-brave-otter`, `probe-sdk`) keeps it, and a checker spawned again for a PR takes the name it had (**rounds**).
   A session respawned after a cmux restore takes the name of the session it replaces, since it starts fresh from a handoff rather than resumed.
   Live means `ListAgents` lists it or `cmux tree --all` shows a surface running it; a roster entry, or a saved record in `cmux sessions list`, proves nothing about life.
2. Spawn a new session only for a chore that needs its own context; a short job (a probe-sized check, a one-off script) runs as a background task in the session that wants it.
   Run spawn.sh by its absolute path, `"${PLAYGROUND_REPO:?}/scripts/spawn.sh"` (every launch exports `PLAYGROUND_REPO`, the main checkout), from your own folder, so your shell stays out of the main checkout, where `no-main-checkout` refuses git moves.
   A pane started by hand has no `PLAYGROUND_REPO`, so the `:?` stops the call with its name; set it there to the main checkout as the factory's hooks find it: `export PLAYGROUND_REPO="$(dirname "$(git -C <any playground worktree> rev-parse --path-format=absolute --git-common-dir)")"`.
   Start it in the background that way, the one way a factory session starts another:
   the factory's `no-raw-spawn` hook refuses a cmux call whose command runs claude (a new workspace, split, pane or surface, a respawn, a layout, a surface's command after `--`), one that opens, forks, restores or wakes a Claude agent or saved session, a `claude --resume` or `--continue`, and every herdr call but its reads (`get`, `list`, `read`, `agent wait`, `pane wait-output` and the like)
   and a scratch world's of the session's own ([scripts/README.md](../../../../scripts/README.md#spawnsh)),
   naming the script; type every program by its literal name, since one held in a variable (`$V integration add`) reads as herdr when a herdr command group follows it.
   It holds the machine's room in code (the owner: "It's not about the slot at all.
   It's about how many cores we are using."), through a capacity gate that refuses, failing closed, unless three checks pass in order, the first failure naming its gate and its reading, and counts no live sessions or workers (the owner, 18 Oct: "don't cap anything"; Ops watches the live board for the risk of a cmux that stopped answering at 49 live sessions and load5 97):
   the higher of load1 and load5 (the third field of `sysctl -n vm.loadavg`), plus the starts of the last 5 minutes (`gates.startsWindow`), its own and each `slots.peers` folder's, each weighing half its item's load units, under the core count (`sysctl hw.ncpu`) times `PLAYGROUND_LOAD_MULT` (default 1.0),
   less a quarter (`gates.smallReserve`) kept for small items unless the start is small (`--size small|medium|big`, else small for a reviewer or tester, else the roster's or plan.json's size, else medium; [rules/slots.md](../../rules/slots.md)), while a small worker keeps an eighth (`gates.reviewReserve`) in its place for the checkers,
   and once over that line the CPU's busy cores plus the starts too (`top -l 2 -n 0`'s idle share of the cores, held to the same line at no more than the core count), so it refuses only when both are over or `top` gives no reading, and the refusal names both (load 24 on 15 cores read 55% idle, 22 Oct);
   memory pressure level 1 or 2 with 8% or more free (`gates.memoryFreeMin`); and the launching backend's usage: Claude's from `usage.json` (written in the last 15 minutes, the 5-hour window under 90%, the week within its pace, or under 98%, a sanity backup, while `~/.playground/usage-pace-off-until` holds a future ISO 8601 time with its zone,
   which the dispatcher writes on the owner's go (#i509) and the pass line names, a missing, empty, past or unreadable time leaving the pace on;
   a `usage.json` never written, as on a fresh install before the ops-usage job first runs, passes every start, its pass line reading `unread (usage.json not yet written)`, while one that exists still has to read, be fresh and be under its limits;
   each other login's `usage-<name>.json`, and each account login-flip probes by its reading in `login-flip.json`'s `seen`, takes the same checks, its reading valid for 60 minutes, a missing 5-hour window reading as no 5-hour limit;
   `--account` skips it, since the other login's usage is not this machine's, but refuses a week a reading names at 100% until its `resets_at`) or GLM's from `zai-usage.json` (the 5-hour window under 95% of its credits and no empty `balance`, with no week check (the owner, 17 Oct: "Just go full throttle."
   and "Based on a 5-hour window"), only while the ops-zai-usage job's last beat is ok and within 3 cycles, so every GLM spawn refuses until `bun run ops:zai-usage` has beaten once).
   A GLM start takes its own load and memory gate in place of the load and memory checks above: load5 (the third field of `sysctl -n vm.loadavg`) under 30 (`gates.glmLoad5Max`), memory pressure level 1, and swap-ins under 100/s (`gates.glmSwapinsMax`, `vm_stat -c 2 1`), so GLM starts while Claude's gate holds.
   Every pass and refusal is one line in `~/.playground/ops/capacity.jsonl`, which the load check counts its starts from, a refusal's carrying the words it printed as `detail`.
   It also refuses while a live session already holds the name (below).
   A refusal names its gate and what it read: close a session that is done ([End](#end)), or wait for the reading to fall, and run it again.
   It has no bypass: past the gate only the owner starts a session, from his own terminal, whose sessions load no factory hook, or a PR changes the gate.
   A session that works with others opens as a full-height column to the right of the newest one in their workspace, never wrapped into a grid (the owner: "They can be horizontal because then we have much more estate.
   We don't need to wrap them around"): a worker's workspace reads worker | reviewer | tester, and the managers' reads `dispatcher` | `planner` | `builder` | `ops`.
   A session already running stays where it is until its next restart.
   spawn.sh starts each as `env PLAYGROUND_ROLE=<role> claude -n <name> --model claude-opus-5-5 --effort high --settings $HOME/.playground/factory-settings-400k.json --dangerously-skip-permissions`:
   every session starts at high effort; another effort is the owner's choice alone, which a lead sets with spawn.sh's `--effort` at a start or a resume, on the owner's word relayed in the **override** shape;
   every session runs on `models.default` (Opus) unless it starts with `--model` naming another of `models.claude` (Fable, Sonnet or Haiku by default; spawn.sh refuses any other id, `--model` beside `--backend glm`, and any but `models.checker` (Opus) for a reviewer or tester, whose verdict gates a merge, and records none of them,
   so a resume takes `--model` afresh and one without it runs on Opus) or with `--backend glm` (below) (the owner, 8 Oct: "Don't use Sonnet, use Opus X High for research and everything.
   Don't consider this easy."), and every subagent a session starts runs on Sonnet unless it names a model, from the factory settings' `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` (the owner approved #i492, 17 Oct; on GLM the alias maps to GLM), so a brief or subagent call that needs Opus names `model: opus`; a scheduled ops job that calls a model keeps its own.
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

   - **A manager** opens the same way as a column in the `Managers` workspace, to the right of the newest manager, named once: `column <name> <pane> <brief>`.
     A name whose roster kind, else its name (an `<id>-<kind>`, a `sessions.names` name or a `sessions.aliases` one), is builder, ops or planner opens as a lead reporting to the first dispatcher (a new name gets its kind first, `scripts/roster.ts set <name> kind=builder task=<what it does>`, which writes a `starting` entry that `managerOf` keeps behind the live one until it answers);
     the first dispatcher (its `sessions.names` name, an alias of it, or an `<id>-dispatcher`) opens briefed by the session running spawn.sh, its prompt reporting to no one, and from outside a session (no `CLAUDE_PID`) takes the long form `column dispatcher <name> <the lead that briefs it> <pane> <brief>`.
     The first dispatcher (`sessions.names`' dispatcher, which `playground dispatcher` starts, working with the owner and reporting to no session), the second dispatcher (Inbox #i520), a dispatcher's name with `-2` or an `<id>-dispatcher` it records as `slot=2`, the optimizer (which `playground optimizer` starts), and the Planner,
     the Builder and Ops (which `playground planner`, `playground builder` and `playground ops` start the first time the dispatcher routes work to each) open instead in a workspace of their own, named after each,
     in the main checkout's `.claude/worktrees/leads` (`manager <name> <brief>`, the optimizer by its name or its roster kind, a new name given `kind=optimizer` first the same way;
     spawn.sh refuses the second dispatcher on Claude without `--account <email>`, a second account, so it never shares the first's login, and a resume of it whose pin reads claude needs `--account` again, since nothing records the account).
     After a cmux restart, `python3 scripts/ops/up.py --sessions` prints the `spawn.sh resume <name> <dir> <session-id>` line that brings each session back, with `--backend glm` for a session whose newest turn ran on GLM;
     `--brief <file>`, with resume alone, makes the resumed session's first prompt tell it to read `~/.playground/<file>` and follow it, so it comes back working rather than idle.
     Without it, the first prompt has the session act on the `after-resume` hook's instruction (re-arm its background tasks, re-send its unanswered messages, the **context** rule), so a session idle at the restart still takes a turn, and names whom it reports to when the prompt its start recorded in `resume/<name>.prompt` says.
     After a resume, restart any dev stack you served, then re-arm your watches: run CronList before CronCreate, since a resume keeps the session's crons and drops only its background tasks.
     Done when the restarted stack answers its `/api/health` and each watch is armed once.
     Before a close that a resume follows (an account move, or `spawn.sh move`), wait until the session has no run-slot run in flight, since the close kills that run.
     Before an account move, its dispatcher tells every session that serves a dev stack, so what it serves does not go down unannounced.
     Resumes go about 2 minutes apart to start, since spawn.sh's load gate counts recent starts and refuses a burst; a refused resume waits and runs again.

   It prints herdr's answer (`herdr pane <id> workspace <id>`) and records the session's `kind`, a checker's `worker=<its worker's full name>` and, for an entry with no task, a `task` as [ROSTER.md](ROSTER.md) says, in the roster,
   by `set` through the checkout's `scripts/roster.ts`, which keeps a respawned session's work.
   The kind comes from the mode (`worker` for a worker, `runner` for a runner, the column's role for a checker or probe) or, for a manager, from its name (through `sessions.names`, then `sessions.aliases`, or `optimizer`); a resume reads the roster's kind for the name first and refuses a name that neither the roster's kind nor a factory name places.

   It refuses a name a live session already holds (a `claude -p` run, whose registry file reads `entrypoint` `sdk-cli`, holds none), naming that session's pid, since Claude Code would start the new one under a generated name while the roster still pointed at the old one: a respawn under the same name spawns only once the old session has closed (after a cmux restore).
   It launches every session with `--dangerously-skip-permissions`, the factory's bypass mode, so it never rests on the machine's own settings (a session in another mode holds every cross-session message for approval);
   the machine's `~/.claude/settings.json` (`$CLAUDE_CONFIG_DIR`'s when that is set) should also set `"permissions": { "defaultMode": "bypassPermissions" }` and `"skipDangerousModePermissionPrompt": true`, so a session started any other way lands there too with no prompt to stop on, which setup's check reports as `bypass mode`.
   On a Mac whose inscope exports a workspace's own `CLAUDE_CONFIG_DIR` (its `inscope.zsh` names it, or `INSCOPE_CCD` is set), it launches with `env -u CLAUDE_CONFIG_DIR -u INSCOPE_CCD`, where a session would otherwise start with no login, and reads the live sessions and the roster under `~/.claude`; elsewhere it leaves the environment as it is.

   `--account <email>`, with any mode and anywhere among its words, has the session log in as that Claude account: the lead names it to pin a login (`spawn.sh resume dispatcher <dir> <session-id> --account <email>`, `spawn.sh worker <name> <brief> --title "<title>" --in <dir> --account <email>`), and a running session never switches accounts by itself.
   spawn.sh refuses, before any cmux call, an email that is not a plain `local@domain`, the machine's own login (`oauthAccount.emailAddress` in Claude Code's `.claude.json`, under `$CLAUDE_CONFIG_DIR` else in `~`, matched in any case), since a session on it would share that login's usage while `--account` skips the usage check, and one with no item in the Keychain under `usage.keychainService`,
   checking only that the item exists.
   It also refuses an `--account` whose week a reading names at 100% (`usage.json`, `ops/usage/stored-login.json` or a `usage-<name>.json`, until its `resets_at`), naming the account and its reading, in any mode, a resume included.
   The launch then starts with `CLAUDE_CODE_OAUTH_TOKEN="$(security find-generic-password -s <usage.keychainService> -a <email> -w)"` as text, so the new pane's own shell reads the token into the session's environment and it never reaches cmux's argv, spawn.sh's output, the roster or a log; a read that comes back empty stops the pane there, before claude runs, naming the save-it-again command.
   With no `--account`, spawn.sh picks among the machine's own login (the one in `.claude.json`'s `oauthAccount`, judged by `usage.json`, or by `ops/usage/stored-login.json` while `usage.json` reads the factory account, which then counts as another login), each other login with a `usage-<name>.json`, and each account login-flip probes with a reading in `login-flip.json`'s `seen`,
   keeping those that pass the usage gate.
   It takes the one next in the account split: `ops/usage/login-flip.json`'s `split.shares`, each account's week left per hour to its week reset or, for an ending account, 2 hours before its end, whichever comes first, read when under 30 minutes old (two of the ops tick's 15-minute beats).
   The pick is a smooth weighted round robin: each start adds every passing login's share to its credit in `ops/usage/split-picks.json`, takes the highest, and takes the shares' sum off it.
   With no fresh split, or none of it passing, it takes the one with the lowest week.
   It prints `no --account, so it starts on <email>, next in the account split (<share>% of new sessions)` (or `the login with the most room this week`) when that is another login, which then starts on it as `--account <email>` would, and `so it stays on <email>` when it is the machine's own.
   A bare `resume`, `move` or `restore` picks the same way and prints the same line, so a session can come back on another login than it ran on: the resume record's exec line keeps only an `--account` you gave, while its `# account:` line names the login the session runs on, a pick included.
   It refuses only when every login is over the gate, naming each one's reading, a stale one's file and age included.

   `--backend glm`, with any mode and anywhere among its words, runs the session on Z.ai's GLM through Claude Code, so its hooks, skills and transcript stay as they are: a lead picks it per spawn for the work **glm** gives GLM, and never for a reviewer or a tester, whose verdict gates a merge.
   That work stays off the Opus paths: the factory's `no-glm-heavy-path` hook refuses a GLM session's `git commit` or `git push` that touches `web/next/`, `scripts/hooks/`, `scripts/spawn.sh`, the `pr-merge` or `verify` scripts, `lefthook.yml` or `.github/workflows/`, naming the files, so a worker it stops reports them to its lead, who moves that change to a Claude worker.
   While load5 (the third field of `sysctl -n vm.loadavg`) is over 15 the hook also refuses a GLM session's install, node_modules clone, commit or push whatever the paths, so the session waits for the load to fall.
   spawn.sh refuses `--backend glm` for a reviewer or tester, as a column or on resume, and for a session in a checkout of an org `ext.links` guards (a folder on its path, or its GitHub origin's owner) or on a brief naming a word of the `glm-refused-sources` guard list ([rules/glm.md](../../rules/glm.md)).
   `tests/guarded-on-glm.test.ts` holds the repo's jobs (`scripts/ops`, `packages/scripts/src`, `api/hono/src` and `skills`) to the same line: it fails on a file that names a refused source and wires GLM, or that starts a headless `claude` on the environment it inherits; a job kept under `~/.playground/ops/`, outside the repo, is outside that scan, so the rule alone holds it.
   Its key is a `usage.accounts` row of provider `glm`: the one `--account <label>` names, else the first; `playground accounts add --provider glm --label <label>` adds one.
   It refuses another backend, an `--account` that labels no GLM row, `usage.accounts` with no GLM row, and a Keychain with no item for the label under `models.glmKeychainService` (default `playground-glm`), before any herdr call.
   The launch starts with `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, `ANTHROPIC_AUTH_TOKEN="$(security find-generic-password -s <models.glmKeychainService> -a <label> -w)"` as text (an empty read stops the pane there, before claude runs, naming the save-it-again command) and every model mapped to GLM (`models.glm` with `[1m]`, `glm-5.3-flash[1m]` by default,
   which carries 3x the plan's quota of glm-5.3 and keeps the 1M window the `[1m]` gives Claude Code; the small fast one `models.glm` bare), `ENABLE_TOOL_SEARCH=true`, since on a base URL that is not Anthropic's Claude Code would load every MCP tool's schema at start, past that window, and runs `--model 'glm-5.3-flash[1m]'` with `--settings ~/.playground/factory-settings-glm-400k.json`,
   which spawn.sh rebuilds from the factory's settings on every GLM launch with the telemetry turned off (`CLAUDE_CODE_ENABLE_TELEMETRY=0`, `OTEL_METRICS_EXPORTER=none`), since the user settings export usage to the Loom relay and Loom counts Claude usage alone; that file's env outranks the user settings' env, and it holds every factory hook.
   The session compacts in the factory's one 400k window (**context**).
   A start records its backend in `~/.playground/backends/<name>` once herdr has the session (`--backend claude` names the default), and a resume runs that backend: it refuses `--backend` while a pin stands, a resume with no pin and no `--backend`, and a pin that reads neither glm nor claude.
   So a running session moves to GLM only by a close and a fresh start under `--backend glm`.
   The 98% switch to GLM is retired by his decision on Inbox #i827: the account rotation moves the factory between Claude accounts in its place (`scripts/ops/usage/login-flip.py`).

   `--runtime herdr`, with any mode but restore or close and anywhere among its words, opens the session in herdr, as every start does without it, on the playground server `bun run ops:herdr start` (or `dispatcher`) keeps up, by the binary its pin names; spawn.sh never starts or stops a server, and refuses while it is down.
   A column's anchor is then a herdr pane id (`w1:p2`, or lettered as `wN:p1A`; your own is `$HERDR_PANE_ID`), and a name holds at most 32 characters.
   A probe on a server with no pane to split beside opens in a workspace of its own, in this checkout: `spawn.sh probe <name> <reports-to> <brief>`, with no `--runtime` or with `--runtime herdr`.
   It opens on the playground server; `PLAYGROUND_HERDR_SESSION=playground-probes` before the command puts it on the probes server.
   When herdr refuses a placement, spawn.sh quotes herdr's own error in its refusal.
   It labels the session's pane with its name, and that label is where the session is found: the roster's `workspace` and `surface` are cmux's, so a herdr session records neither.
   The Dashboard lists it by name beside cmux's sessions, for any session to read; `herdr pane list` shows the labels only when run in a pane on the playground server, since from a cmux session herdr's reads reach another socket.
   It waits for Claude's REPL with `pane wait-output`, and answers the folder trust and MCP picker for you only under the code root (`paths.codeRoot`, else the folder that holds the main checkout) and `~/<org>` for each org `ext.links` guards; anywhere else the session waits at the prompt for the owner, and spawn.sh says so.
   The start records its runtime in `~/.playground/runtimes/<name>`, and a resume whose pin reads `cmux` opens in herdr and rewrites the pin.
   With no `--runtime`, every start and resume opens in herdr, from any terminal; spawn.sh starts nothing in cmux, so it refuses `--runtime cmux` and a column anchored on a cmux `surface:N`.
   After a herdr server's restart, which brings each pane back as a shell under its label, ops-herdr runs `spawn.sh restore` for that server (LIFECYCLE.md, Ops jobs), which resumes every session whose resume record in `~/.playground/resume` names it on that server (its `# server:` line, the factory's when it has none) and that the roster has not ended, parked or paused,
   each through `spawn.sh resume` and its gate with the `--account` its start was given, the `--model` it started with and an `--effort` other than high,
   in the pane holding its label, printing `restored <name>`, `skipped <name>: live` or `not restored:` with the refusal; it is safe to run again, one at a time: while another restore holds `resume/.restore.lock` it prints `another restore is running (pid <n>)` and exits 1.
   A session that never took its first turn has no transcript, so its resume starts it afresh under its own id and name, with the prompt its start recorded in `resume/<name>.prompt`.
   Done when every session it names reads `restored` or `skipped`, or its refusal is one you act on (a full gate: run it again once a session closes).

   `"${PLAYGROUND_REPO:?}/scripts/spawn.sh" move <name>` takes a live cmux session to herdr (the owner, 19 Oct: "well move every single thing to herdr").
   A close followed by `resume --runtime herdr` leaves the session down while the capacity gate refuses (memory pressure with under 8% free, or load over the cores), and a move swaps one copy for another, so it adds neither: it runs every check a resume runs and the usage gate, with the load and memory gates set aside and its capacity row naming the pid it moves.
   It reads the live session holding the name from Claude's registry and its surface from cmux's record (`cmux sessions list --session <id>`), and leaves alone a session cmux holds no record of at the registry's pid (a herdr session, one outside both, or a stale record of an earlier process).
   A session cannot move itself, since closing its own surface ends the move before the herdr copy starts: its lead moves it.
   Only after every check and gate has passed does it close the cmux surface (the workspace when cmux refuses to close its last surface), wait up to 30 seconds (`PLAYGROUND_MOVE_WAIT`) for that process to exit, and resume it in herdr by its session id, with `--model`, `--effort`, `--account` and `--brief` as a resume takes them and `--runtime herdr` alone.
   It signals nothing: cmux's close ends the old process, and a process that outlives the wait leaves the move refused, naming the pid and the `spawn.sh resume` line to run by hand once it exits.
   Every other step after the close either carries the move on or refuses naming that same line, with each option the move was given.
   `--check`, with any mode but restore or close, runs every gate but the live-name one and starts or closes nothing.
   Done when it prints `herdr pane <id> workspace <id>` and the session's roster entry carries neither a cmux `workspace` nor a `surface`.

   `<role>` is the session's kind: `dispatcher` (both dispatchers), `lead` (the builder, ops, the planner and `optimizer`), `worker`, `reviewer`, `tester`, `runner` or `probe`.
   It turns on the factory's guards, such as the `no-linear-ticket` hook (**tickets**); a session the owner opens himself has no role, so they leave it alone.
   `--settings` adds the factory's own hooks, such as the `no-playground-leak` hook (**classified**), on top of the owner's settings, wherever the session works;
   `scripts/link-skills.sh` links that file to the checkout's `scripts/factory-settings.json`, whose hooks find the main checkout through `PLAYGROUND_REPO`, which spawn.sh exports to every session it starts, so they run wherever the session works.
   A session gets exactly one `--settings`, since Claude Code keeps only the last one given, and anything extra is merged into that file, as a GLM launch merges its telemetry off.
   Every launch merges its compact window (**context**): spawn.sh rebuilds the linked file on each launch into `factory-settings-400k.json` for every kind, `factory-settings-glm-400k.json` on GLM, so a resume keeps the same window.
   cmux restores a session after a restart without `--settings` or the role: Claude Code loads `.claude/settings.json` from the session's own folder, and in a checkout whose settings carry the same hooks they load from there and read the role from the session's name, but anywhere else (a work-org checkout, an older checkout, a subfolder) nothing does,
   so a factory session cmux restores where its own folder's `.claude/settings.json` lacks them is respawned from its handoff through spawn.sh, never left running as restored.
   Every Ops sweep runs `python3 -I <main checkout>/scripts/ops/up.py --sessions`, which names each one (and none once each is respawned), and sends each to the one it reports to (a checker's or probe's spawner; the dispatcher's goes to Ops), which respawns it, since a live session keeps its name:
   the session writes a handoff ([Write a handoff](#write-a-handoff), `~/.playground/handoffs/<name>.md`: its open items, each PR with its head, its next step), its surface closes with `--force` ([End](#end)), and a spawn under the same name ([Spawn](#spawn)) briefs the respawned session with the handoff, which the respawned-session row of ROSTER.md records.
   A resume's `<dir>` is a folder Claude Code already trusts (the Playground checkout or a worktree under it), never a scratchpad or /tmp path.
   In a folder it has never trusted, the session stops on the folder-trust dialog, which no session may approve, and `ListAgents` never lists it.
   A resumed session, a checker included, runs in the worktree or clone it ran in: spawn.sh resume refuses to move a session into the main checkout unless it started there, and refuses a removed folder, naming its branch and, for a the dispatcher worktree, the `git worktree add` line that brings it back.

3. Brief it with `SendMessage` once `ListAgents` lists the name, writing the brief with writing-for-agents loaded (SKILL.md's **writing** rule).
   The brief carries its name and role, who it reports to, the task (for a bundle, its items and its test area, the pages and files it touches, and each `.agents/dashboard/<topic>.md` its item touches, since AGENTS.md holds only their pointers and ALWAYS lines),
   the words the task came from quoted verbatim, the done criterion (the **gate** for a PR; a worker marks its PR ready at 5/5, and the merge path marks a green draft ready itself), "load the playbook skill",
   an ETA with its first reply (**eta**), and that it runs only commands that need no approval: one plain command per call, no `sh -c` or `bash -c` wrapper, no `rm`, no `cd` (absolute paths, `git -C` and `bun run --cwd` instead: inscope's zsh hook runs 1Password's `op` on every `cd` and new shell, prompting the owner's fingerprint)
   apart from the one at a worker's end (LIFECYCLE.md), which prompts once, the **signal** rule, a literal absolute path for `gh --body-file`, since `no-playground-leak` refuses a path built from a shell variable and `no-release-comment` one it cannot read,
   that a worker starts its fixture stack outside run-slot, only while it takes shots, since a command that never exits would hold a slot until it is stopped (**slots**), that a multi-stack ask (a bisect, an A/B) builds one stack at a time, and the **writing** rule: load writing-for-agents with the Skill tool before writing any agent-facing doc, a handoff included.
   A worker's brief says that any change under `web/next/`, a docs `.mdx` included, gets its tester's drive, posted as a `## TesterBot · PASS at <sha7>` comment.
   A worker starts its checkers in one step, once its PR's head is ready (its checks green at it): its reviewer always, and its tester (`bun run name tester`) with it when a tester's drive is due, since a reviewer started later left heads waiting over an hour; ops-sweep tells the worker's lead of a head ready 20 minutes with no review round and no live reviewer.
   Done when both are briefed, or the reviewer alone for a PR with no `web/next/` change.
   A worker's brief says that before a push it runs only the touched tests, the list `extensions/core/skills/code-review-loop/scripts/state.py touched-tests <worktree> origin/canary HEAD` writes to a file it checks is non-empty before passing it to xargs (code-review-loop's two steps), and check-types, through run-slot, and leaves the full suite to GitHub Actions,
   whose `Audit, Lint, and Build` and `test` checks gate the head (**ci**).
   A worker's brief says that a PR holding a long-lived connection (a socket, a pub/sub subscriber, a retrying client) puts code-review-loop's lifecycle table in its Evidence before round 1, one row per path from connect to close.
   A worker's brief says that CI starts only on a pull request into `canary`, so the worker opens its draft PR before it waits on CI, cites a run by its run id or link, and records its branch on the roster at its first push (ROSTER.md's It pushes its branch), so ops-sweep tells its lead when the branch goes 15 minutes with no PR.
   A worker's brief says that a docs-only worktree still runs `bun install` through run-slot before its first commit, since lefthook's hook runs the worktree's own `node_modules/.bin/lefthook` and the commit stops without it, while a review worktree that only reads needs no install.
   It also says that after a merge of canary that moves a path a test fixture uses, the worker points the fixture's reader at a missing path, confirms each fixture-reading case goes red, then restores the reader with `git checkout --`, since a reader that fails open passes a fixture at the old path.
   It also says that a worker that merges `canary` or its stack's parent into its PR keeps the merge commit a plain merge, holding its conflict resolutions alone, and lands each edit after it as a commit of its own, since code-review-loop scores an edit inside a merge as blocking, and that a stacked child merges its parent in once, by DISPATCH.md's bundles.
   A lead's instruction or a reviewer's brief leaves any raise of a ratchet, or bend of a check whose own rule says it never rises, to that rule's owner, asked on the PR or directly, before the code relies on it, and lists one as agreed only with the owner's words quoted (23 Oct: a raise a brief listed as agreed reached 5/5, and the code owner blocked it).
   A worker started `--in` another repository takes that folder's MCP tools, so its brief names the capability it needs (search Slack, read Datadog logs) and has the worker find the tool with its own `ToolSearch` (21 Oct: a brief named a Slack tool by the factory's own server, and the worker found it under its folder's server).
   A worker briefs its checker by filling a template: it copies `~/.playground/handoffs/new-reviewer.md`, or `new-tester.md` for a Playground PR, to a file of its own under `~/.playground/`, since the linked template is the main checkout's file, fills each slot and passes that file to spawn.sh as `<brief>`.
   The fill rule: a slot is a word of capitals and digits with two underscores on each side, in backticks since the formatter turns a bare one bold, such as `__NAME__` for the session's own name, and a fill replaces those tokens alone.
   So `<owner>/<name>` and every other angle-bracket word stays as written for the reader (22 Oct: a fill of `<name>` by `sed` also rewrote `--repo <owner>/<name>`), and a brief or template that names a token in its own text spells it in words (two underscores, NAME, two underscores), so a fill leaves that text alone.
   The template points at code-review-loop, dev and ui-verify for every step, so the filled brief adds only what its PR needs beyond them.
   A probe's brief adds that it ends by telling its spawner it is done, so the spawner closes its surface (End).
   A brief that has a script written for `/bin/bash` keeps it to macOS's bash 3.2.57, which stops on a fractional `read -t 0.5` (`invalid timeout specification`): wait in whole seconds (`read -t 1`), or run the script under zsh or bun.
   A rule that changes while a checker is live goes to it at once from its worker's lead by `SendMessage`, as an addition to its brief, since a checker that never heard of the change scores it as a finding (12 Oct).
4. Record a cmux session's start with its `workspace` and `surface` (a herdr session records neither: its pane's label finds it) ([ROSTER.md](ROSTER.md); a session respawned after a cmux restore, by the respawned-session row, which keeps the entry's work).
   spawn.sh records the refs; a worker that spawned a checker or a probe sends the Builder its name and both refs, and adds `pr=<its PR's URL>` to a checker's entry beside the `worker=` spawn.sh wrote, which the Dashboard nests it under its worker by.

Send the brief with `notify_when_idle: true`, so its next idle arrives as a notice.
Done when `ListAgents` shows the session busy on the brief and the roster shows the task.

## Write a handoff

A handoff, for a respawn, a parked chore or a priority close, counts as written only once `TZ=UTC ls -l <path>` prints its file, and the report that names it quotes that line.
A hook can refuse the write and leave nothing on disk, so a session whose write a hook refused answers the hook and retries the same write before it reports.
Done when `TZ=UTC ls -l <path>` prints the file and the report quotes that line.

## Rename

A session takes its name at spawn (`claude -n <name>`), and that name is the one `ListAgents` and the dashboard show.
Nothing renames it later: typing `/rename` into its pane would read as the owner, and a `/rename` sent by `SendMessage` arrives as plain text, which Claude Code never runs.
What a rename can still change is the tab:

```bash
cmux rename-tab --workspace workspace:N --surface surface:N <new>
```

A worker renames its workspace too, since the workspace carries its name: `cmux rename-workspace --workspace workspace:N <new>`.

The roster keeps the name the session took at spawn, since the dashboard pairs a roster agent with its session by that name.
Done when the tab shows the new name.

## Check a session

A sweep reads each agent's state from four places:

- `ListAgents`: its row says whether the session is busy, idle or waiting, and its absence means the session is down.
- `cmux sessions list --json --agent claude --workspace <id>`, where `<id>` is the `id` of the workspace whose `ref` is the roster's `workspace:N` in `cmux --json list-workspaces`: the session's own record (in a shared workspace, the one whose `surface_id` is the session's surface UUID,
  which `cmux list-pane-surfaces --workspace workspace:N --id-format both` prints beside the roster's `surface:N`) has `agent_lifecycle`, which reads `needsInput` while the session waits on you.
  A record is the running session's only when `~/.claude/sessions/<pid>.json`, at the record's `pid`, names its `session_id` and its `procStart` equals `LC_ALL=C TZ=UTC ps -o lstart= -p <pid>`.
  `stored_pid_exists: true` proves nothing alone: cmux keeps a record after its session ends, and macOS hands the freed pid to the next process that starts.
  A dead record keeps its last state, so match by workspace.
  Keep the read to one workspace: cmux builds every record before it applies `--limit`, so a lower limit saves nothing (about 5s of CPU at 2,800 records, measured 12 Oct): pace the reads and keep cmux's store pruned instead.
- `cmux read-screen --workspace workspace:N --surface surface:N --lines 40` (raise `--lines` for more): what it waits on, a picker or a permission prompt.
- the session-state record at `session-state/<session id>.json` in the data folder: its `state` reads `working`, `idle`, `stuck`, `failed` or `usage-limit`.
  The way from a session's name to its id: the `~/.claude/sessions/<pid>.json` file that names the session holds its `sessionId`.
  A `stuck` or `usage-limit` record goes stale once the transcript holds a newer turn (`stateNow()` in `packages/config/src/session-state.ts` reads it as over), so the positive check is the record reading `working` with `at` after the send.

## Message a session

`SendMessage` takes a live session's name.
When a send by name fails for a session `ListAgents` lists, send the same message again to the `uds:/tmp/cc-socks/<pid>.sock` address that session's newest message came from (its `from`).
Before you report that a session is acting on your message, read its session-state record as Check a session reads it: a record still holding `stuck` or `usage-limit` holds the message unread.
Done when the send returns success.

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

A manager answers the permission prompt its session's stuck alert names, by the key the alert gives its call (**unstick**):

```bash
playground picker <session> allow <key>
playground picker <session> deny <key> "<why, and the simpler shape to run instead>"
```

Allow presses Yes once in a herdr pane whose prompt shows that call, a subagent's command included, or answers a cmux session's Feed permission for it once; deny presses No (Escape) or denies it, and the relay sends the session the reason.
Each answer is a line in `ops/picker.log`: the time, the manager, the answer, the session and the command's first 120 characters.
Done when it prints that line; it refuses any caller but the session's manager or the primary dispatcher, a deny with no reason, a dispatcher's session, and a key no waiting call or shown prompt matches, which means the prompt changed: wait for its next alert.
On herdr it also refuses a prompt that may be another waiting call's, as a subagent's file or URL prompt always is while its parent waits: deny that one by hand with Escape (below) and a `SendMessage` of the reason, or take it to the dispatcher.

By hand, Escape is the one key a session presses in another's pane: it types no text, so it says nothing in the owner's name (the pane-typing test in `tests/api/hono/src/lib/dashboard/cmux.test.ts` allows this line alone).

```bash
cmux send-key --workspace workspace:N --surface surface:N escape
```

Then `SendMessage` the session the plain commands to run in place of the one that prompted.
Done when `read-screen` shows the prompt gone and the session working.

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
Done when the task is running; the relay sends the same alert later, so drop that copy.

## Wait on a signal

A lead waits on the signals the **polling** rule names, never a `sleep` loop or a repeated `gh` read.
A signal that stops coming may be the Mac asleep: read `pmset -g log | grep -E ' (Sleep|Wake) {2,}'` before you name a gap in a relay, a tick or a sampled series, and leave the sleep out of any rate.
A Monitor or watch script runs under zsh, which does not word-split `$list`: loop over literal values or write `${=list}`, since zsh reads `$list` as one item.
Done when every wait ends on a signal and every gap you name is checked against the sleep log.

## Answer a picker

Sessions in the chain ask by `SendMessage`.
A picker that shows anyway (a skill's own `AskUserQuestion`) is answered through the Feed:

```bash
cmux rpc feed.list '{"pending_only":true}'
cmux rpc feed.question.reply '{"request_id":"<id>","selections":["<label>"]}'
```

- One string per question, each an exact option label; a multi-select joins its labels with `, `.
  An unmatched string goes through as free text, so a typo becomes a real answer.
- A Feed item maps to its session by the base64 session id at the end of its `workstream_id`: `cmux sessions list --session <id> --json`.
- `"delivered": true` prints even for a made-up id.
  Done only when `read-screen` shows the picker gone.
- The Feed gives up after 120s. After that the picker is the owner's to answer in that pane, where the dashboard shows the session as Stuck (only Playground's own row reads Waiting on you): file nothing, and type nothing, since keys typed into a pane read as his.
- When the owner is answering the picker in that pane himself, leave it to him and wait for the session's report.

## End

A finished worker, reviewer or tester ends automatically (`scripts/ops/optimizer/auto_end.ts`), so a lead ends one by hand only on a `Not ended` line:

- `pr:merge` and the train's land end the merged PR's sessions by their roster `pr`, right after the merge; a worker `assign` gave a next task holds no `pr` of it, a checker whose worker's row names another PR stays to serve it, and a session with another of its PRs open stays, as the sweep holds it.
- ops-tick's auto-end beat, every 5 minutes, ends a checker whose PRs are all merged or closed or whose worker is gone, a worker whose PRs are all merged or closed, and a reviewer idle 30+ minutes whose every head carries its verdict.
  A session's PRs are its roster `pr` and open branch PRs, its worker's, and every PR its own or its worker's transcript links, so one still open keeps it.
- Each end runs `spawn.sh close <name>`, then `roster.ts report <name> "ended automatically: <why>" status=ended`, the merged sha in the why, and sends its lead one line: its roster `lead`, else its worker's.
- Guards: only a worker, reviewer or tester, not busy for 10+ minutes, with no uncommitted or unpushed work in a worktree it used (the main checkout, where every session starts, is not one); otherwise its lead gets a `Not ended` line saying why, and the session waits.
  A cmux session's close is refused the same way, so its lead closes it by hand below.
- A reviewer ended idle is resumed by its worker on the next push, under the same name (**rounds**): `"${PLAYGROUND_REPO:?}/scripts/spawn.sh" resume <name> <dir>`; its `Ended` line goes to its worker too.

A session ends by closing its surface, so the workspace's other sessions live on.
cmux refuses to close a surface or workspace whose session still runs (`confirmation_required: ... has a running process`), so a finished session's close carries `--force`:

```bash
cmux close-surface --workspace workspace:N --surface surface:N --force
```

A session does not close its own surface, since that kills its claude mid-call: it tells the one it reports to that it is done (a checker or a probe, its spawner), who closes it with `--force`.
Before you close a checker by hand, read its roster entry and ask it which rounds it still holds, since it may be serving another PR (on one PR a reviewer closed mid-round).
cmux refuses to close a workspace's last surface (`Cannot close the last surface`), so the last session left in a workspace, a worker once its checkers and probes have gone, ends with its workspace: `cmux workspace close workspace:N --force` (cmux 0.65's name for `close-workspace`).

A herdr session ends the same way, by the one it reports to, through spawn.sh, since the `no-raw-spawn` hook refuses `herdr pane close` to every factory session (herdr's socket has no access control):

```bash
"${PLAYGROUND_REPO:?}/scripts/spawn.sh" close <name>
```

It closes the one pane spawn.sh opened for that name, found by the label it set, on the server the session's resume record names (the factory's when the record has no `# server:` line), and prints `closed <name> (pane <id> on <server>)`.
It refuses a session whose runtime pin does not read herdr or that has no resume record, a server that is down or a herdr that is not the pinned one, no pane or two panes carrying the label, and your own pane, quoting herdr's words when herdr refuses the close.
Once the pane closes it sets the session's roster row to `ended` itself, and leaves the pins and the resume record in place, so `spawn.sh resume` can reopen the session, setting the row back to `starting`, as any new start of that name does.

Record why it ended with `report <name> "<why it ended>"`, and a cmux session's close, which writes no roster, with `status=ended` on that report too (ROSTER.md, It ends).
`"${PLAYGROUND_REPO:?}/scripts/spawn.sh" resume <name> <dir>` reopens the session later if it is needed, in the folder it ran in, or anywhere with its session id after `<dir>`: a resume by name alone refuses a folder whose transcripts hold no session of that name.
A herdr session's end is its roster `ended`: with any status but ended, parked or paused, `spawn.sh restore` brings it back after the server's next restart.
Done for a herdr session when `bun run --cwd <dashboard checkout> verify ended <name>`, read-only against the live dashboard, which it finds through portless from that checkout (`.agents/dashboard/writes.md`), passes:
it reads the session Ended as the Dashboard does, the roster showing `ended` and no live session holding its name, and fails while live sessions or a herdr server could not be read.
A session that closes to be respawned after a cmux restore (Spawn) records no end, since the respawned session keeps the entry, and comes back by Spawn instead, briefed with its handoff, since a resume brings the old context back.
Done for a cmux session when the surface is gone from `cmux tree --workspace workspace:N` (for the last session in a workspace, the workspace is gone from `cmux tree --all`) and the roster shows `ended`, or for a respawn the respawned session.
