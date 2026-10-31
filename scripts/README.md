# scripts

The factory's own scripts: `spawn.sh`, which starts and resumes every factory session, `link-skills.sh`, which installs the skills, the herdr servers' ops job, a worktree's `node_modules` clone and `bun run test:skills`.
AGENTS.md keeps one line for each, and this file holds the text that line stands for.
Read a section before you change its script or its tests, or when it refuses a start you did not expect.
The factory's hooks are in [hooks/README.md](./hooks/README.md).

## spawn.sh

- A factory session starts another only through `scripts/spawn.sh` (playbook's SESSIONS.md, Spawn), which runs a capacity gate that refuses, failing closed, unless three checks pass in order, the first failure naming its gate and its reading,
  and counts no live sessions or workers (no count is capped; Ops watches the live board for the risk of cmux no longer answering, as it once stopped at 49 live sessions and load5 97): the higher of load1 and load5 (the third field of `sysctl -n vm.loadavg`), plus the starts of the last 5 minutes (`gates.startsWindow`) in its own `capacity.jsonl` and in each `slots.peers` folder's,
  each weighing half its item's load units (small 1, medium 2, big 3; `--size`, else small for a reviewer or tester, else what `scripts/ops/run-slot.sh size <name>` reads from the roster and plan.json), under the core count (`sysctl hw.ncpu`) times `PLAYGROUND_LOAD_MULT` (default 1.0),
  less a quarter of that (`gates.smallReserve`) kept for small items unless the start is small, so a big plan never blocks the small ones, while a small worker keeps an eighth (`gates.reviewReserve`) in its place for the reviewers and testers, which start small, so a held review starts ahead of a new worker,
  and once over that line the CPU's busy cores plus the starts too (`top -l 2 -n 0`'s idle share of the cores, held to the same line at no more than the core count), refusing only when both are over or `top` gives no reading, the refusal naming both; memory pressure level 1 or 2 with 8% or more free (`gates.memoryFreeMin`); and the launching backend's usage:
  Claude's from `usage.json` (written in the last 15 minutes, the 5-hour window under 90%, the week within its pace, which never sits below one day's share of 14.3 points, so a week that has just reset passes its first day,
  or under 98%, a sanity backup, while `~/.playground/usage-pace-off-until` holds a future ISO 8601 time with its zone, which the dispatcher writes on the owner's go (#i509) and the pass line names, a missing, empty, past or unreadable time leaving the pace on;
  a `usage.json` never written, as on a fresh install before the ops-usage job first runs, passes every start, its pass line reading `unread (usage.json not yet written)`, while one that exists still has to read, be fresh and be under its limits;
  each other login's `usage-<name>.json`, and each account login-flip probes by its reading in `login-flip.json`'s `seen`, takes the same checks, its reading valid for 60 minutes (a missing 5-hour window reads as no 5-hour limit, never 0%), and a spawn with no `--account` starts on the passing login next in login-flip.py's account split (SESSIONS.md's Spawn), else the one with the lowest week,
  naming it, and refuses only when every login is over, naming each one's reading;
  a bare start runs on the login in Claude Code's config (`.claude.json`'s `oauthAccount.emailAddress`), so while `usage.json` reads another account, the factory's, that login is judged by `ops/usage/stored-login.json` (ops-usage's full reading of it, written in the last 15 minutes and naming that login, else it fails)
  and the factory account counts as another login, reached by `--account`;
  `--account` skips it, since the other login's usage is not this machine's, but refuses a week a reading names at 100% until its `resets_at`) or GLM's from `zai-usage.json` (the 5-hour window under 95% of its credits, with no week check, since its credits run on the 5-hour window alone, and no empty `balance`, which an hour after the failure that set it lets one GLM start try again),
  only while the ops-zai-usage job's last beat is ok and within 3 cycles,
  so every GLM spawn refuses until `bun run ops:zai-usage` has beaten once).
  A GLM session takes its own load and memory gate in place of the load and memory checks above: load5 (the third field of `sysctl -n vm.loadavg`) under 30 (`gates.glmLoad5Max`), memory pressure level 1, and swap-ins under 100/s (`gates.glmSwapinsMax`, `vm_stat -c 2 1`'s last second), so it starts while Claude's gate holds; Claude's gate stays as above.
  Every pass and refusal is one line in `~/.playground/ops/capacity.jsonl`, which the load check counts its starts from, a refusal's carrying the words it printed as `detail`.
  It also refuses while a live session already holds the name, naming its pid (Claude Code would give the new one a generated name); a `claude -p` run, whose registry file reads `entrypoint` `sdk-cli`, holds no name, and a Mac with no `~/.claude/sessions` folder (Claude Code makes it with its first session) holds none.
  It launches every session with `--dangerously-skip-permissions`, beside `scripts/factory-settings.json`'s `skipDangerousModePermissionPrompt`, and, where inscope exports its own `CLAUDE_CONFIG_DIR`, with `env -u CLAUDE_CONFIG_DIR -u INSCOPE_CCD`.
  Each start and resume compacts in one window for every kind, GLM's included, the `context.window` setting's (400,000 tokens by default), set in the one `--settings` file it rebuilds from `scripts/factory-settings.json` on every launch (`~/.playground/factory-settings-<k>k.json`, `factory-settings-400k.json` by default),
  the same window that file gives a session spawn.sh did not start.
  `--account <email>` logs the session in as that Claude account: spawn.sh refuses an email that is not a plain `local@domain` or that is this machine's own login (Claude Code's `oauthAccount.emailAddress` in `.claude.json`, matched in any case), and checks only that the Keychain holds an item for it under the `usage.keychainService` setting's service (`playground-claude-oauth` by default),
  and the launch carries `CLAUDE_CODE_OAUTH_TOKEN="$(security find-generic-password ... -w)"` as text for the new pane's shell to expand, so the token reaches no argv, output or log, and that shell stops there on an empty token or key, before claude runs.
  `--backend glm` runs the session on Z.ai's GLM through Claude Code (`ANTHROPIC_BASE_URL` its Anthropic-compatible endpoint, Opus and Sonnet mapped to `models.glm` with `[1m]` and Haiku to `models.glm`, 3x the plan's quota, the suffix gives Claude Code GLM's 1M window, compacting in the same 400k window as a Claude session does, with `ENABLE_TOOL_SEARCH=true`,
  since Claude Code loads every MCP tool's schema at start on a base URL that is not Anthropic's, and one `--settings`, the factory's rebuilt into `factory-settings-glm-400k.json` with telemetry off, so a GLM session sends Loom no usage and keeps every factory hook),
  its key read the same way from the Keychain item, under the service `models.glmKeychainService` names (`playground-glm` by default), for a `usage.accounts` GLM row's label: the one `--account <label>` names, else the first GLM row's.
  It is refused for an `--account` that labels no GLM row, with no GLM row, with no such item, or for a reviewer or tester, which runs on Claude alone, since no reviewer or tester runs on GLM.
  It is also refused in a checkout of an org `ext.links` guards (a folder on the session's path named for one), and on a brief naming a word of the `glm-refused-sources` guard list (`packages/scripts/src/playground/guard-list.ts` reads it, empty in the checkout), since no guarded org's data reaches GLM.
  A machine with extensions whose `ext.links` or list cannot be read refuses every GLM start, naming the fix.
  A GLM start's prompt, and a resume's given `--brief`, adds that Skill, Read, Bash, Edit and Write are already loaded and ToolSearch lists only deferred tools, since two GLM workers read ToolSearch's list as their whole toolset and stopped.
  A start records its backend in `~/.playground/backends/<name>` once herdr has the session (`--backend claude` names the default), and a resume runs that backend: it refuses `--backend` while a pin stands, a resume with no pin and no `--backend`, and a pin that reads neither glm nor claude.
  `--model <id>` picks the Claude model for a start or a resume, one of the `models.claude` setting, else `models.default` (the docs list each key and its default).
  It is refused for any other id, an empty or missing value, on GLM, which maps every model itself, and for a reviewer or tester (a column of either, or a resume of a `reviewer-` or `tester-` session) on anything but `models.checker`, which a checker runs on with no `--model`,
  since its verdict gates a merge; nothing records it, so a resume takes it afresh and one with no `--model` runs on `models.default`.
  `--effort <level>` sets a start's or a resume's effort, one of low, medium, high, xhigh or max, high with none; it is refused for any other value, an empty or missing value, given twice, and with restore or close.
  The resume record keeps an effort other than high on its exec line, so a restore runs at the same effort, and a resume with no `--effort` runs at high.
  `--title "<title>"` gives a start the plain title the sidebar reads it by, up to 40 characters: a `worker` is refused without one, and a reviewer's or tester's column with none takes `Review: ` or `Test: ` before its worker's roster title, keeps the title its row already holds, or is refused.
  A probe keeps its words-only default and a new runner takes its name, and every other mode refuses it, a resume, a close, a move and a restore included.
  Keep a worker's title to 32 characters, so its checkers' titles show whole.
  `--reports-to <session>` names the session a `worker` reports to, in both places its first prompt names it, in place of the builder; it is refused for a value that is not a session name and with every other mode.
  `--in <dir>` starts a `worker` in that folder in place of this checkout: an existing folder under the code root (`paths.codeRoot`) or under `~/<org>` for an org `ext.links` guards, the folders whose trust prompt spawn.sh answers; any other folder, and every other mode, is refused.
  `spawn.sh column` opens a split right of the herdr pane it names and names a manager once;
  `spawn.sh manager` opens the first dispatcher, `sessions.names`' dispatcher, on this machine's own login, reporting to no session (`playground dispatcher` runs it), the second dispatcher, a dispatcher's name with `-2` (from `sessions.names` or `sessions.aliases`) or an `<id>-dispatcher` it records as `slot=2` (on `--backend glm`, or on Claude with a second account's `--account`),
  the optimizer, `optimizer` (`playground optimizer` runs it) or an `<id>-optimizer` (or a session the roster gives the optimizer kind), or the builder, ops or the planner by `sessions.names` (`playground builder`, `playground ops` and `playground planner` run it), each in a workspace of its own, in the leads worktree,
  which the first such start cuts and installs when the checkout has none: branch leads, tracking origin's copy of the checkout's branch (canary for a checkout on canary, else main), which ops-tick's canary pull keeps current;
  `spawn.sh probe` (in herdr alone) opens a probe in a herdr workspace of its own, for a server with no pane to split beside, and a herdr refusal quotes herdr's own error.
  `--runtime herdr` opens the session in herdr: on the playground server under `~/.playground/herdr`, by the binary its `pin.json` names, refused when that file's sha256 or `--version` differs or the server is not running; a workspace labelled with the name, or for a column a split right of the herdr pane it names (its spawner's own is `$HERDR_PANE_ID`);
  the pane labelled with the name, since herdr clears an agent's name after every turn while a label survives a restart (measured); Claude's folder trust and MCP picker answered only under the code root (`paths.codeRoot`, else the folder that holds the main checkout) and `~/<org>` for each org `ext.links` guards; names of at most 32 characters.
  With no `--runtime`, every start and resume opens in herdr whatever its spawner's terminal, and spawn.sh starts nothing in cmux: it refuses `--runtime cmux` and a column anchored on a cmux `surface:N`.
  A start records its runtime in `~/.playground/runtimes/<name>`, and a resume whose pin reads `cmux` opens in herdr and rewrites the pin.
  herdr 0.9.5 keeps no resume command a custom agent reports (measured: never in its session file, nothing resumed after a restart), so each herdr session's `~/.playground/resume/<name>.sh` is the factory's own list, written once herdr runs the session:
  a `# server: <name>` line naming the server it runs on, a `# account: <email>` line naming the account it runs on, a usage-gate pick included, which ops-unstick reads,
  and one `exec <main checkout>/scripts/spawn.sh resume <name> <dir> <session id>` line with the `--account` its start was given (never a usage-gate pick), the `--model` it started with and an `--effort` other than high, never a token.
  `spawn.sh restore` reads both, taking no other option, and resumes each session on the server `PLAYGROUND_HERDR_SESSION` names (`playground` by default; a record with no server line is playground's) not ended, parked or paused in the roster, through the gate, in the restored pane holding its label;
  a live one is skipped (the live-name refusal exits 3), and each resume of a herdr session stamps its run in `<name>.ran`.
  `spawn.sh close <name>`, taking no other word, ends a herdr session for the one it reports to: it closes the one pane labelled with the name on the server its resume record names, refuses a runtime pin that is not herdr, a missing record, no pane or two carrying the label, and the caller's own pane;
  once the pane closes it ends the session's roster row, which a resume or a new start of that name sets back to starting.
  `spawn.sh move <name>` takes a live cmux session to herdr past the load and memory gates, since the copy it closes frees what the new one takes; playbook's SESSIONS.md, Spawn, holds its contract.
  `scripts/hooks/no-raw-spawn.ts`, registered beside no-stash, reads each cmux call against cmux 0.65.1's `Start & Resume` and `Agents` help groups (`cmux --help`) and the terminal openers, and refuses one whose command (`--command`, `--shell`, `--layout`, `respawn-pane`'s trailing words, the words after `--` for `surface`) runs claude or cannot be read;
  a `fork`, `restore`, `vault fork` or opening `agent` that names claude, cannot be read, or names no other agent; `session restore`, `restore-session`, `claude-teams`, `omc`, `recover --session` and a hibernated agent's `wake` (it skips a global option's value, `--password pw`, to find the command); a `new-surface --provider claude`;
  and a `claude --resume`, `-r`, `--continue` or `-c` before any `--`, naming the script.
  It runs only herdr's reads, its refusal naming SendMessage for talking to a session and the script for a start, and for a program it cannot read, naming what kind of word it is and asking for the program's literal name,
  since herdr's socket has no access control: herdr by any path or by `$HERDR_BIN_PATH` (which herdr sets in every pane), or a program it cannot read followed by a herdr command group, passes `--help` after a command group and a verb alone, `--version` on its own,
  a read verb (`current`, `edges`, `get`, `layout`, `list`, `neighbor`, `process-info`, `read`, `status`) and the reads `agent explain`, `agent wait`, `api snapshot`, `pane wait-output` and the like, and refuses the rest, a bare `herdr`, a call carrying `HERDR_SESSION` or `HERDR_SOCKET_PATH` or an assignment or `export` of either (herdr exports both into every pane),
  every `server` verb but `server agent-manifests`, a connecting program (`nc`, `python`, `socat` and the like) naming a herdr socket (a relative `.sock` path read from the folder the command runs in) or `$HERDR_SOCKET_PATH`, a Unix socket it cannot read as the target of `nc` (a `U` in any short-flag cluster, or ncat's `--unixsock`) or `curl --unix-socket` or `--abstract-unix-socket`,
  any socat address it cannot read, and `npx skills add herdrdev/herdr`.
  A scratch herdr world of the session's own, for a test or a probe, runs past those reads when the call carries both `HERDR_SESSION` and `HERDR_SOCKET_PATH` itself, before herdr or through `env` (an `export` or a plain assignment stays refused), herdr is typed by its name or path (a program it cannot read takes no carve-out), and every one of these holds:
  the socket is a literal absolute path under the session's own `TMPDIR` (`getconf DARWIN_USER_TEMP_DIR`, which spawn.sh's launch file sets), so it never names the factory's servers' under `~/.playground/herdr` or herdr's default (the path's text is read, links unfollowed, as the scope line below allows);
  the session is a word (`lm-probe`) other than `default`, Playground's `playground` and `playground-probes`, the factory's `factory` and `probes`, or a `PLAYGROUND_HERDR_SESSIONS` name, since herdr keeps a server's state under `~/.config/herdr/sessions/<session>`;
  no `--session`, `--machine` or `--remote` (on 0.9.5, `--session` wins over `HERDR_SOCKET_PATH`, measured); the group only talks to its server (`agent`, `api`, `notification`, `pane`, `server`, `status`, `tab`, `workspace` or `worktree`), never `update`, `config`, `integration`, `session` and the rest;
  and no word it cannot read or that names `claude` in any case as a word of its own (a program, `CLAUDE`, `--kind=claude`, `claude-code`, `npx @anthropic-ai/claude-code`), which only this script starts, while the `.claude` folder in a worktree's path and a longer word such as `claudette` pass.
  So `HERDR_SESSION=lm-probe HERDR_SOCKET_PATH=<TMPDIR>lm-probe.Ab12/s.sock herdr server` starts one in the background and the same two words before `herdr pane run`, `send-text` or `server stop` drive and end it, the socket typed as a literal path in every call.
  A cmux version that adds a way to open a session needs a line here.
  Out of its scope, and left to the rule: a raw `cmux rpc`, `pipe-pane`, a package runner that starts claude (`npx`, `bunx`), a wrapper the shell reader does not know, a new terminal that is then sent `claude` as keystrokes (playbook's **voice** rule forbids that send), and, since it guards a session's habits rather than an adversary, a deliberate way around its herdr reads:
  zsh's `zsocket`, `openssl s_client -unix` or `busybox nc` to a herdr socket, `HERDR_SOCKET_PATH` moved by `read`, `printf -v`, `+=` or `unset`, herdr symlinked or copied under another name, and interpreter code.
  It fails closed only on a call that reads as a spawn, and open on any other, as a hook that cannot start does.
  `scripts/ops/up.py --sessions` prints its `spawn.sh resume` lines, every brief names a file under `~/.playground` with no `..`, which spawn.sh checks is there before any gate or launch,
  given by its name there or by its path, `$HOME/.playground/<file>` or `~/.playground/<file>`, and `spawn.sh resume ... --brief <file>` (resume alone) puts only that name in the resumed session's first prompt, never the file's text.
  A `spawn.sh resume <name> <dir>` with no session id refuses, before any pane opens, a folder whose project folder under `$CLAUDE_CONFIG_DIR/projects` holds no transcript naming the session, since Claude's resume picker would find nothing there.
  A `<dir>` under the Desktop folder resumes in the same tree under the code root, and with a session id its transcript is copied into that folder's project after `--check`, so a moved session keeps its conversation; with no code root folder, or one on the Desktop, it resumes in the Desktop folder itself.
  At `--check`, before any close, a resume refuses the main checkout for a session whose transcript is not already in its project folder, naming the folder the session ran in, and refuses a missing folder, naming its branch, and for a worktree under the main checkout's `.claude/worktrees/` the `git -C <main> worktree add` line that brings it back,
  from the newest transcript copy's last `cwd` and `gitBranch`;
  `spawn.sh restore` reports either as `not restored:` and runs the rest.
  A shared herdr workspace has one factory path, `spawn.sh column`, which opens its session as a split right of a herdr pane, in that pane's own workspace; every other factory start opens a workspace of its own.
  `spawn.sh move` takes a live cmux session to herdr and nothing else, `spawn.sh resume` reopens a session in the pane herdr kept under its label, else in a workspace of its own, and the `no-raw-spawn` hook refuses every herdr call but its reads (`herdr pane move` is no read).
  `spawn.sh restore` after a herdr restart refills the panes herdr kept, each resumed through `spawn.sh resume`, so a shared workspace, the column's or one arranged by hand, survives a restart as herdr restores it.
  A shared workspace comes from `spawn.sh column` or the owner's own arranging.
  Tests: `bun run test:file tests/scripts/spawn*.test.ts tests/scripts/hooks`.

## The herdr servers

- The herdr servers belong to one ops job, `bun run ops:herdr` (`packages/scripts/src/ops-herdr/`): it starts each that is down on the binary the repo's `pin.json` beside it names, with its `config.toml`, so both change only through a merged PR, and `bun run ops:herdr stop <session>` refuses while the session holds a pane, since a stop exits every pane;
  `stop default` stops herdr's own default server (`~/.config/herdr/herdr.sock`), which no job starts, refusing only while one of its panes runs an agent.
  The binary is Playground's own copy at `~/.playground/bin/herdr`, following HOME alone as the sockets do, and `playground herdr pin` (`packages/scripts/src/playground/herdr-pin.ts`) puts it there: it downloads the pinned version's release asset for this Mac, checks its SHA-256 against the pin before the move, and refuses a mismatch naming both sums.
  The pin holds GitHub's digest of each release asset, keyed `darwin-arm64` and `darwin-x64`, and the job takes this Mac's, refusing a machine the pin names no asset for; a herdr on PATH is the human's own, which nothing runs.
  Moving to a new herdr is a PR to `pin.json`: its version and every asset's sum.
  Once it has started a server, any of `PLAYGROUND_HERDR_SESSIONS` (`playground,playground-probes` by default; a name that is not a word is named on its beat and skipped), it runs `spawn.sh restore` pointed at that server, since the pinned config turns herdr's own resume off.
  A person brings herdr back with bare `playground`, which runs its `start` first.
  A server hands its panes the shell basics alone, so `spawn.sh`'s herdr launch file sets `TMPDIR` to `$(getconf DARWIN_USER_TEMP_DIR)`, keeping one already set: every start, resume and restore writes that file, so a running server needs no restart for it.
  Nothing in the factory lives under the Desktop folder: macOS guards it by each binary's Full Disk Access, which a herdr or Claude Code update can drop, so the job asks for no grant, and `tests/desktop-paths.test.ts` fails on a tracked file naming a path there.
  A scratch herdr server, for a test or a smoke, takes its folder from `mktemp -d "$(getconf DARWIN_USER_TEMP_DIR)<prefix>.XXXX"`: macOS caps a socket path at 104 bytes (`sun_path`), a session scratchpad path alone runs past that, and the server then stops with `local socket name length exceeds capacity of sun_path`.
  playbook's LIFECYCLE.md, Ops jobs, has the rest.

## link-skills.sh and rerere

- Skills reach a session as a plugin, and a personal skill in `~/.claude/skills` takes a bare name over any plugin's, so link-skills.sh removes every link there at a name the home set ships, another tool's included, and every other foreign link stays: inscope links upstream's `pr` at `~/.claude/skills/pr`, which would otherwise run in place of the repo's copy.
  inscope 0.15 and older put that link back on an `apply`, so run link-skills.sh again after one.
- It then installs the home skill set at user scope with `playground orgs home`, through the `ws` marketplace it writes in `~/.playground/orgs`; a later run moves the marketplace's entry to the new set and runs `claude plugin update ws-home@ws`, since Claude Code installs a copy.
  Before it installs, it removes each `~/.claude/skills` link at a name the set ships that points into Playground's checkout, and keeps a link that points anywhere else (inscope's cache, another checkout) as the user's own, naming the clash in one line.
