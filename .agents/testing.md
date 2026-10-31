# Testing

## The sandbox

A bare `bun test` from the repo root stops at `tests/require-sandbox.ts`, which `bunfig.toml` preloads, since only `test-sandbox.ts` gives a test a scratch home in place of the real one; bun reads `bunfig.toml` from the folder it runs in, so a run from a subfolder goes unguarded.
That sandbox (`packages/scripts/src/sandbox.ts`) also sets `TZ=UTC`, so a test's children read one zone on the Mac and the runner box; a test of code that reads local time gives its child its own `TZ`.
It keeps uv's Pythons and cache the real home's (`UV_PYTHON_INSTALL_DIR` and `UV_CACHE_DIR`, read before it swaps HOME), so a child's `uv run --python 3.13` finds its Python in place of downloading one.
It also puts a fake `claude` and a fake `gh` first on PATH, each exiting 99 with a line naming the sandbox, so no test starts a session or reaches GitHub; a test that needs `gh`'s output puts its own fake ahead of the sandbox's on PATH.
Run from a folder with none of the env files `bun test` loads (`.env`, `.env.test` and `.env.test.local`, never `.env.local`), such as a skill-only worktree, `test-sandbox.ts` sets `SKIP_ENV_VALIDATION=true` for its tests unless the caller set it, so one whose import validates the env still runs there.

## The run

`bun run test` builds `packages/*` first, because a test reaches a shared package through its `exports`, which point at `dist`, so on a fresh checkout an unbuilt package resolves to nothing.
Only the shared packages are built, not the apps: a test imports app code by source path and never through `dist`.
It runs the files in parallel (`packages/scripts/src/test-sandbox.ts`: `bun test --parallel`, the cores less one and at most 4, the slowest first by `tests/timings.json`, on GitHub the merged one below, which `bun run test:timings` rewrites after a run), then its `SERIAL` files one at a time.
A test runs beside the others when it shares nothing with them: it binds port 0, starts its containers unnamed or named per process, and takes its scratch folders from `mkdtemp`; one that cannot joins `SERIAL`.
So does one that rebuilds a package or moves a file other tests read, since a worker beside it would read the half-built file, and one that hangs only beside other workers.
In the parallel pass each test gets 30s where bun gives 5s, since a test runs slower beside other workers; a test's own timeout wins, so read it first.
A parallel pass still running at its deadline (`TEST_PARALLEL_DEADLINE_MS`, 20 minutes, which the runner box's `suite.sh` raises and each of GitHub's shards lowers to 10, inside its own 20-minute `timeout-minutes`) is killed and fails, naming the files its workers still held, since bun's own timeout cannot stop synchronous code; the run's first line names the deadline it holds.
GitHub runs the suite as shards rather than one run: `packages/scripts/src/test-shards.ts` packs the files longest first into as many shards as its budget of recorded file time (`BUDGET_MS`) needs, by `tests/timings.json`, where a file with none weighs the mean.
Each shard runs its own files through `test-sandbox.ts`, and the `Audit, Lint, and Build` check is green only when every shard and the lint and build job passed.
A new test file needs no timing to run, and the split follows the suite with no hand run: each shard keeps its files' times as the run artifact `timings-<n>` (`TEST_TIMINGS_UPDATE`; bun times no `SERIAL` file, so those keep the committed time until a hand `bun run test:timings`).
The Shards job merges the newest passing run's over `tests/timings.json` before it splits (`packages/scripts/src/test-timings.ts`), every shard splitting by that one merged file.
Only a run from a branch of this repo counts, since a fork's run could upload any times; with none to read, the split keeps the committed file, and a shard whose artifact does not read is skipped by name.
No workflow commits the merged times, since a change reaches `canary` only through `pr:merge`, so the committed file stays a seed that `bun run test:timings`, committed in any PR, refreshes.
`tests/` is fork-excluded, so the root script no-ops where the directory is absent.

## Traps

