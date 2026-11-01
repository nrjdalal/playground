# The factory's hooks

Each Claude Code hook in this folder, in full: what it refuses or writes, for whom, and why.
AGENTS.md names each hook and points here, and this file holds each one's text.
Read a hook's section before you change the hook, its tests or its registration, or when it refuses a call you did not expect.
Widen what a hook allows only by one literal form it reads whole, tracking no shell state (variables, functions, loops, traps), and have it refuse every other form with a reason that names the literal one.
`no-raw-spawn` guards `scripts/spawn.sh`, so its text sits in [the spawn.sh section of scripts/README.md](../README.md#spawnsh).
Their tests are `bun run test:file tests/scripts/hooks`.

## Registered in both settings files

- cmux restores a session after a restart without its `--settings` or `PLAYGROUND_ROLE`, so `.claude/settings.json` registers every PreToolUse hook `scripts/factory-settings.json` does, with the same matcher and the same command string,
  since Claude Code runs a handler defined in both files once only when the two commands match byte for byte (measured on Claude Code 2.1.302: one space apart, it runs twice; `tests/scripts/hooks-abs-path.test.ts` holds every hook in both files to it).
  That one command finds the checkout with no `$HOME` in it: `$PLAYGROUND_REPO`, which spawn.sh's launch exports as its main checkout, else the main checkout git names for `$CLAUDE_PROJECT_DIR` (`--git-common-dir`, so a session in a worktree runs the main checkout's guards); when neither names a folder holding the hook's script, it runs nothing and exits 0.
  A headless scan run from outside the checkout exports `PLAYGROUND_REPO` as the factory's checkout and passes `--settings` naming that checkout's `scripts/factory-settings.json`, so its guards run rather than exit 0: the board scan's loop takes the checkout from `beat.py`'s `checkout()`, the end-of-day scan's `scan.sh` from its own path.
  Three factory hooks act for every session: session-state writes every session's state, since the Dashboard is to show them all, no-off-palette-label guards every session's labels, since the label rule covers any label, and no-desktop-owner-app guards every session's agent-desktop calls, since the owner's pointer and apps are the same whichever session drives them.
  Every other factory hook acts for a factory session alone, `PLAYGROUND_ROLE` or else its name in Claude Code's registry, placed by the roster's `kind` for that name and then by the factory's names (`scripts/hooks/role.ts`), so a session the owner opens in the factory's checkout passes them untouched.
  Claude Code loads project settings from the session's own folder alone, so a factory session restored where they lack the hooks (another checkout, an older one, a subfolder) is respawned with its settings (playbook's SESSIONS.md), and `scripts/ops/up.py --sessions`, which reads each session's command line and its own folder's `.claude/settings.json`, names each one.

## Guard lists