- Beside the home set, it symlinks `~/.playground/factory-settings.json` to `scripts/factory-settings.json`, each brief template in `~/.playground/handoffs/` to its file in `scripts/briefs/`, `~/.playground/brief-rush.md` to `scripts/briefs/brief-rush.md`,
  `~/.bun/bin/playground` and its old name to the `playground` command (`packages/scripts/src/playground/cli.ts`; `playground --help` lists what it does),
  and each ops script it names into `~/.playground/ops/`;
  for the rename it links `~/.playground` to the old data folder where only that exists,
  all pointing into the main checkout, so a pull there updates the factory's hooks and the command.
- Beside its links, `scripts/link-skills.sh` sets `rerere.enabled false` in the checkout's config, which every worktree reads.
  Every worktree shares one `.git/rr-cache`, and git runs rerere wherever that folder exists while the setting is unset, so a merge in one worktree replayed a resolution another had recorded, printing `using previous resolution` over a file its author never read.
  The folder stays in place, and a merge now stops on each conflict for its author to resolve.
  Tests: `bun run test:file tests/scripts/link-skills-settings.test.ts`.

## A worktree's node_modules

- A new worktree can take `node_modules` as an APFS clone of a sibling worktree's with the same `bun.lock` (`~/.playground/ops/run-slot.sh <your name> -- cp -cR <sibling>/node_modules <worktree>/`, through run-slot since a clone is a heavy run: three load spikes on 13 Oct, fseventsd near 100%, came from clones),
  then `~/.playground/ops/run-slot.sh <your name> -- bun install --ignore-scripts --cwd <worktree>`, which fills each package's own `node_modules/.bin` the clone lacks; when the copy prints any error, run `~/.playground/ops/run-slot.sh <your name> -- bun install --force --ignore-scripts --cwd <worktree>` instead,
  since a plain install then looks healthy while check-types fails on a missing module.
  A review worktree that only reads (no test run, no commit) takes no clone at all.
  AGENTS.md has worktrees removed one at a time, since removing several at once drove fseventsd past 300% CPU and the load to 77.

## bun run test:skills

- `bun run test:skills` runs Playground's checks, as CI's `auto-test.yml` does, through `packages/scripts/src/test-skills.ts`: every Python step runs under `uv run --python 3.13` (the system `python3` is 3.9 on a Mac, too old for the skills' Python), every step runs even after one fails, and a red run ends naming each failed step and its first `FAIL` line.
  Each step runs in the suite's sandbox (`packages/scripts/src/sandbox.ts`, shared with `test-sandbox.ts`), with uv's Pythons and cache and Docker's config kept in the real home, so a step never writes the real `~/.claude` and a second run downloads nothing.
  Its `steps` list in [packages/scripts/src/test-skills.ts](../packages/scripts/src/test-skills.ts) names every step.