A test file is the smallest piece a shard takes, and its cases run one after another, so a file whose every case starts a subprocess (`spawn.sh` under `tests/scripts/spawn-fake.ts`, about 0.5s a case, measured) grows by that much with every case it gains.
Keep each such file under 60s on GitHub, since a file is the floor under its shard's time, by splitting it by `describe` into files of their own (`tests/scripts/spawn-*.test.ts`), with their shared helpers in the fake.
`bun test` also loads the working directory's `.env` into `process.env`, so a test that hands `...process.env` to a child and writes a scratch `.env` for it drops each key that file sets, since the inherited value wins over the file.
An `expect(...).rejects` or `.resolves` is awaited or returned, or is the body of an arrow helper whose every call is, since in bun:test one that is not passes while checking nothing; `tests/async-expect.test.ts` fails on any that is not.
A Bun SQL query is a lazy thenable that runs only when awaited, and `await expect(sqlQuery).rejects` never runs it, holding a sandbox worker to its deadline with no output: await the query in a helper and assert on the error's message (`refusal()` in `tests/api/hono/src/lib/store/store-db.test.ts`).
React Query's `refetchInterval` never fires under `bun test`, with real or fake timers: query-core (5.104.5) reads `isServer` as `typeof window === "undefined"` once at load, and its observer sets no refetch timer while `isServer()` is true.
Call `environmentManager.setIsServer(() => false)` (exported by `@tanstack/react-query`) in `beforeAll`, and `environmentManager.setIsServer(() => true)` in `afterAll`, so the file's own later tests run as on a server again:
measured in the parallel pass, a 50 ms interval fetched 8 times in 400 ms with it and once without, and a file run after it in the same worker, its restore removed, still read `isServer()` as true,
since each file loads its modules afresh.
Else test the query's options themselves (`inboxPolling()` in `tests/web/next/src/lib/tab-dot.test.ts`), or time the query in a child process that sets `window` before it loads query-core.
A test that builds a child's env from scratch rather than from `process.env` passes `UV_PYTHON_INSTALL_DIR` and `UV_CACHE_DIR` through (`drive()` in `tests/scripts/ops/unstick/run.test.ts`), since a child's `uv run --python 3.13` without them downloads a 66 MB CPython into the scratch home, and on a slow network each case's download outlasts its 30s and starts again in the next.
`Bun.which(name)` reads the PATH the process started with, so code under test that looks a tool up that way runs the real tool wherever one is installed and misses a stub the test prepends to `process.env.PATH`: look it up with `Bun.which(name, { PATH: process.env.PATH ?? "" })` (`packages/scripts/src/ops-ext-sync/sync.ts`), or take the lookup as a dependency the test passes in.

## End-to-end tests

No end-to-end suite exists: `bun run test:e2e` matches no file.

The new-user gate is the one end-to-end run: `bun run gate:new-user <sha>` (`packages/scripts/src/new-user-gate/`) installs that sha the way `curl | bash` does, in a scratch HOME under `/tmp/pg-gate-<sha7>` with stand-ins for claude, gh, cmux, brew, security and sudo (`stubs.ts`), its own portless proxy on port 14155, and a pglaunch stand-in that publishes its container on loopback alone.
Before the install it checks that the box's zsh, plain and login, finds every stand-in in the box's stubs folder, and stops with exit 2 naming each one it finds elsewhere, so no job the box starts reaches a real binary.
Its claude runs a scripted session (`claude.ts`) for each launch spawn.sh makes: the dispatcher hands the typed task to the builder, the builder to a worker, and the worker runs `gh pr create`, calling no model.
The ops-usage job reads made-up usage windows from the box (`PLAYGROUND_USAGE_API`), so Usage shows a reading on a made-up login, once the installed sha's `scripts/ops/usage/run.py` reads that variable.
It then checks the seven steps a new user meets (the install's finish, first run's database click, Alpha on the Dashboard, a routed task opening a PR, Usage, the Scripts group, the roll following main), prints PASS, FAIL or INCONCLUSIVE for each, and leaves a screenshot per step and the box's logs in `/tmp/pg-gate-<sha7>-shots` after removing the box, its processes and its container.
Before the install it waits up to 10 minutes for this Mac's load to fall under the line spawn.sh's load gate holds a dispatcher's start to, and says how long it waited.
The box sets `PLAYGROUND_LOAD_MULT=10` (`BOX_LOAD_MULT`, printed at the start), so the host's other sessions never hold a start there, since the gate checks what a new user meets on a quiet Mac.
A step that fails while spawn.sh's capacity gate refused a start in the box (its `capacity.jsonl`, now its memory or usage gate) reads INCONCLUSIVE with that refusal, since the gate reads this Mac, not the build.
Run it through run-slot before each ship (the release skill's step 1); it exits 1 when a step fails.