- A guard that reads a list (no-desktop-owner-app's `desktop-owner-apps.json`, no-playground-leak's `playground-terms.json` and `slack-cleared.json`, no-release-comment's `release-owners.json` and spawn.sh's GLM gate's `glm-refused-sources.json`, all in core's `extensions/core/lists/`, and no-public-leak's,
  which only the extensions hold) loads it through `guardList` in `scripts/hooks/lists.ts` inside its check, at every call,
  and fails closed on it:
  on a machine with extensions (its data folder holds `extensions/`) the list comes from `extensions/hooks/<list>.json`, which every list write derives as the union of every scope's `lists/<list>.json` (the login's, each org's, then core's), read by `packages/settings/src/rendered.ts`, and never from this folder.
  A root that lacks the list refuses the guarded call, naming the file and `playground ext import --from-tree extensions/core/lists`, which seeds it, for the owner to type in Ops' pane as a `!` command.
  A factory session writes nothing in the root itself and changes no list or guard setting through the CLI: [no-extensions-write](#no-extensions-write) refuses both, so a list changes only on the owner's own command.
  With no extensions, the list is core's file; with no file either, the guard takes its empty default.
  A list file that is there but empty, malformed or missing a key refuses the guarded call, extensions or not; an explicit empty list (`[]`, or every key empty) is the owner's choice and loads.
  A broken list refuses only the calls its guard checks, so every other call runs.
  `GUARD_LISTS` in `packages/settings/src/rendered.ts` names every guard's list, and a root that lacks one refuses its guard, so a new guard list goes there and into core's `lists/`.
  A shell or Python script reads the set through `bun packages/scripts/src/playground/rendered.ts <file>`: exit 0 prints the path, 2 is extensions that lack the file, 3 is no extensions.
  A shell script that judges by a list of words reads it whole through `bun packages/scripts/src/playground/guard-list.ts <guard> <list>`, which takes `guardList`'s fallbacks and prints the words as JSON, or exits 2 with its refusal, as spawn.sh does for `glm-refused-sources`.
  Its tests are `bun run test:file tests/scripts/hooks/guard-lists.test.ts tests/packages/settings/src/rendered.test.ts tests/packages/scripts/src/playground/guard-list.test.ts`.

## after-compact

- A factory session that has just compacted its context is told what to reread: `scripts/hooks/after-compact.ts`, a SessionStart hook with the `compact` matcher in both `scripts/factory-settings.json` and `.claude/settings.json`,
  adds its instruction (load playbook again, then reread its roster entry, its open Inbox items, its PRs and the decisions register, `.agents/decisions.md`) to the session's context,
  since Claude Code re-attaches a skill after a compaction cut to about 5k tokens or drops it (playbook's **context** rule); the `rules` hook puts the standing rules beside it.
  It says nothing to the owner's own sessions here, fails open, and its tests are in `bun run test:file tests/scripts/hooks`.

## after-resume

- A factory session resumed after a restart is told what the restart took (playbook's **context** rule): `scripts/hooks/after-resume.ts`, a SessionStart hook with the `resume` matcher in both `scripts/factory-settings.json` and `.claude/settings.json`, adds its instruction to the session's context:
  re-arm every background loop and watch it had running and each cron CronList no longer shows, and re-send each message to another session that got no reply in the 10 minutes before its last entry before the restart.
  That time is the newest timestamp in the tail of the transcript SessionStart names, since a resumed process writes no timestamped line before its first input (measured on 2.1.309), and the resume's own time when the transcript gives none; the text names both, since the session may read it hours later.
  Any restart that resumes a session fires it: Claude Code's `--resume` fires SessionStart with source `resume` (measured on Claude Code 2.1.309 through `spawn.sh resume`, where `spawn.sh`'s first start reads `startup`), and the restart ends every background task the old process held.
  A session idle at the restart takes no turn and so never reads the instruction, so `spawn.sh resume` (a herdr restore, a `move`, an account switch, an update's resume records) gives a resume with no `--brief` a first prompt that names the session, whom it reports to when its start recorded that, and has it act on the instruction;
  cmux's own restore passes no prompt: a session it restores where its folder lacks the factory's hooks is respawned through spawn.sh (playbook's SESSIONS.md), and one in the factory's checkout keeps running with the hook's context but stays idle until a message reaches it.
  On 25 Oct an account switch restarted every session: two reviewers lost their workers' round requests, and the ops lead's watches and the dispatcher's login-flip loop died, each found by hand later.
  It says nothing to the owner's own sessions here, fails open, and its tests are in `bun run test:file tests/scripts/hooks`.

## no-bare-slack-link

- ALWAYS: Send every link in a Slack post as a link chip, since a raw URL reads as a mistake in a review ask and a chip is the format the owner reads.
  The factory's PreToolUse hook `scripts/hooks/no-bare-slack-link.ts`, registered beside no-playground-leak (and in `.claude/settings.json`) and acting for a factory session alone (`scripts/hooks/role.ts`),
  refuses a Slack MCP `chat_post_message` or `chat_update` that holds an http(s) URL (in `text`, `markdown_text`, a `text` field of its `blocks`, or any string of an attachment but a field whose name ends in `link`, `url` or `icon`; `<url|label>` and backticks included) that no link chip in its `blocks` carries, and its reason gives the chip to send.
  A chip is a `link` element in its full shape, `{"type":"link","url":"<url>","text":"<url without its scheme>","truncated":true}`, since one with only a `url` draws the raw URL, so a `link` element in any other shape, labelled or url-only, is refused too, even beside words that name no URL.
  It fails open on a call it cannot read, as on a hook that cannot start or times out.
  Its tests are in `bun run test:file tests/scripts/hooks`.

## no-chat-question

- The dispatcher and the leads run the inbox gate, the Stop hook `scripts/hooks/no-chat-question.ts`, since a question asked in chat with nothing in the Inbox is one the owner can miss; it is registered with one command in `.claude/settings.json` and `scripts/factory-settings.json`, so a session loading both runs it once (the same command string in both, as the cmux restore line says).
  It acts for `PLAYGROUND_ROLE` `dispatcher`, `lead` or `manager`, else for a session with no role whose name in Claude Code's registry (`$CLAUDE_CONFIG_DIR/sessions/<pid>.json`, matched by the hook input's `session_id`) has a manager's kind in the roster (builder, ops, planner, optimizer or dispatcher, through `rosterRole`)
  or else is a manager's name in the `sessions.names` setting or an old name `sessions.aliases` maps to a manager's kind,
  read through `roleOfName` in `scripts/hooks/role.ts`; workers, checkers, runners and probes report to a lead, so it passes them.
  When the final reply asks the owner for a decision, it refuses the stop with `name the open #iN on the same thing if one exists (bun run ask open lists them), else post it with bun run ask new, then say in chat that it's in the inbox as #iN`, so a session reuses the item already posted (a lead once posted a duplicate of the dispatcher's),
  as `additionalContext` with exit 0 so no Stop hook error shows, on every stop that still asks, `stop_hook_active` included (Claude Code's cap on continuations in a row with no tool call between them bounds it),
  since playbook's **ask** rule keeps his decisions out of chat.
  A decision ask is, in any case and with curly or straight quotes, a `?` closing a sentence (a heading's included), or "can we", "do you want", "if you (still) want", "if you'd rather", "is yours to", "let me know which", "one word answer", "say" told to him and a quoted word (`Say "ship now"`), "say go" or "say yes",
  each "say" opening a line, a bullet, a sentence or a clause (past one of "first", "now", "simply", "so" or "then"), or after "and", "or", "just" or "you" with a modal, never a third person's (``The PR will say `Refs #1` ``), "settles it", "shall I", "should I", "should we", "tell me if", "want me to", "which do you",
  "your call" or "your pick"; code, a blockquote, a double-quoted span (but for the word after a "say" told to him, quoted or in backticks, as in `Say "go"`),
  and the prefix and first sentence (ending at `.`, `?`, `!` or `;`) of a line saying who asked (`A colleague asks:`, `A colleague asks in Slack:`, never `I` or `we`, whose words are the session's own) or addressed to an agent or saying one was asked (`@K3m9px-worker,`,
  `k3m9px-worker:`, `To k3m9px-worker:`, `Sent k3m9px-worker:`, `I asked k3m9px-worker:`, `Asked worker-brave-otter:`,
  and a roster name as chat names it, its role word dropped (`Asked plain-fern:`, `k3m9px,`), so a word no session holds (`well-known`) or a role label (`Ops:`) still counts, bold marks read through; a bulleted `- k3m9px-worker:` is a status line and exempts nothing; a handle `owner.names` lists is the owner, not an agent) are left out, so an ask after them on the same line still counts.
  A request for the owner's own action is an ask too, since it belongs in the Inbox as a decision does: "could you", "is waiting on you" (whole, so `Waiting on your inbox` passes, and not after no one, nobody or nothing), "only you can" (not "can't", nor before access, open, read, see or view), "please" (alone, so `#projects-status-eob-please` passes), "when you can" (not "can't"),
  "when you get a chance", "you have to", "you must", "you need to", "you'll need to" or "you will need to" (none of these after anything, if, nothing, what or whatever, so `Nothing you need to do` passes), or "<verb> it yourself" (not a verb in -ed, nor did, made, ran, saw or wrote, nor directly after "you can"),
  and a line addressed to the owner by a name or handle `owner.names` lists (`<owner>,`, `<owner>:`, `@<owner>:`, a bulleted `- @<handle>,`; a bulleted `- <owner>:` is a label),
  none while the key is unset, that goes on with a verb asking them to act, from a short list in the hook (add, approve, paste, plug, press, run, switch and the like), so `<owner>, quick update: canary is green` passes; the same parts are left out.
  An optional pointer, which leaves him free to skip it, is left out too: "if you (still) want to" before check, look, read, see, view or watch (`The shots are on the PR if you want to look`), and, in a sentence of a bare "you can" (not after only or when, and not "can't"), "<verb> it yourself" directly after it and an "if you (still) want" closing it at `.`, `!` or the line's end,
  neither arm taking an "if" later in a clause (up to `,`, `.`, `?`, `!` or `;`) that opens with "ask me", "let me know", "need to know", "say" or "tell me", or with us for me (`Tell me in chat if you want to see it.`)
  (`You can withdraw it yourself with npm deprecate if you want.`), so every other ask in that sentence still counts (`You can say yes and it ships.`).
  Chat answers his current question, and anything promised to him for later, or a later outcome of something he asked, reaches him as an Inbox update (playbook's **ask** rule: the Inbox carries everything past the current answer, a later update on a past ask included).
  A reply naming an `#iN` passes once one of the first five items it names reads `open` through `bun run ask get` in the live dashboard's checkout (the worktree on `live.branch`, found with `git worktree list`, killed after 3s).
  The reads run at once, each killed after 10s (one took 5.9s under load), and the first to read open passes the stop at once and ends every read still running.
  When no named item reads open, one it cannot read included, the reply fails closed, the reason saying what each item read as.
  It judges the hook input's `last_assistant_message`, since the transcript can lag the turn's last message (ADR 0001), and fails open on an input it cannot read, as a hook that cannot start or times out does.
  Its tests are in `bun run test:file tests/scripts/hooks` too.

## no-desktop-owner-app

- agent-desktop runs headless and leaves the owner's own apps alone: `scripts/hooks/no-desktop-owner-app.ts`, registered beside no-headless-login and acting for every session, refuses an `agent-desktop` call that carries `--headed`, since headed input moves the owner's own pointer and focus.
  It also refuses one that targets an app on the `desktop-owner-apps` guard list ([Guard lists](#guard-lists)): an `--app` value, or a `launch` or `close-app` target, matched without case and with or without `.app` or a path before it.
  Core's list is empty, and the owner's login extension holds the owner's apps, which change only by the owner's own `!` command, which Ops prepares.
  It reads the list and nothing else, so no flag, environment variable, `export`, `env` or write in the same call frees a call.
  The list changes only on the owner's own command, since [no-extensions-write](#no-extensions-write) refuses a session's edit of it in any call; a session that runs agent-desktop under another name breaks the rule, which a text hook cannot see.
  Its refusal names the two ways out: the owner runs the command with the `!` prefix in the owner's own pane, which runs outside the hooks, or takes the app off the list with a `!` command Ops prepares.
  It refuses what it cannot read, as a call that may hide either: a word built from a variable or a substitution, the program in a variable in a call that names agent-desktop, arguments xargs appends, `batch`, `--window-id`, `notification-action`, an interpreter's code that names agent-desktop, and a script file run in a call that names agent-desktop.
  A command that acts on the app in front when no `--app` names one (`snapshot`, `find`, `screenshot`, `press`, the window and notification commands) needs an `--app`; `snapshot` and `find` under a `--root` ref, and every ref action, pass, since the snapshot that gave the ref was checked.
  It reads agent-desktop behind `bash -c`, a pipe into a shell, `env` and the other wrappers `scripts/hooks/shell.ts` knows, `run-slot.sh --`, `npx`, `bunx` and `find -exec`, and a script file the call runs, by its text.
  It loads the list only for a call that runs agent-desktop, and fails closed on it, its refusal naming the file and Ops, whose list write fixes it; it fails open on a call it cannot parse.

## no-env-dump

- A factory session never prints its environment: `scripts/hooks/no-env-dump.ts`, registered beside no-stash, refuses an `env` with no command (`env`, `env -0`, `env FOO=1`), `printenv`, a bare `set`, and a bare `declare`, `export` or `typeset`,
  since the environment holds tokens and the output lands in the transcript (13 Oct: a planning subagent's `env` printed this machine's GitHub and Slack tokens).
  `env VAR=x <command>`, `set -e` and `export VAR=x` run.
  It fails open, and its tests are in `bun run test:file tests/scripts/hooks` too.

## no-extension-repo-write

- A factory session changes no extension repository's git data or name: `scripts/hooks/no-extension-repo-write.ts`, registered beside no-public-leak, refuses such a write, since `ops:ext-sync` renders each one's `main` into the extensions root every guard reads.
  Its repositories are each `ext.repos` value in the root's `policy.json`, each scope clone's `origin`, which follows a rename, and `<login>/playground-<scope>` for each scope clone `ext.repos` does not name, under `PLAYGROUND_LOGIN` and the root's `login` file both, matched in any case and with percent escapes decoded, as GitHub decodes them.
  It reads every write through no-playground-leak's engine with `anyWrite` set (`inspectAs`), which refuses a write to one of them whatever its text, and a write whose target it cannot place.
  Those writes are a `git push`, `send-pack` or `subtree push`, a git alias expanded from its config, a gh or `gh api` write, a curl to one on `api.github.com` or `github.com` (a read included), and a GitHub MCP write.
  Its gh writes include a DELETE, `gh pr merge` and `update-branch`, the publish-step group's `create`, `delete`, `edit` and `upload`, and `gh repo edit`, `rename`, `delete`, `archive`, `unarchive` and `sync <destination>`.
  It reads a push's target as git does: each push URL of the remote named, `--repo`'s value when none is named, else each push URL of every remote and each URL `remote.pushDefault`, `branch.<b>.pushRemote` or `branch.<b>.remote` holds.
  It reads a `gh api` endpoint and a curl URL where the request lands: dot segments resolved, `{owner}`, `{repo}`, `:owner` and `:repo` filled from the checkout, and curl's host and path read as a URL reads them, `uploads.github.com` with `api.github.com`.
  It cannot place, so refuses, a curl glob (`{…}`, `[…]`) on a GitHub host without `-g`, and a curl beside a word naming GitHub with a `Host` header, `--connect-to`, `--request-target` or `--resolve`.
  It reads that state when it checks the call, so after an earlier command in the same call changes it, it cannot place a push, an alias run or a write gh places by the checkout, and refuses it with the fix: run the setup in a call of its own first.
  Those changes are a `git config` write, `git remote add`, `remove`, `rename`, `rm` or `set-url`, `git clone`, `init` or `submodule`, `gh repo clone`, `fork` or `set-default`, `gh config set`, and any other command naming a `.git` path or a git config file.
  A config file it reaches only through `include.path` or a link, written in the same call by a command that names neither a `.git` path nor a git config file, is outside its reach.
  It cannot place, so refuses, a push with `-c`, `--config-env`, `--git-dir` or a `GIT_` variable in the call, a literal URL an `insteadOf` or `pushInsteadOf` prefix matches, a remote whose URL is a local path, a `!` alias, an alias `-c` sets, `gh alias set` and `import`, and a REST write to `repositories/<id>`.
  It refuses a repository made or renamed at one of those names, `*` standing for the account gh picks itself, and a name it cannot read counts as one.
  Those are `gh repo create` (its name or its `--source` folder's), `rename` and `fork --fork-name`, `gh api`'s repo PATCH with a `name`, `generate`, `transfer`, `forks` with a `name`, `user/repos` and `orgs/<org>/repos`, and MCP `create_repository`.
  Issue and pull request conversation passes, since the sync reads only `main`: `gh issue` and `gh label`, `gh pr create`, `comment`, `edit`, `review`, `close` and `reopen`, `gh api` on `issues`, `labels` and `pulls` but a pull request's `merge` or `update-branch`, and the matching MCP tools.
  A commit is refused only in a clone of one of them, and every call passes on a machine with no extensions root.
  Its refusal names the one route: the owner types the command in Ops' pane as a `!` command; no flag, environment variable, role or note frees a call.
  It fails closed, as the leak guards do and only on a call that may write, when `policy.json` does not read or no login names the default repositories.
  Outside its reach are a program whose own code pushes or calls the API (a script by its path, `bun run`, a binary), a fork that keeps its source's name, and a gh alias set before it.
  A GraphQL mutation, which names its repository by node id, and a curl whose URL the run computes are refused only when their text names one of the repositories; a URL in a curl config file (`-K`, `~/.curlrc`) and a redirect a server answers with (`-L`) are unread.
  An `ext.order` name with no clone and no `ext.repos` entry is not guarded, and the sync does not push it either.
  Its tests are `bun run test:file tests/scripts/hooks/no-extension-repo-write.test.ts`.

## no-extensions-write

- A factory session changes nothing a guard reads to allow or deny a call: `scripts/hooks/no-extensions-write.ts`, registered beside no-main-checkout on Bash and the file tools (Edit, MultiEdit, NotebookEdit and Write), guards the extensions root (`extensionsDir` of the data folder) and every file under it.
  Each guard reads its list and `policy.json` there, each scope's `lists/` and `settings.json` render into them on the next write (its `git add -A` takes a hand edit along), and a root that is gone sends the guards back to core's smaller lists.
  It refuses a file tool's path in the root, `~` expanded, and a redirect into it, a group's, a subshell's, `exec`'s, a shell's, `eval`'s, `source`'s, `.`'s, `cd`'s, `pushd`'s, `popd`'s or a bare one included, and zsh's `>!` and `>>!` with them.
  It refuses any program but a reader that names the root, a path in it, a folder above it (`~/.playground`, `~`) or a glob there (`*`, `?`, `[…]`, `{…}` or zsh's `(…)`, in a redirect's target too), links followed, in any word: the program word, an option's attached value (`-o<path>`, `--out=<path>`), a variable the call sets (`GIT_DIR=<clone>`), or the stdin xargs hands it.
  It refuses any program but a reader whose words or heredoc hold the root's path as text, whole or as seen from a folder above it the command runs in, so an interpreter's script and a commit message that names it are refused alike, as is a commit message or an inline body that names a gated call (`playground ext sync`); write such text to a file and pass the file.
  The readers are `[`, `cat`, `cmp`, `diff`, `echo`, `grep`, `head`, `jq`, `ls`, `printf`, `readlink`, `realpath`, `shasum`, `stat`, `tail`, `test` and `wc`;
  `rg` with no `--hostname-bin` or `--pre`; `find` with no `-delete`, `-exec`, `-execdir`, `-fls`, `-fprint`, `-fprint0`, `-fprintf`, `-ok` or `-okdir` action; and git's `blame`, `cat-file`, `diff`, `grep`, `log`, `ls-files`, `rev-parse`, `show` and `status` with no `-c`, `--config-env`, `--exec-path`, `--ext-diff`, `-O`, `--open-files-in-pager`, `--output` or `--textconv`.
  A reader run with `EDITOR`, `GIT_*`, `LESSOPEN`, `PAGER` or `VISUAL` set in the call is judged as any other program, since each makes it run one.
  For any program but a reader, each text that holds a space (a word, the value after its `=`, an option's attached value, a variable the call sets or exports) is judged as a command line of its own, a leading `!` dropped, since a program may run it (`watch`, `tmux`, `ssh -o ProxyCommand`, `rsync -e`, a git alias, a pager).
  It refuses any program but a reader run with the root as its folder or, for git, its tree.
  It refuses the `playground` CLI's calls that change what a guard reads, the CLI found by where its word lands: `playground` by name in any case, or by a path that is no folder, or the checkout's `cli.ts` with or without its extension, as any word of a command but a reader's, so behind any wrapper (`bun`, `npx`, `find -exec`, `arch`, `watch`),
  its words followed by the stdin xargs hands it or carried in xargs' `-I` string.
  Its words split as that command's own parse splits them (`--dry-run` and `--yes` are bare for `ext`, `--dry-run` alone for `settings`):
  `ext put <scope> list`; `ext add`, `import`, `init`, `link`, `order`, `remove`, `sync` and `unlink`, but `--dry-run` on `add`, `import` and `init`; `migrate`; `uninstall --purge`;
  and `settings set` or `reset` of a key a guard reads: `ext.links`, `ext.order`, `ext.repos`, `factory.archiveRepo`, `factory.publicRepo`, `glm.readOnlyLoad5`, `live.branch`, `owner.names`, `paths.codeRoot`, `sessions.aliases`, `sessions.names` and `usage.keychainService`.
  A test holds that list to every key a hook names, to `ext.order`, which orders the extensions every guard reads, and to spawn.sh's `paths.codeRoot`; spawn.sh's `gates.*` stay open, as capacity tuning Ops adjusts in normal upkeep.
  A command, verb, kind or key word it cannot read, or any such word among the words of `ext put` or `settings set` or `reset`, counts as the write.
  `ext put` of a doc, a rule or any other reviewed kind, every read, `ext score`, `accept` and `reject`, `settings set` of any other key, `settings import-jobs` and writes elsewhere in the data folder (handoffs, the roster) run.
  Its refusal names the one route: the owner types the command in Ops' pane as a `!` command, which runs without hooks; no flag, environment variable, role or note frees a call.
  It reads every command `scripts/hooks/shell.ts` finds: one inside a `$(…)`, a `${…}`, a `$((…))` or an array assignment's `(…)`, and the script a shell, `source` or `.` reads from a process substitution, a group's output or `/dev/stdin`, every command that prints part of it included, and the parts it can read of a script it reads only in part (a group holding a `curl`).
  It judges each command line and each word once per call, so a deep nest or a long list of variables ends well inside the hook's timeout, and it refuses, each time naming the fix (split it into shorter calls), a call whose lexing or walk runs past 10 s
  (a deadline checked at every lex, expansion and walk step, its clock read once every 1024 steps, so any slow route is refused), a command over 128 KB, whose lexing could outlast the timeout, one nested too deep for its stack, and a chain of scripts a shell,
  `eval` or `source` reads 256 or more deep, and such a script over 128 KB, or over 1 MB as text a command printed or wrote in the call, which it holds as unknown elsewhere.
  It runs its check in a Worker (`scripts/hooks/no-extensions-write-worker.ts`) and refuses from the main thread when the Worker has not answered in 12 s, so a single step the deadline cannot interrupt (a regex, a copy) cannot hold it past its 15 s timeout; this costs about 10 ms a call.
  It reads `env -C<dir>` and `env --chdir=<dir>` as the folder the command runs in, as it reads `env -C <dir>`.
  It reads a command's text, so a program whose own code writes the root (a script file run by its path, a binary) and a path it cannot read (built at run time, in a `$(…)` or a variable) pass it.
  A write to a scope's GitHub repository, which `ops:ext-sync` renders into the root, is outside its reach too; [no-extension-repo-write](#no-extension-repo-write) refuses one.
  A path through a link into the root with `..` after the link (`echo x > <link>/../f`) is judged as typed, so a write by one passes.
  A `cd` or `pushd` it cannot follow (`cd -`, `cd ~-`, `popd`'s stack, a glob in the folder, a `CDPATH` lookup) leaves the command's folder unread, so a relative write after one passes.
  From a cwd at or above the root (`~`, `~/.playground`), a quoted `(`, `[`, `*`, `?` or `{` reads as a glob there, so a call holding one (`git commit -m "fix(x): y"`) is refused; run it from a worktree.
  It fails open on any other error, and its tests are in `bun run test:file tests/scripts/hooks/no-extensions-write.test.ts`.

## no-false-green

- A factory session's test run keeps its own exit status: `scripts/hooks/no-false-green.ts`, registered beside no-stash, refuses bun with an option given its value as the next word (`--cwd <dir>`, `--env-file <file>`, `--preload <file>`) before its `run` or `test` (bun then prints its usage and exits 0, or runs package.json's `test` script with the paths appended in place of the tests;
  `--opt=value` there, as `bun --cwd=<dir> run test:file <files>` and `bun run --cwd <dir> <script>` work), and a test run (`bun test`, a `test` or `check-types` script, vitest or jest, pytest, ty or ruff, bare, through `uv run`, `uv tool run`, `uvx` or `python -m`,
  through run-slot.sh or a shell's `-c` too) piped into another command while the script holding the pipe sets no `pipefail` and reads no pipe status of its own shell (`PIPESTATUS` in bash, `pipestatus` in zsh, the Bash tool's shell here; a pipefail outside a `bash -c` script never reaches the pipes inside it),
  since the pipeline's exit is its last command's (a red test once read 0 through `| tail`).
  A run-slot call, typed bare or as a shell's script (`bash <path>/run-slot.sh <who> -- <command>`, `shellSlot`), is read as the words after its `--` (`slotWords` in `scripts/hooks/shell.ts`, shared with no-glm-heavy-path and no-main-checkout), and a call with no `--`, or nothing after it, runs nothing (run-slot exits 2 on it), so nothing in it is judged.
  A piped subshell or brace group, `(bun test x) | tail`, is not read.
  It fails open, and its tests are in `bun run test:file tests/scripts/hooks` too.

## no-glm-heavy-path

- A factory session on GLM keeps off the Opus paths: `scripts/hooks/no-glm-heavy-path.ts`, registered beside no-stash, refuses a `git commit` whose files (the staged ones, plus every tracked change under `-a` or `--all` and each path it names) or a `git push` whose commits the remote lacks (`git log <sources> --not --remotes=<remote>`, every remote when it names none,
  a URL or one not fetched yet) touch a path in its `OPUS_PATHS` (`.github/workflows/`, `lefthook.yml`, the `pr-merge` and `verify` scripts, `scripts/hooks/`, `scripts/spawn.sh`, `web/next/`), naming the files and the fix: report to your lead, who moves the change to a Claude worker.
  Concluding a merge, a file counts when it differs from HEAD and from every commit `MERGE_HEAD` lists, or when one of those sides changed it since its merge base and the result does not take that side's copy;
  a push reads each merge commit's own changes (`--diff-merges=dense-combined`) and, for each parent after the first, the files that parent changed that the merge does not take, so a `merge -s ours` counts too.
  It reads the checkout before the call runs, so a commit chained after `git add` or a git read also counts every change on disk, untracked files included (and ignored ones under the paths a `git add -f` names, the whole checkout for a magic pathspec), each path read NUL-separated so git's quoting never hides one,
  an Opus file found there but not staged getting the chain's fix rather than the lead's, and a commit chained after any other command, or a push chained after any command, is refused with the fix: run it as its own call.
  `cd`, `export` and assignments never chain, nor do `cat`, `date`, `echo`, `printf`, `pwd` and `true` with no redirect that writes, so a commit message built by `$(cat <<'EOF' ... EOF)` reads as the commit alone.
  A push whose ref is a whole `$(git branch --show-current)` or `$(git rev-parse --abbrev-ref HEAD)` in the same checkout pushes HEAD, and any other ref built at run time gets the fix: name it literally.
  A commit or push run through `run-slot.sh`, typed bare or as a shell's script (`bash <path>/run-slot.sh <who> -- <command>`, `shellSlot`), is read as the words after its `--` (`slotWords` in `scripts/hooks/shell.ts`, shared with no-main-checkout and no-false-green), a `bash -c`, `eval` or `cd` there followed as anywhere else.
  While load5 (`os.loadavg()[1]`, the third field of `sysctl -n vm.loadavg`) is over the `glm.readOnlyLoad5` setting (15 by default, read at each call) it also refuses any install, node_modules clone, commit or push, its reason naming the load and the rule: a GLM session goes read-only while load5 is over that limit.
  An install is `bun`, `npm`, `pnpm` or `yarn` `install`, `i`, `it`, `install-test`, `cit`, `install-ci-test`, `add`, `ci`, `up` or `update` (and `upgrade` but for `bun upgrade`, which updates bun itself).
  It is also a bare `yarn` (not `-v`, `--version`, `-h` or `--help`), `yarn global add` and `yarn workspace <name> add`, `uv sync` or `add`, `uv pip sync`, or a `pip` (`pip3`, `pip3.12`), `pipx`, `uv pip`, `uv tool` or `python -m pip` `install`, each also through `uv run` and past uv's own options.
  A clone is `cp`, `ditto` or `rsync` naming a `node_modules` folder or its contents (`node_modules/`, `node_modules/.`, `node_modules/*`), read as run-slot.sh reads `cp`'s.
  An Opus path's refusal comes first, since that change moves to a Claude worker whatever the load.
  A session is on GLM when its `ANTHROPIC_BASE_URL` points at `api.z.ai`, or when the backend pin spawn.sh keeps under its registry name reads `glm`; a Claude session commits those paths as before.
  It fails closed only on a call that reads as a git commit or push, or over that load as an install or clone (one whose directory, paths or refs it cannot read, or whose input does not parse), and passes every other call.
  Its tests are in `bun run test:file tests/scripts/hooks` too.

## no-headless-login

- A factory session's headless `claude -p` (or `--print`) runs on the session's own account and carries its role: `scripts/hooks/no-headless-login.ts`, registered beside no-stash and acting for a factory session alone (`scripts/hooks/role.ts`), refuses one whose command sets no `CLAUDE_CODE_OAUTH_TOKEN` for it, as a prefix, through `env` or by an `export` earlier in the command,
  since spawn.sh hands the token to the session's own `claude` alone, so a child started from its Bash shell bills this machine's own login (21 eval runs billed an account paused at 98%).
  It also requires `PLAYGROUND_ROLE` in the command when the session's role came from its name in the registry rather than its environment (a session cmux restored), since a run with no role passes every role-gated hook (a headless Slack post sent a url-only link no-bare-slack-link let through).
  The role rides the environment rather than a match on the run's folder: a child inherits its parent's environment wherever it runs, while a folder match would also catch a session the owner opens there.
  The role reaches the factory's hooks where the run loads them, inside the factory's checkout, whose `.claude/settings.json` registers them; a run started in any other folder loads none of them.
  Its reason gives the shape, with the account read from the session's resume record (`~/.playground/resume/<name>.sh`, its `# account:` line, else its `--account`), and the Keychain service from the `usage.keychainService` setting, `playground-claude-oauth` while the policy sets none.
  A command that only names `claude -p` (in `echo`, `grep` or a heredoc's body) runs, and so do `claude` without `-p`, `--resume` and `--version`.
  It fails open, and its tests are in `bun run test:file tests/scripts/hooks` too.

## no-kill-by-name

- A factory session signals only processes it started, by their own handle (the **signal** rule): `scripts/hooks/no-kill-by-name.ts`, registered after no-headless-login, refuses `pkill`, `killall` and `fuser -k`, <!-- kill-check: names only -->
  and, in a call that searches with `pgrep`, `pidof`, `lsof`, `fuser` or `ps` (but `ps` given a pid by `-p`, `-q`, `--pid` or `--quick-pid`), a `kill` run by xargs or given a pid the hook cannot read, in a chain, a pipe, a loop, a group or `sh -c` alike,
  since a name, pattern or port matches the live dashboard and every worker's stack (31 Oct: a session ran `pkill -f` on its own watcher, and only `tests/test_kill_by_name.py`, which reads the repo's text, guarded it). <!-- kill-check: names only -->
  It reads the whole call for a search before it judges a kill, since a loop's `done < <(pgrep …)` comes after the kill it feeds, and it reads the `-I` string xargs hands a shell it starts as such a pid.
  Its reason gives the way out: `TaskStop` for a background task, `bun run dev:stop` for a dev stack, `kill <pid>` for a pid the session spawned and holds, in a Bash call of its own when the call also searches.
  `kill <pid>`, `kill -<sig> <pid>`, `kill $!`, `kill %1`, `kill $(cat <pid file>)` and a liveness check before it (`ps -p $PID && kill $PID`) run in a call that searches nothing else, and so do each search alone (`pgrep -f x`, `lsof -i :3000`), `command -v pkill` and `pkill --help`. <!-- kill-check: names only -->
  It fails open, and its tests are in `bun run test:file tests/scripts/hooks` too; `tests/test_kill_by_name.py` skips the hook and its test, which hold the refused commands as data.

## no-playground-leak

- ALWAYS: Keep the factory out of every ticket, PR, commit, branch, comment, Slack message or DM, and file in a guarded org's repo: playbook's **classified** rule, since the factory is the owner's own and stays out of the org's records in any shape.
  Every factory session is spawned with `--settings ~/.playground/factory-settings.json` (playbook's SESSIONS.md), the file `scripts/link-skills.sh` links to `scripts/factory-settings.json`,
  which registers the PreToolUse hook `scripts/hooks/no-playground-leak.ts` wherever the session works (`.claude/settings.json` registers it too, for a session cmux restores in the factory's checkout).
  It refuses a write to a guarded org's surface whose text holds a factory term (a name, an old session name, which a scope's own copy adds, a path, a `<role>-<sin>` session or a `probe-<sin>` or `probe-<role>-<sin>` probe from `extensions/core/lists/playground-terms.json`,
  its sins the seven words alone so `worker-pool` and `probe-path` pass, any skill's name in the checkout's `skills/` bucket folders,
  or any agent's name in the roster, both read on every call since skills are added and sessions renamed, leaving out one the file's `everyday` list names, such as `builder`, an org's own name, which its extension's copy adds, or `pr`, the public skill copied from upstream whose name is the word for a pull request, and adding none when the roster is missing or does not read;
  each matched whole in any case, with `_` and `-` counting as edges, so `PLAYGROUND_ROLE` holds one and `the dashboard` does not):
  a Linear or Slack MCP tool that is not a read, a GitHub MCP write whose owner is a guarded org, a `gh` write (pr, issue, label, release, a non-GET `gh api`) or curl to Linear, Slack or a guarded org's repository, and `git commit` or `git push` in a guarded org's checkout, judged by its message, its branch and the messages of the commits the remote does not hold.
  The guarded GitHub orgs are the ones the `ext.links` setting links (`guardedOrgs` in `packages/settings/src/ext.ts`), read from the data folder's policy at each call, so a machine with no extensions guards Linear and Slack alone, and a policy it cannot read refuses a writing call with the fix.
  It also refuses a guarded org's write whose text it cannot read, refuses a write it cannot place (a pull request number in a variable, a GraphQL mutation) only when its text holds a term, and passes every other write, the factory's own repository's included.
  Unlike those, a `gh` write whose repository the hook cannot place is refused whatever its text, since that repository may be a guarded org's, and its refusal names `--repo <owner>/<name>` as the fix.
  It cannot place one naming its repository through a value it cannot read (`-R $R`, `GH_REPO=$R`, `gh api repos/$R/...`), or naming none (no `-R`, `GH_REPO`, pull request URL or literal `repos/<owner>/<name>` endpoint) from a directory the hook lost (after a `cd`, `popd` or `env -C` it cannot follow).
  Each Bash refusal of a value it cannot read names the fix, that value given literally in a call of its own, and says none of the call's commands ran, since a refusal stops the whole Bash call.
  The literal values are text the Write tool wrote to a file first, named by its literal absolute path, `gh -R <owner>/<repo>`, the pull request number or URL, `git -C /abs/checkout`, the URL itself, and a REST endpoint naming the repository in place of a GraphQL node id.
  It also passes a Slack write to a conversation the owner cleared for factory talk, the factory's channel and the 1:1 DMs the owner names, listed by id in an org's extension's `slack-cleared.json`, since core's (`extensions/core/lists/slack-cleared.json`) is empty:
  a Slack MCP chat posting tool (`chat_me_message`, `chat_post_ephemeral`, `chat_post_message`, `chat_schedule_message`, `chat_update`) whose `channel` is one of them and that names no other destination key (any key but `channel` holding channel or conversation, such as `channel_id` or `channels`).
  The claude.ai Slack connector's `slack_send_message`, under any Slack server name, is cleared for a channel whose entry names a `signature` alone, its `channel_id` and `message` read as `channel` and `text` are, so its signed post to the factory channel passes and its post to a cleared DM is judged as before.
  Curl to Slack is never cleared, since its data would have to be parsed exactly as Slack parses it, so curl to a cleared DM is judged as before.
  In a channel whose entry names a `signature` (the factory channel's `_Sent via Playground_`), a post passes only when its `text`'s last line is that signature and it has no `attachments` or `markdown_text` (which Slack shows in place of the text),
  and `blocks` only as link chips, every link that can be one (`chipsSigned()`): an array, or its JSON text, of `rich_text` blocks whose `rich_text_section` elements hold `text` and `link` elements alone, the last line one italic `text` element reading `Sent via Playground`, a link's label and url passing terms as the text does;
  it is refused otherwise, a post with no text included, since it goes out through his Slack account; curl that writes (sends data without `-G`, or calls a `chat.*` method) and whose URL or data names that channel is refused outright, while a read of it passes.
  Every other channel, thread, group DM and DM, and a write whose channel it cannot read, is judged as before.
  A Slack upload from a path that holds a factory term (the scratchpad folder's name does) is refused, so copy the file first to `/private/tmp/claude-501/<topic>/`, a `<topic>` that names no session and holds no term.
  A hook that cannot start or times out lets the call through, and its two lists are read as [Guard lists](#guard-lists) says.
  It shares `scripts/hooks/shell.ts` and `scripts/hooks/github.ts` (the repository resolver) with the other hooks, and its tests are in `bun run test:file tests/scripts/hooks`.

## no-public-leak

- ALWAYS: Write each public repository's pull requests, issues, reviews and comments in plain words, naming no person, company or private record, since everything written there is public once the repository is and stays cached after.
  `scripts/hooks/no-public-leak.ts`, registered in both settings files, refuses a write to a public repository (`factory.publicRepo`, one or a list, or while unset `TODAY_PUBLIC` in trace-count's `kinds.ts`, the factory's and Yard's)
  whose text holds a name, a handle, a company term, a Slack id or a Linear key from its list, or any email address, `LM-<n>` key or link into the archive repository (`factory.archiveRepo`).
  An extensions root whose policy.json it cannot read for those two refuses the write, as a list it cannot trust does.
  Its reason names the kind and the plain-words fix, never the text.
  It reads every write through no-playground-leak's engine (`inspectAs` with its own `Policy`), so the shapes it reads are that guard's gh, `gh api`, curl and GitHub MCP writes; git commits and pushes, Linear and Slack are outside it.
  Each public repository's own name, which holds its owner's handle, is read past.
  Its kinds are `packages/scripts/src/trace-count/kinds.ts`, which the trace ratchet counts too, and its list is read as [Guard lists](#guard-lists) says; on a fresh clone with no list, the list-free kinds still refuse.
  Its tests are `bun run test:file tests/scripts/hooks/no-public-leak.test.ts`.

## The trace ratchet

- ALWAYS: Write a new comment, doc or test in plain words, with no issue number (`#NNN`, `LM-<n>`) or old session name: the number belongs in the commit scope and the pull request body.
  `bun run trace-count` counts each kind in `kinds.ts` over the tree (git's files, or every file but installs and build output where no `.git` is), past the live names `LIVE_NAMES` keeps for the switch's migration.
  Its `ownerName` kind counts the owner's names (`owner.names`, then the owner part of `factory.archiveRepo`, read from the settings at run time), a quote set against the owner and anyone's dated quote; `companyName` counts the company's name, and `lightWords` a factory or old skill word glued into a longer one.
  It reads past the lockfiles too (`bun.lock`, `package-lock.json`), whose integrity hashes can spell a list value by chance.
  It fails when a count is over `packages/scripts/src/trace-count/counts.json`, and so does `tests/packages/scripts/src/trace-count/count.test.ts`, which `bun run test` runs and pre-commit's `trace-count` step runs on every commit but one of images and fonts alone, over every tracked and untracked file as it stands on disk, staged or not; `--write` lowers each count a trace-out brought down.
  It exits 2, naming the fix, when no-public-leak's list (`extensions/hooks/no-public-leak.json` in the data folder) is missing or a key of it is empty, or when `owner.names` or `factory.archiveRepo` is unset, since those kinds would count nothing; the test counts the kinds that read neither alone.

## no-linear-ticket

- ALWAYS: File a new Linear ticket only after the owner's yes, and keep the factory out of Linear and out of every guarded org's ticket, PR, commit, branch, comment, Slack message or DM, and file in its repo: playbook's **tickets** rule, since the factory is no project of the org's and stays out of its records in any shape.
  A session started with `PLAYGROUND_ROLE` set (every factory spawn, playbook's SESSIONS.md), or with no role but a factory name in Claude Code's registry (`scripts/hooks/role.ts`, for a session cmux restored), runs the PreToolUse hook `scripts/hooks/no-linear-ticket.ts`, registered in both settings files and in the ticket skill's and playbook's frontmatter,
  so it also runs in a guarded org's checkout whose session loads either; without the variable or a factory name it allows everything, so the owner's own sessions file freely.
  It refuses a call that files a new Linear ticket (`save_issue` with no `id`, a Linear server's create-issue tool, a GraphQL `issueCreate` or `issueBatchCreate` sent by curl, by `gh api` to a URL off GitHub, or by inline script code) unless `ticket-approvals/<team>-<UTC date>.json` in the data folder names its title;
  a GraphQL create is refused even then, since its `teamId` matches no approval.
  Only the dispatcher's refusal names that path and the approval's shape, `{"ask": "<the Inbox decision's id>", "titles": ["<title>"]}` adding each title approved for that team that day, so the dispatcher writes the approval from its refusal.
  Its `<team>` is the team as `save_issue` names it, lowercased with each run of other characters one hyphen (`AI Platform` is `ai-platform`).
  Any other role is refused a Write, Edit, MultiEdit or NotebookEdit into that folder, or a Bash command with a word that names a path in it; an interpreter's code that builds the path itself is not read.
  It fails closed on any call that reads as filing a ticket, a Linear API call whose body it cannot read included, and a hook that cannot start or times out lets the call through, so it never blocks every call.
  The refusal of a body it cannot read names the fix, the query written with the Write tool first and named by its literal absolute path in a call of its own (`curl -d @/abs/query.json`, `gh api --input /abs/query.json`), and says none of the call's commands ran.
  The refusal of an endpoint or URL it cannot read names its fix, that endpoint written out literally (`gh api https://api.linear.app/graphql`).
  It reads Bash through `scripts/hooks/shell.ts`, the reader it shares with the release hook, and its tests are in `bun run test:file tests/scripts/hooks` too.

## no-mac-web-build

- A factory session builds the web image on the box: `scripts/hooks/no-mac-web-build.ts`, registered beside no-glm-heavy-path, refuses a factory session's web image build on the Mac while the live dashboard's Postgres runs in the same Docker VM.
  On 21 Oct a tester's web build took the 3.1 GB VM's out-of-memory killer to every Postgres in it, the dashboard's included, and the build peaks at about 4 GB over baseline (measured on the box), so no memory cap makes it safe here.
  A web image build is `docker compose build` (or `docker-compose build`) with no service named, `web` among them or a service it cannot read, `docker compose up`, `create` or `run` on the same terms unless given `--no-build` (compose builds a missing image, and docker-compose.yml names none), and `docker build`, `buildx build`,
  `image build` or `builder build` whose `-f` or `--file` names `web/next/Dockerfile` or a path it cannot read, through a wrapper, `bash -c` or run-slot.sh;
  an `ssh` call, a printed command and `--help` pass.
  For a web build alone it reads the container's name from the dashboard supervisor's `dashboard-db` (`ops/dashboard/dashboard-db` in the data folder, the `$S` of `scripts/ops/dashboard/supervisor.sh`) and asks `docker inspect` whether it runs.
  The build runs only when dashboard-db names a container Docker reports as stopped or gone, whether or not a runner host is set.
  A dashboard-db that is missing, empty (the supervisor writes it empty both when the dashboard has no container and when its lookup failed) or unreadable refuses, as do a running container, any other answer from Docker and no answer in 8s (well inside the hook's 15s, since a hook past its limit lets the call through), since a wrong guess costs the dashboard's database.
  It reads the runner host as `ci.sh` does: `RUNNER_HOST`, else the data folder's `ops/runner-host/ip`, holding an IPv4 address.
  With a host set, its reason names the box route, `bash ~/.playground/ops/runner-host/ci.sh web HEAD` from a commit ([scripts/ops/README.md](../ops/README.md)), and the api image, which still builds on the Mac.
  With none set, `ci.sh` exits 255 with no box to reach, so the reason says the live dashboard's Postgres stays up and names the routes that exist: set one up (`scripts/ops/runner-host/host.sh setup <ip>`, then write its address to that ip file), or build the web image on a machine with no live dashboard running, and the api image.
  It fails closed only on a call that reads as a docker build, and its tests are in `bun run test:file tests/scripts/hooks`.

## no-main-checkout

- A factory session keeps the main checkout clean: `scripts/hooks/no-main-checkout.ts`, registered beside no-stash on Bash and the file tools (Edit, MultiEdit, NotebookEdit and Write), refuses lefthook, turbo (but for its packages build, below), `git commit` (it runs pre-commit), `bun run build`, `bun run check-types`,
  `bun run test`, `bun run test:file` and `bun test` while the command's directory (the Bash tool's cwd, after any `cd`, `git -C` or `bun --cwd` in it, but for `bun x` and `bunx`, which run in the shell's folder whatever bun's own `--cwd` says) is the main checkout and not a worktree under `.claude/worktrees/`,
  and a write into the main checkout from anywhere (a redirect, `cp`, `mv`, `touch`, `tee`, curl's `-c` or `-o`, the files `sed -i`, BSD's `sed -I`, `sed --in-place` or `perl -i` edits in place, or a file tool's path), naming the fix: run it in your own worktree.
  A command run through `run-slot.sh`, typed bare or as a shell's script (`bash <path>/run-slot.sh <who> -- <command>`, `shellSlot`), is read as the words after its `--` (`slotWords` in `scripts/hooks/shell.ts`, which no-glm-heavy-path and no-false-green read it by too), so a commit, a build or a write through run-slot is refused as the same command typed bare.
  It refuses a git move there too: `add` (but `-n` or `--dry-run`), `am`, `apply` (but `--check`, `--numstat`, `--stat` or `--summary` without `--apply`), `bisect`, `branch -f`, `checkout`, `cherry-pick`, `clean` (but `-n`), `merge`, `mv`, `pull`, `rebase`, `reset` (but the one below), `restore`, `revert`, `rm`, `stash` (but `list` and `show`), `switch` and `update-ref`,
  whose tree it reads from a `--git-dir` of `<checkout>/.git`, else `--work-tree`, else the cwd after every `-C` in turn, naming the fix: `git -C <your worktree>`, after `git -C <your worktree> rev-parse --show-toplevel` names it.
  The one reset it lets through is exactly `git reset --keep origin/main`, on the main checkout's `main`, while `git status --porcelain` is empty and no remote-tracking ref holds any commit of `origin/main..main`.
  It is the way back from a stray local commit there, which `playground update`'s fast-forward stops on, since `--keep` keeps uncommitted work and the check keeps every commit someone else holds.
  A worker's shell lands there when it changes into the main checkout to run spawn.sh, so the factory's docs run spawn.sh by its absolute path (a bare `git reset --hard` there once ran every installed skill and hook off another branch for 3.5 minutes).
  Run a worktree's commands as `git -C <your worktree>` or `cd <worktree> && …` in one command, since a failed command leaves the Bash tool's shell in its old folder without a word.
  It judges each path where it lands, its nearest existing folder's links followed, so a write through a link link-skills.sh made (`~/.claude/skills/<name>`, `~/.playground/factory-settings.json`) is refused too, while the data folder's own files (handoffs, the roster) and a worktree reached through a link run.
  Reads, `git fetch`, step 5's `git merge --ff-only origin/main` (with `-q` or `--quiet` before or after `--ff-only`), `scripts/link-skills.sh`, `bun install` and `env NODE_ENV=production SKIP_ENV_VALIDATION=true turbo run build --filter='./packages/*'` alone run, as the release skill's step 5 needs:
  the install a pull that changes `bun.lock` or a `package.json` needs, and the build a pull that changes `packages/` needs, since the `playground` command imports their `dist`.
  That build needs `NODE_ENV` set and `SKIP_ENV_VALIDATION=true`, on its line, exported or in the session, since the main checkout has no `.env` and the packages' env checks fail without them, so a bare one is refused with the line `playground update`'s build step runs.
  It fails open.
  Its tests are in `bun run test:file tests/scripts/hooks`.
  The backstop behind it is `lefthook.yml`'s pre-commit step `main-checkout`, alone at priority 1 so it runs first, before any step that writes (lefthook runs a tie in any order).
  It refuses a commit whose `git rev-parse --show-toplevel` is the factory's main checkout, the one `~/.playground/ops/run-slot.sh` links into (`scripts/link-skills.sh` makes that link), whatever wrapper, shell or cwd made it, since this hook reads a command's text and the step reads where the commit lands.
  A worktree and every other clone, a person's own included, commit as before.
  A ship's pull is a fast-forward and runs no pre-commit, and the step's test is in `tests/lefthook.test.ts`.

## no-manager-subagent

- A manager hands every build, read or research to a worker session the owner can see, so no helper works out of sight: `scripts/hooks/no-manager-subagent.ts`, registered beside no-stash, refuses the Agent tool and the Workflow tool, which starts agents, to a session role.ts places as a manager,
  `PLAYGROUND_ROLE` `dispatcher`, `lead` or `manager`, or else a registry name whose roster kind or name reads as one (a manager's name in `sessions.names`, or an old name `sessions.aliases` maps to a manager's kind).
  Its reason names the fix: start a worker through `scripts/spawn.sh`, which writes its roster row, and brief it with the task.
  Workers, checkers and the owner's own sessions keep both tools, so a reviewer's `code-review` sub-agents run, and a manager's forked skill runs through the Skill tool, which the hook leaves alone.
  It fails open, and its tests are in `bun run test:file tests/scripts/hooks`.

## no-off-palette-label

- ALWAYS: Give every GitHub label a Tailwind 500 color, on any label created from now on.
  The PreToolUse hook `scripts/hooks/no-off-palette-label.ts`, registered beside no-mac-web-build on Bash and the GitHub MCP's `label_write`, acts for every session and refuses a label write whose color is not one of the 22 hexes in its `TAILWIND_500`, read in any case, with or without `#`:
  `gh label create` or `gh label edit` by `--color` or `-c`, `gh api` POST to `repos/<owner>/<repo>/labels` or PATCH to `.../labels/<name>` by a `color` field or an `--input` JSON body, and `label_write`'s `create` or `update` by its `color`.
  A create with no color is refused too, since GitHub then picks one; an edit with no color keeps the label's color and runs, as do a delete, `gh label clone` and adding a label to an issue or PR.
  A color it cannot read (a variable, an `--input` it cannot open) is refused, and the reason names the fix: one of the 22 hexes, by name, written literally.
  It recolors nothing, so a label made before the rule keeps its color.
  A GraphQL `createLabel` or `updateLabel` sent through `gh api graphql` is not read.
  It fails open, and its tests are in `bun run test:file tests/scripts/hooks`, beside a pin that every color the repo's own code creates a label in is a 500, the auto-labeler workflow's included.

## no-ours-merge

- A factory session merges `canary` plainly: `scripts/hooks/no-ours-merge.ts`, registered beside no-stash, refuses a `git merge` or `git pull` with the ours strategy or the ours option (`-s ours`, `-sours`, `--strategy=ours`, `--strategy ours`, `-X ours`, `-Xours`, `--strategy-option=ours`, `--strategy-option ours`, an abbreviation of `--strategy-option`, `-s` in a cluster of short options,
  and an alias for one), through `git -C`, a wrapper, `bash -c` or run-slot.sh, and a value it cannot read beside one, naming the fix: `git merge origin/canary`, resolving each conflict with both sides' meaning.
  It fails closed only on a call that reads as a merge with ours, and its tests are in `bun run test:file tests/scripts/hooks` too.

## no-prompt-stop

- A factory session never waits on a permission prompt no one answers: `scripts/hooks/no-prompt-stop.ts`, registered beside no-stash, refuses the Bash shapes Claude Code stops on, with a reason the session acts on:
  an `rm` or an `rmdir` whose target has two or more parts that start with an unguarded variable (`$S/$m`, `$HOME/$s`, `$S/$v.d`), which the session rewrites with `${VAR:?}` or as a literal path.
  A single such part (`"$O"/d`), or a variable after a name (`$S/p$v`), runs, as it does in Claude Code.
  It also refuses an `rm` or an `rmdir` of a name directly in `/` (`/scratchpad_*`, `/x`), which the session moves into `$TMPDIR` or its scratchpad.
  A name a level deeper (`/usr/x`) and a redirect into `/` run, as they do in Claude Code.
  It fails open.

## no-release-comment

- ALWAYS: In every comment and review body on a repo whose owner `release-owners.json` lists, write "ship" or "publish step" where "release" (any case) would go: there an owner comment holding the word publishes to npm, and gh and the GitHub MCP post as the owner.
  A session run from this repo has the PreToolUse hook `scripts/hooks/no-release-comment.ts`, registered in both settings files, which refuses such a comment before it posts, and refuses one whose text or repository it cannot read (a GraphQL comment names no repository, so it is always checked).
  To post a body it can read, write it with the Write tool first, then post it in a call of its own with `--body-file` naming that file by its literal absolute path; it cannot read a path built from a variable or a file a heredoc with an expansion writes in the same call, and its refusal then names this recipe, as no-playground-leak's does.
  A GraphQL query and each of its fields reach it only as text written in the command or a file named by its literal absolute path, so it refuses one held in a shell variable (`Q='…'; gh api graphql -f query="$Q"`), and its refusal then names both ways.
  An `--attach` reads only what gh posts, its alt text after `#`, else its file's name, so a path built from a variable (`"$S/after.png#After"`) passes when the variable sits before the alt's first `#`, or, with no `#`, before the name's last `/`.
  Its refusal gives the way out for a file, rule or patch that holds the word: name the file or rule by what it is ("the ship rule") with its line number, and keep the patch out of the comment.
  Write the patch to a file in your scratchpad, send its absolute path to the PR's worker by SendMessage, and say in the comment that a patch went to the author, since gh's `--attach` uploads only images and video (gh 2.103.3: "supported: png, jpg, jpeg, gif, webp, svg, mp4, mov, webm").
  It fails closed only on a call that reads as a comment, and a hook that cannot start or times out lets the call through, so it never blocks every Bash call.
  A PR body or a commit message is not a comment.
  The owners it guards are its `release-owners` list, A to Z, read as [Guard lists](#guard-lists) says; core's `release-owners.json` names none, so a fresh clone guards no owner until one is added.
  Its tests are `bun run test:file tests/scripts/hooks`, which `bun run test` runs rather than `test:skills`; run them before pushing a change to the hook.

## no-stash

- Every worktree of a checkout shares one `git stash` list, so a pop can take another worker's entry, lint-staged's commit backup included: take a before-shot from a separate worktree on `origin/canary`, or commit first.
  The factory's `scripts/hooks/no-stash.ts` (registered in `scripts/factory-settings.json`, and in `.claude/settings.json` for a session cmux restores without it) refuses a stash that could take another worktree's work, and `agent-browser close --all`, which closes every session's browser on the machine.

## no-unslotted-run

- A factory session runs every heavy run in a worktree through run-slot: `scripts/hooks/no-unslotted-run.ts`, registered beside no-stash, refuses `bun install`, a recursive `cp` of a `node_modules` folder, `bun run build`, `bun run check-types`, `bun run test`, a `bun test` or `bun run test:file` that names no file, `next build`,
  and turbo running `build`, `check-types`, `lint` or `test` (`turbo run <task>` or `turbo <task>`), by name, path or versioned package (`turbo@latest`), through `bunx`, `npx` (past their own options, `-y` or `-p turbo`) or `bun x`, but for `--help`, `--version` and `--dry-run`,
  whose directory (the Bash tool's cwd after any `cd`, or a `bun --cwd`, `bun run --cwd`, `bun install --cwd`, `bun test --cwd` or turbo's `--cwd`, so one typed from anywhere counts, and a clone's destination) is inside a worktree under `.claude/worktrees/`,
  unless the command runs through `~/.playground/ops/run-slot.sh`, naming that form (18 Oct: five worktree installs at once drove load1 to 66.8).
  The main checkout is no-main-checkout's. It fails open, and its tests are in `bun run test:file tests/scripts/hooks`.
  A commit's pre-commit build takes a slot through `packages/scripts/src/commit-slot.ts`, and playbook's **slots** rule says which slot each way of committing takes.

## rules

- Every factory session starts with its standing rules in context: `scripts/hooks/rules.ts`, a SessionStart hook with no matcher (startup, resume, compact and clear) in both settings files, renders the core extension's rules, then each stacked org's, then the signed-in login's,
  each `{key}` slot filled from the extensions' `policy.json` (the values for the session's repo's GitHub owner when `ext.links` guards it, else the factory's), and a key they do not set from its default in `packages/settings/src/rules.ts`.
  Each scope's rules are `<scope>/rules/*.md`: `core`'s from the checkout's `extensions/core/rules/` (`CORE_RULES`);
  each extension `ext.links` links to the session's repo, in `ext.order`'s order (`extChain` in `packages/settings/src/settings.ts`), and the login's (`loginOf`: `PLAYGROUND_LOGIN`, else the extensions' `login` file, else no login rules), through the extensions' reader (`readRendered` in `packages/settings/src/rendered.ts`).
  A rule file is one rule, named by its file, a hyphen read as a space (`local-page.md` holds **local page**): optional frontmatter whose one line, `decisions: [i<n>, ...]`, cites the Inbox items behind it,
  then its what and why, one sentence a line, slots as `{dotted.key}` naming a key `packages/settings/src/rules.ts` defines, its first line the glance and its last naming the command or README that holds the how.
  The words and incidents behind a rule go under its name in the login's `doc decisions-log` item (`playground ext put <login> doc decisions-log <file> --reason "<why>"`), never into the rule.
  The render shows each rule's glance with its slots filled, and past SessionStart's 10,000 characters as many whole rules as fit, naming how many were left out; `playground rules <name>` prints one whole from the same read, its slots filled (`packages/scripts/src/playground/rules.ts`, tested in `tests/packages/scripts/src/playground/rules.test.ts`).
  Extensions that cannot be trusted render the defaults, led by the refusal and its fix; with none the defaults apply and nothing says so.
  It says nothing to the owner's own sessions here, fails open, and its tests are `bun run test:file tests/scripts/hooks/rules.test.ts`, which holds every slot to a defined key and core's render under 8,000 characters, leaving room for an org's.

## session-state

- `scripts/hooks/session-state.ts` writes every session's own state to `session-state/<session id>.json` in the data folder, which ops-session-resume reads and the Dashboard is to read.
  Registered on Notification, PermissionDenied, PermissionRequest, PostToolUse, PostToolUseFailure, SessionEnd, Stop, StopFailure and UserPromptSubmit with one command in `.claude/settings.json` and `scripts/factory-settings.json`,
  it writes the shape `sessionStateSchema` in `packages/config/src/session-state.ts` checks (`agentId?`, `at`, `event`, `reason?`, `resetsAt?`, `sessionId`, `state`, `tool?`; `state` is `failed`, `idle`, `stuck`, `usage-limit` or `working`), whose `stateNow()` reads a stuck, failed or usage-limit record as over once the transcript holds a turn after it, since an Escape on a prompt fires no hook.
  A prompt is a turn starting, Stop ends it, a PermissionRequest or a permission or elicitation notice is stuck (an AskUserQuestion `question`, an ExitPlanMode `plan`, else `permission`), and the end of that tool from the same agent (PostToolUse, PostToolUseFailure or PermissionDenied) is working again, as is the main agent's first tool after a Stop or a StopFailure but a login,
  since the turn went on (a Stop hook can continue it; any other tool end writes nothing, so the hook after every tool is one file read, about 10ms measured); a notice never replaces a stuck, failed or usage-limit record, nor the permission notice the record a tool end wrote, since it lands after the event that wrote it;
  and a StopFailure is `stuck` on a login, `failed` with reason `balance` on Z.ai's empty balance (`[1113]` in its last message, which the zai usage job reads), `usage-limit` with its reset on a usage limit (GLM's text in UTC+8, else Claude's limit line in the transcript), else `failed`.
  Inside herdr (`HERDR_ENV=1`) it also reports the state as herdr's own, `pane report-agent` under the source `custom:playground` as the agent `claude`, the kind herdr's `agent.prompt` types into, with a microsecond `seq`, from a detached child with a 2s timeout, and on SessionEnd hands the pane back (`pane release-agent`), so a pane that outlives claude goes back to herdr's own reading.
  herdr, as cmux does, restores a session without its `--settings` (measured on herdr 0.9.5), so a restored session outside the factory's checkout writes no state and its file goes stale; a reader takes a record as about the moment it was written, never as the session now.
  When it writes `stuck` or `failed` for a factory session, it also queues one line in the ops outbox (`ops-stuck-alert.jsonl`, which the relay sends by SendMessage) for the session's manager alone, by `managerFor()` in `packages/scripts/src/stuck-alert.ts`: the session, its roster task, the reason, the command or question, and its last message (playbook's **unstick**);
  The dispatcher's own and a session outside the factory queue nothing.
  It acts for every session, fails open, and its tests are in `bun run test:file tests/scripts/hooks`.
  `bun run ops:session-resume` (`packages/scripts/src/ops-session-resume/`) reads those files every 60s and queues one resume line through the ops relay to each live factory session (a name `scripts/hooks/role.ts` gives a role, never a probe, whose spawner answers it, nor a session of the owner's own) a minute past its usage limit's reset,
  but for a limit Claude Code announced it continues itself (its `continuing automatically at` notice after that limit's line, with nothing after it but repeats of that line, which a message queued during the limit writes), so each limit gets one carry-on line, and a limit with no such notice, GLM's or Claude's, gets the job's (playbook's **unstick**).
  It also queues one carry-on line to each such session whose newest record reads `working` from before its process started (the registry's `startedAt`), 2 minutes after that start: a turn a restart lost, since cmux's own restore resumes with no first prompt, while `spawn.sh resume` gives every resume one, which writes a newer record and gets none,
  and so does a turn a person ended with Escape,
  which fires no hook and leaves only its `[Request interrupted by user` line in the transcript after the record.
  It owns a `failed` record too: such a session gets one carry-on line on the first pass that sees it, to redo the step that failed, or to carry on with small reads when the transcript's error line is autocompact thrashing, since redoing that step fills the context again.
  When a later pass finds the same record still standing, or a new `failed` record comes within 30 minutes of the one that got the line, its lead (by the roster's kind, `leadOf` in `packages/scripts/src/ops-tick/tick.ts`; the dispatcher's is the builder's seat) and the dispatcher get one alert naming the session, the reason and how long it has stood;
  a newer prompt or a Stop replaces the record, so a session that took the line gets no alert, and a session that has ended gets neither.
  It tells the primary dispatcher once of a live session whose `stuck` record has stood 5 minutes with no turn after it in the transcript (its manager has not answered), and the session's manager once of a live session reading `working` whose transcript has not moved in 15 minutes.
  ops-unstick's api-error stop leaves such a stop to this job (`resume_owned` in `scripts/ops/unstick/run.py`) and keeps the ones no hook recorded.
  Each pass it also reads each such live session's executable (lsof's first txt file for its pid), and when that file no longer exists, as after a Claude Code update deletes the old one, it tells the session's lead once per process to close and resume it, a manager's to the dispatcher and the dispatcher's to the ops seat, which respawns it,
  since tccd cannot attribute such a process and macOS then denies the Desktop folder to every herdr session.

## writing-first

- A factory session holds to playbook's **writing** rule through `scripts/hooks/writing-first.ts`, registered with one command in `.claude/settings.json` and `scripts/factory-settings.json`, so a session loading both runs it once.
  It acts only for a session `fromFactory` in `scripts/hooks/role.ts` places in the factory, so the owner's own sessions write as before.
  It refuses a Write, Edit or MultiEdit to an agent-facing doc until the session has loaded writing-for-agents, its reason naming the fix (it has not loaded the skill since its last compaction): load it with the Skill tool, then retry.
  Agent-facing means, in a checkout holding `extensions/core/skills/playbook/SKILL.md` (so every worktree matches and another repository's checkout does not), anything under `skills/`,
  ZeroStarter's skills under `skills/zerostarter/`, which `.agents/skills/` links to and which a path reaches with its links resolved (one whose `source` names a tool, not a repository, is vendored and left out), `.agents/dashboard/`, `.agents/*.md` (not `.agents/adr/`),
  the root `AGENTS.md` and `CLAUDE.md`, `scripts/README.md` and `scripts/hooks/README.md`, and `docs/`; and anywhere, a handoff under the data folder's `handoffs/`.
  A Skill call or a typed `/writing-for-agents`, bare or a plugin's or folder's scoped copy (`ws-home:writing-for-agents`), leaves a mark under the data folder's `writing-first/`, a subagent's apart from its parent's, since a subagent's hook input carries its parent's session id beside its own `agent_id`; a compaction clears the session's marks.
  With the skill installed nowhere (the config folder's `skills/`, the checkout's `.claude/skills/`, or a plugin `plugins/installed_plugins.json` lists, installed for the user and enabled in the user settings or installed for the session's project) it lets every write through, and it fails open.
  Its refusal names the bare skill or the scoped name the session's skill list shows, since a factory session loads its org's set through `--plugin-dir` under a name the hook cannot see.
  Its tests are in `bun run test:file tests/scripts/hooks` too.
