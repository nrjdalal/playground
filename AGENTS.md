# AGENTS.md

Guidance for AI coding agents working in this repository, a Bun monorepo: the `web/next` app, the `api/hono` service, and shared `packages/*` (auth, config, db, env, redis), with build-only tooling in `packages/scripts`.
The canonical starter also carries the `packages/cli` npm binary and the `tests/` suite, neither of which a fork takes; this guide and every skill ship to a fork whole, rebranded to its name.
Start each task with the `codebase-map` skill to orient, then load the task skill that fits (see [Skills](#skills)).

## Workflow

- ALWAYS: Do every change in its own git worktree, never on the primary checked-out branch.
  Create it under `.claude/worktrees/` (repo-root relative, one directory per worktree; never `/tmp`, home, or a sibling of the repo), and fork its branch from the latest `canary`: fetch first, then branch from `origin/canary` (`git fetch origin canary && git worktree add .claude/worktrees/<name> -b <branch> origin/canary`, then `bun install` in it, which its git hooks need,
  through `~/.playground/ops/run-slot.sh <your name> --` in a factory session), so the change builds on current main, and set up its `.env`, or none, by the `dev` skill's Start.
- ALWAYS: Settle a new or altered database schema before generating or applying a migration: work goes ahead on its own, but a breaking change goes through the owner first.
  Show the shape and name the choices that are costly to reverse; a shape is cheap to argue about and expensive to change once rows exist, and the live dashboard's database already holds real ones.
  An additive change (a new table, a new nullable column, an index) goes ahead after the PR's reviewer session reviews its shape on Opus at high effort (code-review-loop's step 4) and a dump of the live dashboard's database, which the dashboard runner's lead takes before the merge and the PR names.
  Anything else is a breaking change (a drop, a rename, a type change of real rows, a change others depend on, anything that cannot be undone) and waits for the owner's go through the Inbox.
  See the `db-migration` skill.
- ALWAYS: Point local database work at a disposable container of the worktree's own, published on loopback alone: `docker run -d --name playground-<worktree>-db -e POSTGRES_PASSWORD=<pw> -p 127.0.0.1::5432 postgres:alpine`, then `docker port playground-<worktree>-db 5432` for its port.
  One exception: first run's pglaunch database, on all interfaces as the owner chose (`.agents/dashboard/stack.md`).
  Set the URL in the worktree's own `.env`, started from `.env.example` rather than copied from another checkout, and never point it at the live dashboard's database.
  Playground has no shared database, but the live dashboard's local Postgres (the one its `POSTGRES_URL` names) holds every real session and transcript, so a migration or a rename applied there breaks the running dashboard.
  Seed fake rows; real rows must never reach a screenshot or a PR.
  Remove the container with `docker rm -fv`, since a remove without `-v` leaves its data volume behind; `tests/test_docker_rm_volumes.py` refuses one.
  See the `db-migration` skill.
  A worktree that works on the merge lock's Redis (`@packages/redis`) runs its own the same way, `docker run -d --name playground-<worktree>-redis -p 127.0.0.1::6379 redis:alpine`, with `REDIS_URL` in its `.env`; left blank, the lock keeps to its folder.
- ALWAYS: Keep documentation in sync with every change.
  Whenever code, structure, conventions, or tooling change, update the matching docs in the same change (e.g. `web/next/content/docs/`, `README.md`, the `llms.txt`/`llms-full.txt` context routes, skill docs under `skills/`, and these agent guides `AGENTS.md`/`CLAUDE.md`).
  Docs must never drift.
  See the `doc-sync` skill.
- ALWAYS: When code, a convention, a command, a path, or tooling changes, review the skills in `skills/` that touch it and update them in the same change, so every skill stays accurate and relevant.
  A skill that describes old behavior misleads every agent that loads it, which is worse than no skill.
  If a change makes a skill obsolete, remove it; if it reveals a gap, consider adding one.

## Code

- ALWAYS: Make the smallest change that meets the task's Done when, by YAGNI, so whatever you choose stays light with a small footprint: no speculative option, layer, setting or dependency.
  Before asking for review, ask what can be removed.
- ALWAYS: Use `@/` for imports, if applicable.
  An API file the web's tests import is the exception: it imports relatively (`api/hono/src/plugins/changelog/image-id.ts`), since `@/` resolves to `web/next/src` there.
- ALWAYS: Put every test under the repo-root `tests/` directory, mirroring the path of the file it covers (`api/hono/src/lib/dashboard/account.ts` is tested by `tests/api/hono/src/lib/dashboard/account.test.ts`).
  One `bun run test` runs the suite and `bun run test:file <paths>` runs some of it, skipping the build; a package never carries its own `test/` directory or `test` script.
  Read [.agents/testing.md](./.agents/testing.md) before you write or run a test: the sandbox, the parallel pass and `SERIAL`, its traps.
- ALWAYS: Put a new build or tooling script in `packages/scripts/src/`, not `.github/scripts/`, and declare the dependencies it imports on that package.
  It is a real workspace package, so `turbo prune` carries it into the Docker build without an extra COPY.
- ALWAYS: TypeScript under Bun for every script and test; the allowlist in `tests/python-allowlist.test.ts` holds the Python files still waiting for their port, and a new one fails the test.
- ALWAYS: Prefer a Bun-native API when the file runs under Bun and one exists (`Bun.file`, `Bun.write`, `Bun.spawn`); otherwise use a Node built-in with the `node:` protocol prefix (`import { join } from "node:path"`, `require("node:fs")`), never the bare specifier.
  Code that runs under Node in any environment (the `packages/cli` npm binary in the canonical starter, `web/next`, where `next dev` runs under Node while Docker and Vercel serve it under Bun, and shared `packages/env`) stays on `node:`.
  See the `runtime-apis` skill.
- ALWAYS: Keep enumerable lists alphabetical (A→Z), union/enum members, env-var schemas and their `runtimeEnv`/`turbo.json` mirrors, and the docs that list them, so the code and its docs stay in the same order.
  Use a meaningful order (flow, priority, required-then-optional) only where alphabetical would obscure intent.
  API response schemas are included, and they order by relevance first, then A→Z: where one key is what the response is about and the rest describe it, that key leads and the others sort after it (`users`, then `hasNextPage`, `page`, `perPage`, `total`).
  Everything else, a row's own fields included, is plain A→Z with `id` in its alphabetical place rather than hoisted.
  Sorting the subject too would put it in a different position on every endpoint, which is the drift this rule exists to prevent.
- ALWAYS: Version every root `catalog` entry with a caret range (`^1.2.3`), never an exact pin or a tilde.
  `.github/scripts/deps-manager.ts` rewrites exact and tilde specs on `postinstall`, including specs it promotes into the catalog from a workspace dep, and reports the rest (wildcards, dist-tags, compound ranges) for a manual fix.
  There is no opt-out: no pin survives an install, so pinning deliberately means changing the rule in that script and recording why in `docs/dependencies.md`.
- Do not comment unnecessarily.
  Only comment if it is absolutely necessary.
- Keep comments on a single line; do not split one across multiple `//` lines or use multi-line `/* */` blocks.
- NEVER: Use em-dashes (the long dash, U+2014) in code, comments, docs, or copy.
  Regular hyphens are fine; for a pause or aside, use a comma, colon, or period.

## UI

- ALWAYS: Follow the `design` skill for UI, styling, and design decisions (it holds the canonical conventions).
  Update it in the same change when a convention changes.
- ALWAYS: For any frontend or UI change, verify it in a real browser with agent-browser before opening or updating a PR; drive the actual page or flow, do not rely on type-check and lint alone.
  Run the end-to-end flow when the change spans it or when asked.
  Capture screenshots only on a fixture stack (its `/api/health` reads `"dashboard":"fixture"`; see the dashboard section below), full page, before and after (`bun run verify screenshots --label before|after`), and attach them to the PR with `gh pr comment --attach`.
  See the `ui-verify` skill.

## Commits

- Make atomic commits in the Conventional Commits format.
  See the `gh-commit` skill.
- ALWAYS: Write repo text (docs, skills, rules, ADRs, comments, tests, commits, PR bodies, issues) that names no person and quotes no one, since the factory may be shared with colleagues.
  State each rule and its reason in neutral words, and write "the owner" where a person is needed.
  An override travels verbatim only between sessions, in `SendMessage`, and a public author's credit (a `CREDITS.md`) stays.
  A name that is data (a ticket's assignee, a routing owner, a fixture, a config default) stays, and no text, a commit, PR or ticket included, quotes anyone's judgement of a colleague's or a team's work.
  `bun run trace-count` counts each owner name and dated quote as `ownerName`, and fails when that count rises past its floor in `counts.json`.
- NEVER: Include "Co-authored-by" in commit messages.

## Working notes

- Write an audit report (any kind) as a `doc` item in your login's scope: `playground ext put <login> doc audit-YYYY-MM-DD-<topic> <file> --reason "<why>"`.
  Audits are transient working docs: once its findings are fully addressed (shipped or consciously won't-fixed), put a last revision that says so.
- Track planned, in-progress, and parked work as `doc plan-<slug>` items the same way, one per item, not in dated audits or scattered across issues; issues are the inbox, folded in and closed once captured.
- `playground ext search <words>` finds an audit or a plan.

## Compact Instructions

Write a compaction's summary as a handoff to the session that carries on under your name: what is done, what was decided and why, the constraints you work under, the next steps, and the newest ask from up the chain quoted whole.

- A worker, reviewer, tester, runner or probe keeps its PR number, branch and head sha, its brief's path, the review round and score, every open finding, the files it changed with the commands that test them, and its ETA.
- A manager (the dispatcher, a lead, the planner, the optimizer) keeps every live thread with its PR or Inbox id, each of the owner's open asks quoted word for word, what each session under it is on, and every promised follow-up with its time.

## Logging in (agents)

Signs in as `LocalAgent`.
The route is gated: set `AGENT_SIGNIN_ENABLED=true` in `.env` first (it is off by default, so the route 404s without it and a deployed default env never exposes it).
Then sign in with curl (a browser posts it as a form, the `dev` skill's Agent login):

```bash
WEB=$(bunx portless get playground); API=$(bunx portless get api.playground)
curl -sS -c cookies.txt -X POST -H "Origin: $WEB" "$API/api/agents/sign-in-as"
curl -sS -b cookies.txt "$API/api/v1/user"
```

Local-only (needs `NODE_ENV=local` and `AGENT_SIGNIN_ENABLED=true`) and requires a trusted `Origin` header.
See `api/hono/src/routers/agents.ts` if needed.
On a worktree's stack the dashboard then shows the fixture's made-up sessions under its Test data badge, never the live ones (the dashboard section's source rule).

## Skills

ZeroStarter's skills live in `skills/zerostarter`, which `.agents/skills` (the path ZeroStarter's CLI syncs through), `.claude/skills` and `.github/skills` link to, so every agent tool reads the same files.
A ZeroStarter sync also overlays `lefthook.yml` with the starter's and drops the docs this repo adds to the docs-wrap job's glob, so after one, restore each until `tests/lefthook.test.ts` passes.
Each is a `SKILL.md` with a `description` trigger and a literal procedure; only the description is scanned until a skill matches.
Start with `codebase-map` to orient, then load the task skill that fits.
**Custom** skills are maintained in this repo; **vendored** skills are copied verbatim from an upstream project (re-vendor to update, do not hand-edit).

**Custom**

<!-- skills:custom -->

| Skill                                                        | Description                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [add-package](skills/zerostarter/add-package/SKILL.md)       | Add a new shared workspace package under packages/*.                                                                                                                               |
| [api-endpoint](skills/zerostarter/api-endpoint/SKILL.md)     | Add a typed Hono API endpoint or WebSocket route: router, OpenAPI docs, validation envelope, and RPC client wiring.                                                                |
| [audit](skills/zerostarter/audit/SKILL.md)                   | Run the dependency security audit and maintain docs/dependencies.md.                                                                                                               |
| [codebase-map](skills/zerostarter/codebase-map/SKILL.md)     | Orient in this repo: which file to edit for a change, how a change ripples across the stack, and how to search the code.                                                           |
| [db-migration](skills/zerostarter/db-migration/SKILL.md)     | Create and apply a Drizzle schema change.                                                                                                                                          |
| [design](skills/zerostarter/design/SKILL.md)                 | Follow and maintain the app's UI conventions.                                                                                                                                      |
| [dev](skills/zerostarter/dev/SKILL.md)                       | Start, restart, and verify the Playground dev stack. `bun run dev` serves portless named `.localhost` URLs (branch-prefixed in a worktree); resolve them with `bunx portless get`. |
| [doc-sync](skills/zerostarter/doc-sync/SKILL.md)             | Sync docs and skills so they never drift from the code.                                                                                                                            |
| [docker-test](skills/zerostarter/docker-test/SKILL.md)       | Build and smoke-test the Docker images with docker compose, and run the golden end-to-end suite against them.                                                                      |
| [fonts](skills/zerostarter/fonts/SKILL.md)                   | Add, swap, or remove a self-hosted web font (latin variable woff2 from fontsource, localized via next/font/local).                                                                 |
| [gh-commit](skills/zerostarter/gh-commit/SKILL.md)           | Create atomic commits in the conventional format.                                                                                                                                  |
| [ignore-sync](skills/zerostarter/ignore-sync/SKILL.md)       | Mirror .gitignore to .dockerignore.                                                                                                                                                |
| [release](skills/zerostarter/release/SKILL.md)               | Cut a production release by promoting canary to main.                                                                                                                              |
| [runtime-apis](skills/zerostarter/runtime-apis/SKILL.md)     | Prefer Bun-native APIs, else Node built-ins with the node: prefix.                                                                                                                 |
| [shadcn-sync](skills/zerostarter/shadcn-sync/SKILL.md)       | Run and reconcile the shadcn component sync (`bun run shadcn:update`).                                                                                                             |
| [skills-manager](skills/zerostarter/skills-manager/SKILL.md) | Keep the AGENTS.md skills tables generated from skill descriptions, and understand how a fork syncs its skills from upstream.                                                      |
| [ui-verify](skills/zerostarter/ui-verify/SKILL.md)           | Verify a frontend or UI change in a real browser.                                                                                                                                  |

<!-- /skills:custom -->

**Vendored** (upstream, copied verbatim)

<!-- skills:vendored -->

| Skill                                                      | Description                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [agent-browser](skills/zerostarter/agent-browser/SKILL.md) | Browser automation CLI for AI agents.                                                                                    |
| [portless](skills/zerostarter/portless/SKILL.md)           | Set up and use portless for named local dev server URLs (e.g. https://myapp.localhost instead of http://localhost:3000). |

<!-- /skills:vendored -->

## Playground

This repo is also Playground, whose own skills live under `skills/`.
It stays private, since skills name colleagues' handles and internal repos.
ZeroStarter's rules above govern Playground too; this section adds its own.

- Skills live in two folders under `skills/`: `playground/` holds the factory's own (each one **promoted**), and `zerostarter/` the starter's, which `.agents/skills` links to.
- Every promoted skill has an entry in the top-level `README.md` and in `skills/playground/README.md` (the name linked to its `SKILL.md`, grouped into **User-invoked** and **Model-invoked**), plus a docs page at `docs/playground/<name>.md` written per [.agents/writing-docs.md](./.agents/writing-docs.md).
  Adding, renaming or changing a skill re-syncs all three.
  An internal worker (called only by another skill or an ops job) gets a docs page linked from its caller's and no README entry; one an ops job types keeps the default `user-invocable` (`.agents/invocation.md`).
- Invocation rules are in [.agents/invocation.md](./.agents/invocation.md).
  A decision with a lasting reason gets an ADR in `.agents/adr/NNNN-title.md`.
  A change to a contract or content takes the next version beside the old one, the latest is used and a pin is explicit ([ADR 0015](./.agents/adr/0015-versions-the-old-one-stays-the-latest-is-used.md)).
  Shared vocabulary is in [GLOSSARY.md](./GLOSSARY.md).
- ALWAYS: Call the Skill tool with "writing-for-agents" before you write or edit any agent-facing doc, and follow it (playbook's **writing** rule, which puts it at the core of every agent-facing doc):
  a `SKILL.md` and its sibling files, `AGENTS.md` and `CLAUDE.md`, an `.agents/dashboard` rule, `scripts/README.md` and `scripts/hooks/README.md`, a docs page, a handoff and a brief.
  That means a lean document, reference disclosed into sibling files, a completion criterion on every step, positive phrasing, and leading words.
  A PR body is written for the owner, in the pr skill's template (Shipping step 1), so it is outside this rule.
- ALWAYS: Land everything you learn in this repo, as a PR or a line to your lead (playbook's **memory** rule), so every session works better from what one learned.
  Claude Code's auto-memory (`~/.claude/projects/*/memory`) stays off: `.claude/settings.json` and `scripts/factory-settings.json` set `autoMemoryEnabled` to false, and `tests/scripts/factory-settings.test.ts` holds both to it; [ADR 0009](./.agents/adr/0009-learnings-live-in-the-repo.md) records why.
- ALWAYS: Track Playground's work as GitHub issues on the repo `factory.repo` names, so every item carries a number: an item's ID is `PG-<issue number>`, its branch `PG-<n>-<slug>`, its PR scope `(PG-<n>)`, and the issue stays open until the PR that says `Closes #<n>` merges.
  The key is written uppercase, and branch and title readers take either case; macOS ignores case, so a new branch never reuses an old one's number and slug in the other case.
  Research and findings go in issues too, labelled `research`, with no customer data, production numbers or secrets.
  For Playground this replaces the Working notes' "closed once captured": an issue stays open while its work is live, and its `doc plan-<slug>` item still holds the plan.
  A close someone makes by hand as completed cites the evidence for each Done when item in its comment, since a read that agrees is a claim and the citation is the evidence: the file:line or the test, or each ask in the body when the issue lists no Done when.
  GitHub's own close on the `Closes #<n>` merge needs no comment, since the PR's review has already checked each item.
- ALWAYS: Keep app copy generic, so anyone can run the app: the app speaks to the signed-in owner as you and names no person, and an org-specific value (a GitHub org, a Linear team, a Slack channel, the dispatcher's name, a path) comes from config with a sensible default.
  The skills stay the owner's own.
- A new worktree can clone a sibling's `node_modules` in place of a full install, through run-slot ([scripts/README.md](./scripts/README.md#a-worktrees-node_modules)).
  Remove worktrees one at a time, never in parallel, and keep one review worktree across a PR's rounds.
- Every worktree of a checkout shares one `git stash` list, so a pop can take another worker's entry: set work aside with a commit, and take a before-shot from a separate worktree on `origin/canary`.
- Squash a branch with `git reset --soft $(git merge-base HEAD origin/<base>)`, never onto a base that has moved: the soft reset keeps the branch's old copies of whatever the base changed since, and the squash reverts it.
  Check the file list after.
- When the owner asks to see a draft, a tree or a restructure, show it in chat and change no file until told to apply it.
- Run inscope as `npx -y inscope@latest <command>`; it is not on `PATH`.
- Format with `bun run format` (oxfmt, `.oxfmtrc.jsonc`), not prettier, whose semicolons and 80-column wraps survive an oxfmt pass.
- `scripts/link-skills.sh` installs the home skill set and links the factory's settings, its brief templates, the `playground` command and the ops scripts into the main checkout, so a pull there updates them.
  Re-run it after adding, renaming or removing a skill ([scripts/README.md](./scripts/README.md#link-skillssh-and-rerere)).
- The main checkout stays clean, since every installed skill follows it.
  turbo.json's `cacheDir` keeps each worktree's turbo cache inside that worktree (turbo would otherwise share the main checkout's `.turbo/cache`), so no build, dev stack or pre-commit hook in a worktree leaves files there.
  The pre-commit hook sets `TURBO_CACHE_DIR` to `~/.cache/turbo/playground`, one folder outside every checkout, so worktrees share entries keyed by their inputs and the main checkout stays clean.
- Every worktree shares one `.git/hooks`, and lefthook.yml's `lefthook: bun node_modules/.bin/lefthook` makes each hook run the committing worktree's own lefthook, never the binary of whichever worktree last ran `bun install` (which goes when that worktree is removed).
  So a worktree commits, pushes or merges once it has run `bun install`; one that stops on `error: Script not found "node_modules/.bin/lefthook"` needs it.
  lefthook rewrites the shared hooks whenever the committing worktree's config differs from the last install's, so a worktree branched before this setting puts the old hook back on its next commit until it rebases onto `canary`.
- Run `bun run test:skills`, CI's `auto-test.yml` steps, before pushing a change to a hook, a script, a skill's frontmatter, or a command that starts a database or stops a process ([scripts/README.md](./scripts/README.md#bun-run-testskills)).
- The em-dash rule above has one exception: an output format the user specified, such as linear's table, where `—` marks an empty cell.
  `scripts/check-em-dashes.sh` skips inline code and table cells that hold only an em-dash.
- ALWAYS: In every comment and review body on any of the owner's repos, this one included, write "ship" or "publish step" where "release" (any case) would go, since an owner comment holding the word publishes to npm; `no-release-comment` refuses such a comment ([scripts/hooks/README.md](./scripts/hooks/README.md)).
- ALWAYS: File a new Linear ticket only after the owner's yes, posted as one Inbox `ticket` decision, and keep Playground's own work out of Linear (playbook's **tickets** rule); `no-linear-ticket` refuses a factory session's ticket create whose title no approval names ([scripts/hooks/README.md](./scripts/hooks/README.md)).
- ALWAYS: Keep Playground out of every ticket, PR, commit, branch, comment, chat message or DM of an org it works for, and every file in an org's repo (playbook's **classified** rule); `no-playground-leak` refuses an org write that holds a Playground term, and a post in the factory's channel without its signature ([scripts/hooks/README.md](./scripts/hooks/README.md)).
- ALWAYS: Send every link in a Slack post as a link chip in its full shape; `no-bare-slack-link` refuses a factory session's post holding a URL no chip carries, and its reason gives the chip ([scripts/hooks/README.md](./scripts/hooks/README.md)).
- A factory session starts another only through `scripts/spawn.sh`, whose capacity gate, backends, models, runtimes, resume and restore are in [scripts/README.md](./scripts/README.md#spawnsh): read it before you change spawn.sh or when it refuses a start you did not expect;
  `no-raw-spawn` refuses a cmux call that opens a claude session, and every herdr call but a read or one to a scratch world of the session's own.
- The herdr servers belong to one ops job, `bun run ops:herdr`, on the binary and config its `pin.json` names ([scripts/README.md](./scripts/README.md#the-herdr-servers)), read before you change that job or herdr's pinned binary or config.
- The factory's hooks, each in full under its name in [scripts/hooks/README.md](./scripts/hooks/README.md), which a session reads before it changes a hook, its tests or its registration, or when a hook refuses a call it did not expect;
  five more registered hooks are named in the lines above, each with its own pointer to its text (`no-bare-slack-link`, `no-playground-leak`, `no-linear-ticket`, `no-raw-spawn`, `no-release-comment`), and the rest are these:
  - `.claude/settings.json` registers every hook `scripts/factory-settings.json` does under the same command string, byte for byte, so a session cmux restores without its settings keeps its guards and runs each once.
  - `after-compact` tells a factory session that has just compacted to load playbook again and reread its roster entry, open Inbox items and PRs.
  - `after-resume` tells a resumed factory session to re-arm its loops, crons and watches, and re-send each message unanswered in the 10 minutes before the restart.
  - `no-chat-question`, the Stop hook of the dispatcher and the leads, refuses a final reply that asks the owner for a decision or an action unless it names an open `#iN`: name the one already open on the same thing, or else post it with `bun run ask new`.
  - `no-env-dump` refuses printing the environment (`env` with no command, `printenv`, a bare `set`, `declare`, `export` or `typeset`), since it holds tokens.
  - `no-false-green` refuses bun given `--opt <value>` before its `run` or `test`, and a test run (bun's, or pytest, ty or ruff) piped on with no `pipefail` or pipe status, so a red run reads red.
  - `no-glm-heavy-path` keeps a GLM session's commits and pushes off the heavy paths, and holds its installs, clones, commits and pushes while load5 is over 15 (playbook's **glm**).
  - `no-headless-login` refuses a factory session's `claude -p` that sets no `CLAUDE_CODE_OAUTH_TOKEN`, and its `PLAYGROUND_ROLE` when its environment lacks one: run it in the shape its reason gives.
  - `no-mac-web-build` refuses a web image build on the Mac while the live dashboard's Postgres runs in its Docker VM: build it on the box with `ci.sh web HEAD`.
  - `no-main-checkout` refuses a build, test, commit, write or git move in the main checkout: run it in your own worktree, with `git -C <your worktree>`.
  - `no-manager-subagent` refuses a manager the Agent and Workflow tools: start a worker through `scripts/spawn.sh` and brief it.
  - `no-off-palette-label` refuses any session's GitHub label create or edit whose color is not a Tailwind 500, and a create with no color: give one of the 22 hexes its reason names.
  - `no-ours-merge` refuses a merge or pull with the ours strategy or option: run `git merge origin/canary` and resolve each conflict with both sides' meaning.
  - `no-public-leak` refuses a write to a public repository (a pull request, issue, review, comment or stamp) that holds a name, a handle, a company term, a Slack id, a Linear key, an email, an `LM-<n>` or an archive link, naming the kind and never the text: say it in plain words.
  - `no-prompt-stop` refuses the `rm` or `rmdir` shapes Claude Code stops on: a target with two or more parts starting with an unguarded variable (write `${VAR:?}` or a literal path), and a name directly in `/` (use `$TMPDIR` or your scratchpad).
  - `no-stash` refuses a stash that could take another worktree's work, and `agent-browser close --all`.
  - `no-unslotted-run` refuses a heavy run in a worktree (an install, a `node_modules` clone, a build, a type check, a suite) outside `~/.playground/ops/run-slot.sh`.
  - `rules` gives a factory session its standing rules at every start.
  - `session-state` writes every session's state to the data folder's `session-state/<session id>.json`, which ops-session-resume and the Dashboard read, and tells a factory session's manager the moment it writes `stuck` or `failed`.
  - `writing-first` refuses a factory session's write to an agent-facing doc until it has loaded writing-for-agents since its last compaction: load it with the Skill tool, then retry.

### The factory

Playground's sessions run as a factory: the dispatcher manages, the Builder leads the workers (`<id>-worker`), Ops leads the runners (`<id>-runner`) and the ops jobs, and a probe (`<id>-probe`) lives for one test.

- ALWAYS: Load [playbook](./extensions/core/skills/playbook/SKILL.md) when you are one of those sessions, or before you spawn, brief, rename or end a cmux session.
  Its roles, chain, lifecycle, sweep and standing rules bind every session in the factory.
- ALWAYS: Signal only processes you started; never select pids by name or pattern.
  A pattern matches the live dashboard and every worker's stack.
  A port is no narrower: whoever holds portless's proxy port is the proxy every worktree routes through, the live dashboard's included.
  Stop a background task with `TaskStop`, a dev stack whose starting session has gone with `bun run dev:stop` (it signals only the process groups of the launcher its checkout recorded), and a child you spawned through its own pid or process group; every brief you write carries this rule.
  `tests/test_kill_by_name.py` fails on a kill by name, pattern or port anywhere in the repo's text.

### The dashboard app

The app in `api/hono` and `web/next` is Playground's dashboard: a local-only board of the Claude Code sessions Playground started (its herdr servers' and the one it hosts), and of every one cmux runs on a stack that opts in, reached at `/dashboard`.

Its rules live in one file per topic under `.agents/dashboard/`, and a change to a dashboard rule edits the topic file that holds it.
Each topic below names when to read its file, and each ALWAYS line is that file's rule in short: the file holds it whole, with its reasons.
When a dashboard rule's meaning changes, its ALWAYS line here changes with it.

- Stack: read `.agents/dashboard/stack.md` before you change how `bun run dev` starts, which machine a stack reads, the fixture (`api/hono/src/fixtures/dashboard.json`), the dashboard's data folder, the organisation's config (`packages/config/src/org.ts`) or the `claude_*` tables.
  - ALWAYS: Start it (`bun run dev`) as a process of a cmux terminal, or as a background task of an agent session in one, never detached with `( … &)` or `nohup`.
  - ALWAYS: Serve first run's setup with none of the app's database or auth code loaded: with `POSTGRES_URL` empty, `api/hono/src/main.ts` serves `firstRun()`'s setup routes, `GET /api/v1/onboard/checks`, the first run's fix routes and a `setup: true` `GET /api/health` alone until Start a local container finishes, whose database is pglaunch's as is.
  - ALWAYS: A person's stack reads their own machine, while factory, test and `PLAYGROUND_FIXTURE` stacks read the fixture and the live dashboard's checkout reads the live machine, as `dashboardSource()` in `api/hono/src/lib/dashboard/fixture.ts` decides.
  - ALWAYS: Keep it on loopback: the API and `next dev` bind 127.0.0.1, and the dashboard is never deployed.
  - ALWAYS: Stop `bun run dev` before running `bun run build`, `bun run check-types` or `bun run test`, or committing, in the same worktree.
  - ALWAYS: Keep the dashboard on the owner rung: every route and the WebSocket pass `requireConsoleRole("owner")`, but first run's setup routes, which serve before any user exists.
  - ALWAYS: Keep the `claude_*` tables (`packages/db/src/schema/claude.ts`: each stored session's transcript, line by line, Playground's own alone unless the stack opts in) in the dashboard's local Postgres on 127.0.0.1, never a shared database.
  - ALWAYS: Read an organisation's own values from `packages/config/src/org.ts`, and every file the dashboard keeps outside the database from its data folder, `dataDir()`.
- Cmux: read `.agents/dashboard/cmux.md` before you change a cmux or herdr call, how a session counts as live, the board's read pacing or the System panel's commands.
  - ALWAYS: Route every cmux call through `api/hono/src/lib/dashboard/cmux.ts`, which takes only the reads in `READ_COMMANDS`, one session's own writes and `reply()`'s answer to one pending Feed prompt; the factory's `playground picker` alone answers a manager's session's Feed permission itself.
  - ALWAYS: Route every herdr call through `api/hono/src/lib/dashboard/herdr.ts`, the dashboard's second terminal beside cmux.
  - ALWAYS: Count a cmux record as a live session only through `liveRecords()`, and keep the read of every record paced as `workers.ts` paces it.
  - ALWAYS: Run the System panel's commands only through `api/hono/src/lib/system/probe.ts`, whose `COMMANDS` holds each one's fixed argv.
- Messages: read `.agents/dashboard/messages.md` before you change how a message, a file or an answer reaches a session, the composer, the session the dashboard hosts on the Agent SDK, how a transcript renders, or the outbox and the stream's scroll.
  - ALWAYS: Send anything to a session through `deliver()` in `api/hono/src/lib/dashboard/deliver.ts`, and only for the owner's own clicks, since its text reads as the owner's.
  - ALWAYS: Send a herdr session (cmux.md) the message as one `agent.prompt` through `prompt()` in herdr.ts, from `deliver()` alone.
  - ALWAYS: Reach the session the dashboard hosts on the Claude Agent SDK only through `api/hono/src/lib/dashboard/sdk.ts`.
  - ALWAYS: Keep a message's files in the owner-only attachments folder, never in a database.
  - ALWAYS: Render text from a session's transcript through `TranscriptMarkdown`, or give your own Streamdown its `TRANSCRIPT_COMPONENTS` and `transcriptUrlTransform`.
  - ALWAYS: Send a message from the web through the dashboard's outbox (`useDashboard().outbox`), not `sendMessage` alone.
- Writes: read `.agents/dashboard/writes.md` before you change a dashboard write or a `bun run verify` check, and before you add, move or remove a dashboard page, a sidebar group or an owner-rung API route.
  - ALWAYS: Guard every dashboard write with `requireTrustedOrigin` and `requireLoopback` (`api/hono/src/middlewares/dashboard.ts`) before the session is read, then the owner rung; first run's writes, with no session yet, take `requireThisMachine` in place of the rung.
  - ALWAYS: Test a dashboard write on a fixture stack, and reach a real cmux session only from a live-reads stack opted in to cmux's sessions, against a throwaway probe.
  - ALWAYS: Verify dashboard work with `bun run verify` (`--help` lists its checks) rather than a script of your own.
  - ALWAYS: Keep the dashboard map current.
    `packages/scripts/src/verify/dashboard-map.json` changes in the same PR as a dashboard page, a sidebar group or an owner-rung API route.
- Sidebar: read `.agents/dashboard/sidebar.md` before you change the sidebar's rows, groups or lights, the Scripts group, the managers' order, its header's icons, the tab's favicon dot or the user menu.
- Asks: read `.agents/dashboard/asks.md` before you change the Inbox or the aside window's tab squares, and before you run `bun run ask` or `bun run thread`.
- Apps: read `.agents/dashboard/apps.md` before you change an app under `/dashboard/apps`: Changelog, or the parked Plan, Previews and Usage.
- Dashboard: read `.agents/dashboard/dashboard.md` before you change `/dashboard`'s chat, an agent's view with its Pages tab, the System or Settings page, or `GET /api/v1/agents` and `GET /api/v1/system`.
- Roster: read `.agents/dashboard/roster.md` before you change the roster's shape or its reader, `api/hono/src/lib/dashboard/roster.ts`.
- Ingest: read `.agents/dashboard/ingest.md` before you change `bun run ingest`, and before you start or restart its follower.
- Live: read `.agents/dashboard/live.md` before you change how the live dashboard rolls onto `canary`.
- Sessions: read `.agents/dashboard/sessions.md` before you change the Sessions pages.

### Shipping a Playground PR

The owner does not review Playground PRs: the review loop is the gate ([ADR 0004](./.agents/adr/0004-an-independent-reviewer-is-the-gate.md)), inside ZeroStarter's flow.

1. Make the change on a branch from `origin/canary` in `.claude/worktrees/`, with a test or a red-first check when behaviour changes, and open it as a draft into `canary` whose body paraphrases its ask.
   The body is written with the [pr](./extensions/core/skills/pr/SKILL.md) skill, called through the Skill tool: a `## TL;DR` of two sentences or more on top, then its Summary, Evidence and Merge Danger, then `## Links` last.
   Its TL;DR is in plain words: what the owner sees or can do now, in words a person uses, with no factory or code jargon such as pane, slot or jsonb.
   The body gate (`packages/scripts/src/pr-merge/body.ts`, read by Checks, `pr:merge`, merge-on-ready and the train) takes the template, its TL;DR free of `Outcome:` label lines.
   The Changelog (`api/hono/src/plugins/changelog/sources.ts`) reads a body's `Outcome:` line, else the TL;DR's first bullet or a prose TL;DR's first sentence.
   Before the review's round 1, settle in your own pass what a round should never spend its turn on (most late findings were docs, skill, body and wording ones): run doc-sync over the change, give each touched doc and skill a writing-for-agents read (a completion criterion on every step, positive phrasing, reference disclosed into sibling files, one meaning in one place),
   and fill the template above; the reviewer still judges everything.
   Done when the body's Evidence names each touched doc and skill with its check, and doc-sync's result, before the review's round 1 opens.
2. Have a reviewer agent other than its author (a session started for the review, working in its own scratch clone, whose brief carries the signal rule from The factory, above) score it out of 5 through the [code-review-loop](./extensions/core/skills/code-review-loop/SKILL.md) skill, and fix what it finds, until it scores 5/5 on the latest head,
   GitHub Actions' `Audit, Lint, and Build` and `test` are green there (they stand for local CI, and for Checks when the diff touches no dashboard code), and nothing is left you would change.
3. Mark it ready at 5/5 and merge it with `bun run pr:merge <n>`, or let a merge train land it (`bun run pr:train`): the only ways a Playground PR reaches `canary`.
   Their gates, the stamp they read, its carry past a clean `canary` merge, the merge lock and the train are written in [packages/scripts/src/pr-merge/README.md](./packages/scripts/src/pr-merge/README.md); read it before a merge or a ruling on a gate.
4. `main`, which the main checkout and so every installed skill follows, moves only through the `release` skill, run by Ops on the owner's standing go-ahead (playbook's **release** rule).
   Once a release lands, bring the main checkout up to it by the skill's step 5 (pull, install, build, restart each ops job whose source changed, `scripts/link-skills.sh`), and say what landed.

Read [.agents/skill-trial.md](./.agents/skill-trial.md) before you try a skill headless before it merges.

### Findings from other sessions

Every skill tells the `dispatcher` session what it learned: a hurdle it got past, a fix, a faster way.
When one arrives:

1. Check it against the skill and, when it can be checked, reproduce it.
   A claim is not evidence.
2. Take it through ***Shipping a Playground PR**, above.
3. Reply to the sender with the PR once it has merged.

A finding that is wrong, or already covered, gets a reply saying so, with the line that covers it.

### Standalone

Playground stands on its own: every skill runs only Playground's own scripts, and its rules come from the owner, from ZeroStarter, and from the repos the skills work in.
Other teams' agent setups, their skills, scripts and agents included, are not a source to read, copy or port from.
The upstream skills core keeps are the one exception: each sits at `extensions/core/skills/<name>/` as upstream's files at the sha `extensions/core/upstream/SOURCE` pins, under upstream's `LICENSE` beside it, while the root `NOTICE` covers this repo's own code ([ADR 0014](./.agents/adr/0014-upstream-skills-are-vendored-byte-for-byte.md)).
Only `bun run vendor:upstream` changes them, and `tests/extensions/core/upstream/drift.test.ts` holds them to the pin.
Our skills and briefs call them through the Skill tool, never forking one, but for `pr` (below), and add only Playground's own layer ([ADR 0009](./.agents/adr/0009-learnings-live-in-the-repo.md)).
`pr` is the one copy, since the gates and the Changelog read its added blocks: `extensions/core/skills/pr/` is upstream's SKILL.md and CREDITS.md byte for byte plus a TL;DR and a Links block, which `tests/extensions/core/skills/pr/drift.test.ts` holds against a pinned copy.
