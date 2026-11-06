import { expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
// run through bun, since node_modules/.bin/lefthook is an npm wrapper whose shebang wants node
const LEFTHOOK_BIN = "node_modules/.bin/lefthook"
const OWN_LEFTHOOK = `bun ${LEFTHOOK_BIN}`
// what a hook prints in a worktree with no lefthook installed, as AGENTS.md quotes it
const NO_LEFTHOOK = `error: Script not found "${LEFTHOOK_BIN}"`

// Of the hooks a checkout runs, git writes to stdin only for these. Anywhere else use_stdin reads nothing under git, but a hand-run `lefthook run <hook>` reads the caller's stdin to its end, so from an agent's shell, whose stdin never closes, it hangs.
const FED_BY_GIT = new Set(["post-rewrite", "pre-push", "reference-transaction"])

// Every path under a hook's config (commands, scripts, jobs, nested groups) that sets use_stdin.
const readingStdin = (node: unknown, path: string): string[] => {
  if (Array.isArray(node)) return node.flatMap((item, i) => readingStdin(item, `${path}[${i}]`))
  if (typeof node !== "object" || node === null) return []
  return Object.entries(node).flatMap(([key, value]) =>
    key === "use_stdin" && value === true ? [path] : readingStdin(value, `${path}.${key}`),
  )
}

test("only a hook git feeds on stdin reads it", async () => {
  // every YAML name lefthook reads its config and its local overrides from; this repo writes no TOML or JSON one
  const files = ["", "."]
    .flatMap((dot) =>
      ["yml", "yaml"].flatMap((ext) => [`${dot}lefthook.${ext}`, `${dot}lefthook-local.${ext}`]),
    )
    .map((name) => Bun.file(join(import.meta.dir, "..", name)))
  const reading: string[] = []
  for (const file of files) {
    if (!(await file.exists())) continue
    const config = (Bun.YAML.parse(await file.text()) ?? {}) as Record<string, unknown>
    for (const [hook, body] of Object.entries(config)) {
      if (!FED_BY_GIT.has(hook)) reading.push(...readingStdin(body, hook))
    }
  }
  expect(reading).toEqual([])
})

test("readingStdin finds use_stdin in commands, scripts and nested jobs", () => {
  expect(
    readingStdin(
      {
        commands: { build: { run: "x", use_stdin: true } },
        jobs: [{ group: { jobs: [{ run: "y", use_stdin: true }] } }],
        scripts: { "a.sh": { use_stdin: true }, "b.sh": { use_stdin: false } },
      },
      "pre-commit",
    ),
  ).toEqual([
    "pre-commit.commands.build",
    "pre-commit.jobs[0].group.jobs[0]",
    "pre-commit.scripts.a.sh",
  ])
})

test("the hooks run the committing worktree's own lefthook", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    lefthook?: string
  }
  expect(config.lefthook).toBe(OWN_LEFTHOOK)
})

// nothing from this machine's git or lefthook settings: git exports GIT_DIR into hooks, a global core.hooksPath stops the install, commit signing would reach for a real key, and LEFTHOOK=0 skips hooks
const SCRATCH_ENV: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !/^(GIT_|LEFTHOOK)/.test(entry[0]),
    ),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
}

// lefthook itself, in a scratch repo of its own with linked worktrees: hooks installed from one that is then removed still run in another with node_modules, and fail loudly in one without.
test("hooks outlive the worktree that installed them, and fail loudly without a lefthook", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lefthook-"))
  const run = (cwd: string, argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const git = (cwd: string, ...args: string[]) =>
    run(cwd, ["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args])
  // a staged file, since lefthook skips a command when nothing is staged
  const commit = async (cwd: string, message: string) => {
    await Bun.write(join(cwd, `${message}.txt`), message)
    expect(git(cwd, "add", `${message}.txt`)).toMatchObject({ code: 0 })
    return git(cwd, "commit", "-q", "-m", message)
  }
  const withLefthook = (cwd: string) => {
    mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true })
    symlinkSync(join(ROOT, LEFTHOOK_BIN), join(cwd, LEFTHOOK_BIN))
  }
  const [main, a, b, c] = ["main", "a", "b", "c"].map((name) => join(dir, name)) as [
    string,
    string,
    string,
    string,
  ]
  try {
    mkdirSync(main)
    expect(git(main, "init", "-q")).toMatchObject({ code: 0 })
    await Bun.write(
      join(main, "lefthook.yml"),
      `lefthook: ${OWN_LEFTHOOK}\npre-commit:\n  commands:\n    mark:\n      run: echo hook-ran\n`,
    )
    expect(git(main, "add", "lefthook.yml")).toMatchObject({ code: 0 })
    expect(git(main, "commit", "-q", "-m", "config")).toMatchObject({ code: 0 })
    for (const [path, branch] of [
      [a, "a"],
      [b, "b"],
      [c, "c"],
    ] as const) {
      expect(git(main, "worktree", "add", "-q", "-b", branch, path)).toMatchObject({ code: 0 })
    }
    withLefthook(a)
    withLefthook(c)

    expect(run(a, ["bun", join(a, LEFTHOOK_BIN), "install"])).toMatchObject({ code: 0 })
    const hook = await Bun.file(join(main, ".git/hooks/pre-commit")).text()
    expect(hook).toContain(`${OWN_LEFTHOOK} "$@"`)
    expect(git(main, "worktree", "remove", "--force", a)).toMatchObject({ code: 0 })

    const own = await commit(c, "own")
    expect(own).toMatchObject({ code: 0 })
    expect(own.out).toContain("hook-ran")

    // the hook's fallback binary is the one A's link resolves to, in this checkout, so it outlives A; B stopping anyway proves the hook never falls back to another checkout's lefthook
    const none = await commit(b, "none")
    expect(none.code).not.toBe(0)
    expect(none.out).toContain(NO_LEFTHOOK)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// lefthook on this repo's own pre-commit build step, its run swapped for an echo, in a scratch repo: docs and Python tests alone skip the build, anything else builds
test("the pre-commit build skips a commit of docs and Python tests alone", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: { build: Record<string, unknown> } }
  }
  const build = { ...config["pre-commit"].commands.build, run: "echo build-ran" }
  const dir = mkdtempSync(join(tmpdir(), "lefthook-build-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const buildsWith = async (files: string[]) => {
    expect(run(["git", "rm", "-q", "-r", "--cached", "--ignore-unmatch", "."])).toMatchObject({
      code: 0,
    })
    for (const file of files) await Bun.write(join(dir, file), file)
    expect(run(["git", "add", ...files])).toMatchObject({ code: 0 })
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    expect(hook).toMatchObject({ code: 0 })
    return hook.out.includes("build-ran")
  }
  try {
    expect(run(["git", "init", "-q"])).toMatchObject({ code: 0 })
    // JSON is YAML, so the step goes in as lefthook read it
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({ "pre-commit": { commands: { build } } }),
    )
    const skipping = ["README.md", "docs/playground/x.md", "skills/a/SKILL.md", "tests/test_x.py"]
    expect(await buildsWith(skipping)).toBe(false)
    // lefthook's * crosses folders: nested Markdown alone and a nested Python test alone skip too
    expect(await buildsWith(["skills/playground/x/SKILL.md", "docs/playground/x.md"])).toBe(false)
    expect(await buildsWith(["tests/scripts/hooks/x.py"])).toBe(false)
    expect(await buildsWith(["docs/playground/x.md", "api/hono/src/x.ts"])).toBe(true)
    expect(await buildsWith(["api/hono/src/x.ts"])).toBe(true)
    expect(await buildsWith(["package.json"])).toBe(true)
    expect(await buildsWith([...skipping, "web/next/src/y.tsx"])).toBe(true)
    expect(await buildsWith(["tests/api/x.test.ts"])).toBe(true)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// lefthook on this repo's own type-check steps, through this checkout's commit-slot.ts and tsc, in a scratch repo holding a minimal tests/ and packages/scripts: a staged type error in either tree fails the commit, as CI's check-types does, and a commit staging neither runs neither, whatever the working tree holds
test("the pre-commit type checks fail a staged type error in a test or a packages/scripts file", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const { "check-types-scripts": scripts, "check-types-tests": tests } =
    config["pre-commit"].commands
  const own = (step: Record<string, unknown> | undefined) => ({
    ...step,
    run: String(step?.run).replaceAll(
      "packages/scripts/src/",
      `${join(ROOT, "packages/scripts/src")}/`,
    ),
  })
  const manifest = async (path: string) =>
    (await Bun.file(join(ROOT, path)).json()) as { scripts: Record<string, string> }
  const dir = mkdtempSync(join(tmpdir(), "lefthook-types-"))
  const env = { ...SCRATCH_ENV, PATH: `${join(ROOT, "node_modules/.bin")}:${SCRATCH_ENV.PATH}` }
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const tsconfig = JSON.stringify({
    compilerOptions: { module: "ESNext", noEmit: true, strict: true, target: "ESNext", types: [] },
  })
  const commitWith = async (files: Record<string, string>) => {
    expect(run(["git", "rm", "-q", "-r", "--cached", "-f", "--ignore-unmatch", "."])).toMatchObject(
      {
        code: 0,
      },
    )
    for (const [file, text] of Object.entries(files)) await Bun.write(join(dir, file), text)
    expect(run(["git", "add", ...Object.keys(files)])).toMatchObject({ code: 0 })
    return run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
  }
  try {
    expect(run(["git", "init", "-q"])).toMatchObject({ code: 0 })
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          "check-types:tests": (await manifest("package.json")).scripts[
            "check-types:tests"
          ]!.replaceAll("packages/scripts/src/", `${join(ROOT, "packages/scripts/src")}/`),
        },
      }),
    )
    await Bun.write(
      join(dir, "packages/scripts/package.json"),
      JSON.stringify({
        scripts: {
          "check-types": (await manifest("packages/scripts/package.json")).scripts["check-types"],
        },
      }),
    )
    await Bun.write(join(dir, "packages/scripts/tsconfig.json"), tsconfig)
    await Bun.write(join(dir, "tests/tsconfig.json"), tsconfig)
    // JSON is YAML, so the steps go in as lefthook read them
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: { "check-types-scripts": own(scripts), "check-types-tests": own(tests) },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    const broken = await commitWith({ "tests/a.test.ts": 'export const n: number = "one"\n' })
    expect(broken.code).not.toBe(0)
    expect(broken.out).toContain("TS2322")
    // TS1375: a top-level await in a file with no import or export, which reached CI alone on 3 Nov
    const script = await commitWith({
      "packages/scripts/src/x.ts": "await Promise.resolve()\n",
      "tests/a.test.ts": "export const n: number = 1\n",
    })
    expect(script.code).not.toBe(0)
    expect(script.out).toContain("TS1375")
    expect(
      await commitWith({
        "packages/scripts/src/x.ts": "export const x = await Promise.resolve(1)\n",
        "tests/a.test.ts": "export const n: number = 1\n",
      }),
    ).toMatchObject({ code: 0 })
    // both trees broken on disk but neither staged: the commit runs neither check
    await Bun.write(join(dir, "packages/scripts/src/x.ts"), "await Promise.resolve()\n")
    await Bun.write(join(dir, "tests/a.test.ts"), 'export const n: number = "one"\n')
    const neither = await commitWith({ "api/hono/src/y.ts": "export {}\n", "README.md": "x\n" })
    expect(neither).toMatchObject({ code: 0 })
    expect(neither.out).not.toContain("tsc")
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 120_000)

// lefthook on this repo's own build and type-check steps, each run swapped for an echo, in a scratch repo: the type checks read the build's dist, so they run after it
test("the pre-commit type checks run after the build", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const {
    build,
    "check-types-scripts": scripts,
    "check-types-tests": tests,
  } = config["pre-commit"].commands
  const dir = mkdtempSync(join(tmpdir(), "lefthook-types-order-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  try {
    expect(run(["git", "init", "-q"])).toMatchObject({ code: 0 })
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: {
            build: { ...build, run: "echo build-ran" },
            "check-types-scripts": { ...scripts, run: "echo scripts-ran" },
            "check-types-tests": { ...tests, run: "echo tests-ran" },
          },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    for (const file of ["packages/scripts/src/x.ts", "tests/a.test.ts"])
      await Bun.write(join(dir, file), "x")
    expect(run(["git", "add", "."])).toMatchObject({ code: 0 })
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    expect(hook).toMatchObject({ code: 0 })
    const [built, ...checked] = ["build-ran", "scripts-ran", "tests-ran"].map((mark) =>
      hook.out.indexOf(mark),
    )
    expect(built).toBeGreaterThanOrEqual(0)
    for (const at of checked) expect(at).toBeGreaterThan(built!)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// lefthook on this repo's own conflict-marker step, its script run from this checkout, beside lint-staged (run swapped for an echo), in a scratch repo: a staged marker refuses the commit before the formatter can rewrite it
test("the pre-commit marker check refuses a staged conflict marker before lint-staged runs", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const { "conflict-markers": markers, "lint-staged": lint } = config["pre-commit"].commands
  expect(markers).toBeDefined()
  expect(markers!.priority as number).toBeLessThan(lint!.priority as number)
  const dir = mkdtempSync(join(tmpdir(), "lefthook-markers-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const hookWith = async (text: string) => {
    await Bun.write(join(dir, "notes.md"), text)
    expect(run(["git", "add", "notes.md"])).toMatchObject({ code: 0 })
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    return { ...hook, linted: hook.out.includes("lint-ran") }
  }
  try {
    expect(run(["git", "init", "-q"])).toMatchObject({ code: 0 })
    // JSON is YAML, so the steps go in as lefthook read them
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: {
            "conflict-markers": {
              ...markers,
              run: String(markers!.run).replace("packages/", `${ROOT}/packages/`),
            },
            "lint-staged": { ...lint, run: "echo lint-ran" },
          },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    const refused = await hookWith("one\n<<<<<<< HEAD\ntwo\n=======\nthree\n>>>>>>> canary\n")
    expect(refused).toMatchObject({ linted: false })
    expect(refused.code).not.toBe(0)
    expect(refused.out).toContain("notes.md:2, notes.md:6")
    expect(await hookWith("one\ntwo\nthree\n")).toMatchObject({ code: 0, linted: true })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// every worktree of a checkout shares one stash list, so the pre-commit's lint-staged keeps no backup there (PG-715)
test("the pre-commit's lint-staged runs with --no-stash", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, { run: string }> }
  }
  expect(config["pre-commit"].commands["lint-staged"]!.run).toMatch(
    /\blint-staged\b.*\s--no-stash\b/,
  )
})

// lefthook on this repo's own lint-staged step (bunx swapped for this checkout's binary, the formatter this checkout's oxfmt), in a scratch repo holding one stash entry of its own: the commit's run leaves the stash list as it was, stages the formatted line and keeps a partially staged file's unstaged line
test("a commit through the pre-commit's lint-staged leaves the stash list as it was and keeps unstaged lines", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const lint = config["pre-commit"].commands["lint-staged"]!
  const linter = String(lint.run).replace(
    "bunx lint-staged",
    join(ROOT, "node_modules/.bin/lint-staged"),
  )
  expect(linter).not.toBe(String(lint.run))
  const dir = mkdtempSync(join(tmpdir(), "lefthook-no-stash-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const lines = [
    "const a = 1;",
    ...Array.from({ length: 12 }, (_, i) => `const k${i} = ${i};`),
    "const z = 1;",
  ]
  try {
    for (const argv of [
      ["git", "init", "-q"],
      ["git", "config", "user.email", "t@t"],
      ["git", "config", "user.name", "t"],
    ])
      expect(run(argv)).toMatchObject({ code: 0 })
    await Bun.write(
      join(dir, ".lintstagedrc.json"),
      JSON.stringify({ "*.ts": [join(ROOT, "node_modules/.bin/oxfmt")] }),
    )
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: {
            "lint-staged": {
              ...lint,
              run: linter,
            },
          },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    await Bun.write(join(dir, "a.ts"), `${lines.join("\n")}\n`)
    expect(run(["git", "add", "-A"])).toMatchObject({ code: 0 })
    expect(run(["git", "commit", "-qm", "init"])).toMatchObject({ code: 0 })
    await Bun.write(join(dir, "seed.txt"), "seed\n")
    expect(run(["git", "stash", "push", "-u", "-m", "seed"])).toMatchObject({ code: 0 })
    const before = run(["git", "stash", "list"]).out
    await Bun.write(join(dir, "a.ts"), `${["const   a   =   10", ...lines.slice(1)].join("\n")}\n`)
    expect(run(["git", "add", "a.ts"])).toMatchObject({ code: 0 })
    await Bun.write(
      join(dir, "a.ts"),
      `${["const   a   =   10", ...lines.slice(1, -1), "const z = 20; // unstaged"].join("\n")}\n`,
    )
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    expect(hook).toMatchObject({ code: 0 })
    expect(hook.out).toContain("Skipping backup because `--no-stash` was used")
    expect(run(["git", "stash", "list"]).out).toBe(before)
    const staged = run(["git", "show", ":a.ts"]).out.trimEnd().split("\n")
    expect([staged[0], staged.at(-1)]).toEqual(["const a = 10;", "const z = 1;"])
    const working = (await Bun.file(join(dir, "a.ts")).text()).trimEnd().split("\n")
    expect(working.at(-1)).toBe("const z = 20; // unstaged")
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// lefthook on this repo's own env-keys and build steps (each run swapped for an echo, env-keys's failing or passing), in a scratch repo: a .env with gaps stops the commit at env-keys, named in one step, before the build fails on its first missing key
test("the pre-commit env-keys step runs before the build and stops it on a short .env", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const { build, "dev-stack": devStack, "env-keys": envKeys } = config["pre-commit"].commands
  expect(envKeys).toBeDefined()
  expect(String(envKeys!.run)).toEndWith("bun packages/scripts/src/env-keys.ts POSTGRES_URL")
  // after the dev-stack guard, since its own build of @packages/env would rebuild dist under a running stack
  expect(envKeys!.priority as number).toBeGreaterThan(devStack!.priority as number)
  expect(envKeys!.exclude).toEqual(build!.exclude)
  const dir = mkdtempSync(join(tmpdir(), "lefthook-env-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const hookWith = async (envKeysRun: string) => {
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: {
            build: { ...build, run: "echo build-ran" },
            "env-keys": { ...envKeys, run: envKeysRun },
          },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    return { built: hook.out.includes("build-ran"), code: hook.code, out: hook.out }
  }
  try {
    expect(run(["git", "init", "-q"])).toMatchObject({ code: 0 })
    await Bun.write(join(dir, "x.ts"), "export {}\n")
    expect(run(["git", "add", "x.ts"])).toMatchObject({ code: 0 })
    const short = await hookWith("echo env-keys-named && exit 1")
    expect(short).toMatchObject({ built: false })
    expect(short.code).not.toBe(0)
    expect(short.out).toContain("env-keys-named")
    expect(await hookWith("echo env-keys-named")).toMatchObject({ built: true, code: 0 })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// lefthook on this repo's own rule-test step, beside its build step (run swapped for an echo), in a scratch repo holding the rules and their test: a change to a rule file runs the test even when only Markdown is staged, a broken pin refuses the commit, and other Markdown skips it
test("the pre-commit rule test runs when the rules change, and a broken pin refuses the commit", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const { build, "agents-rules": rules } = config["pre-commit"].commands
  expect(rules).toBeDefined()
  const dir = mkdtempSync(join(tmpdir(), "lefthook-rules-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const git = (...args: string[]) =>
    run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args])
  const topics = [...new Bun.Glob(".agents/dashboard/*.md").scanSync({ cwd: ROOT, dot: true })]
  const files = [".claude/settings.json", "AGENTS.md", "tests/AGENTS.test.ts", ...topics]
  // stage these edits, run the hook, then put the tree back
  const hookWith = async (edits: Record<string, (text: string) => string>) => {
    for (const [file, edit] of Object.entries(edits)) {
      const path = join(dir, file)
      await Bun.write(
        path,
        edit((await Bun.file(path).exists()) ? await Bun.file(path).text() : ""),
      )
    }
    expect(git("add", ...Object.keys(edits))).toMatchObject({ code: 0 })
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    expect(git("reset", "-q", "--hard")).toMatchObject({ code: 0 })
    expect(git("clean", "-q", "-fd")).toMatchObject({ code: 0 })
    return {
      ...hook,
      built: hook.out.includes("build-ran"),
      skipped: hook.out.includes("agents-rules (skip)"),
    }
  }
  const unpin = (text: string) =>
    text.replace("- ALWAYS: Do every change in its", "- ALWAYS: Do each change in its")
  const addLine = (text: string) => `${text}\nOne more plain line.\n`
  // a same-length edit, so an AGENTS.md just under the limit still passes
  const sameLength = (text: string) => text.replace("AI coding agents", "AI-coding agents")
  try {
    expect(git("init", "-q")).toMatchObject({ code: 0 })
    for (const file of files) await Bun.write(join(dir, file), Bun.file(join(ROOT, file)))
    // AGENTS.md sits one character under tests/AGENTS.test.ts's limit, MARGIN of BUDGET, the most a commit may leave it at
    const rule = await Bun.file(join(ROOT, "tests/AGENTS.test.ts")).text()
    const budget = Number(/const BUDGET = ([\d_]+)/.exec(rule)![1]!.replaceAll("_", ""))
    const limit = Math.floor(budget * Number(/const MARGIN = ([\d.]+)/.exec(rule)![1]!))
    const agents = await Bun.file(join(dir, "AGENTS.md")).text()
    const room = limit - 1 - agents.length
    expect(
      room >= 0
        ? ""
        : `AGENTS.md holds ${agents.length} chars, over the limit of ${limit} from BUDGET ${budget}`,
    ).toBe("")
    await Bun.write(join(dir, "AGENTS.md"), `${agents}${"x".repeat(room)}`)
    // CLAUDE.md is a link to AGENTS.md, as in the repo, so a commit stages AGENTS.md alone
    symlinkSync("AGENTS.md", join(dir, "CLAUDE.md"))
    // the rule test runs through bun run test:file, so the scratch repo takes that script, pointed at this repo's sandbox
    const scripts = (await Bun.file(join(ROOT, "package.json")).json()).scripts
    await Bun.write(
      join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          "test:file": scripts["test:file"].replace(
            "packages/scripts/src/test-sandbox.ts",
            join(ROOT, "packages/scripts/src/test-sandbox.ts"),
          ),
        },
      }),
    )
    // JSON is YAML, so the steps go in as lefthook read them
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: { "agents-rules": rules, build: { ...build, run: "echo build-ran" } },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    expect(git("add", ".")).toMatchObject({ code: 0 })
    expect(git("commit", "-q", "--no-verify", "-m", "base")).toMatchObject({ code: 0 })

    const fine = await hookWith({ "AGENTS.md": sameLength })
    expect(fine).toMatchObject({ built: false, code: 0, skipped: false })
    expect(fine.out).toContain("agents-rules")

    const broken = await hookWith({ "AGENTS.md": unpin })
    expect(broken.code).not.toBe(0)
    expect(broken.out).toContain("Do every change in its")

    const topic = topics.find((file) => file.endsWith("stack.md"))!
    const brokenTopic = await hookWith({
      [topic]: (text) =>
        text.replace("- ALWAYS: Start it (`bun run dev`)", "- ALWAYS: Run it (`bun run dev`)"),
    })
    expect(brokenTopic.code).not.toBe(0)
    expect(brokenTopic.out).toContain("Run it (`bun run dev`)")

    // the test itself staged alone, with a pin no rule holds, runs and refuses too
    const pinned = await hookWith({
      "tests/AGENTS.test.ts": (text) =>
        text.replace("const ALWAYS = [", 'const ALWAYS = [\n  "No rule opens with these words",'),
    })
    expect(pinned.code).not.toBe(0)
    expect(pinned.out).toContain("No rule opens with these words")

    expect(await hookWith({ "docs/playground/x.md": addLine })).toMatchObject({
      code: 0,
      skipped: true,
    })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// The trace ratchet's test counts the whole tree against counts.json, so it runs in a clone of this repo at its head, with this checkout's installs, and lefthook gets the step as lefthook.yml has it.
test("the pre-commit trace count refuses a commit that raises a count, and a commit of images alone skips it", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>>; piped?: boolean }
  }
  const step = config["pre-commit"].commands["trace-count"]
  expect(step).toBeDefined()
  const dir = mkdtempSync(join(tmpdir(), "lefthook-trace-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const git = (...args: string[]) =>
    run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args])
  const hookWith = async (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) await Bun.write(join(dir, file), text)
    expect(git("add", ...Object.keys(files))).toMatchObject({ code: 0 })
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    expect(git("reset", "-q", "--hard")).toMatchObject({ code: 0 })
    expect(git("clean", "-q", "-fd")).toMatchObject({ code: 0 })
    return { ...hook, skipped: hook.out.includes("trace-count (skip)") }
  }
  try {
    const head = Bun.spawnSync(["git", "-C", ROOT, "rev-parse", "HEAD"]).stdout.toString().trim()
    expect(run(["git", "clone", "-q", "--shared", "--no-checkout", ROOT, "."])).toMatchObject({
      code: 0,
    })
    expect(git("checkout", "-q", head)).toMatchObject({ code: 0 })
    // the install is isolated, so each workspace keeps its own node_modules beside the root's
    const installs = new Bun.Glob("{api,packages,web}/*/node_modules").scanSync({
      cwd: ROOT,
      onlyFiles: false,
    })
    for (const install of ["node_modules", ...installs])
      symlinkSync(join(ROOT, install), join(dir, install))
    // .gitignore's node_modules/ matches a folder alone, so each link is kept out of git clean by name
    await Bun.write(join(dir, ".git/info/exclude"), "node_modules\n")
    // JSON is YAML, so the step goes in as lefthook read it
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": { commands: { "trace-count": step }, piped: config["pre-commit"].piped },
      }),
    )
    expect(git("commit", "-q", "--no-verify", "-am", "the step alone")).toMatchObject({ code: 0 })

    const fine = await hookWith({ "docs/trace-scratch.md": "A line in plain words.\n" })
    expect(fine).toMatchObject({ code: 0, skipped: false })

    const raised = await hookWith({ "docs/trace-scratch.md": "Fixed in #4242.\n" })
    expect(raised.code).not.toBe(0)
    expect(raised.out).toContain("issueRefs")

    expect(await hookWith({ "docs/trace-scratch.png": "not text" })).toMatchObject({
      code: 0,
      skipped: true,
    })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 120_000)

// lefthook on this repo's own commit-msg steps, commitlint and its config included, in a scratch repo: a ticket scope in either case passes, a Co-authored-by trailer in any case is refused by name, and a body that only mentions it passes
test("commit-msg takes a ticket scope in either case and refuses a Co-authored-by trailer in any case", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "commit-msg": unknown
  }
  const dir = mkdtempSync(join(tmpdir(), "lefthook-msg-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  // each message in a file of its own, so the runs can go at once
  const hookWith = async (message: string) => {
    const msg = join(dir, `MSG-${crypto.randomUUID()}`)
    await Bun.write(msg, message)
    const proc = Bun.spawn(["bun", join(ROOT, LEFTHOOK_BIN), "run", "commit-msg", msg], {
      cwd: dir,
      env: SCRATCH_ENV,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, out: out + err }
  }
  try {
    expect(run(["git", "init", "-q"])).toMatchObject({ code: 0 })
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"))
    // the pg-scope step runs packages/scripts/src/commit-scope.ts by its path in the checkout
    symlinkSync(join(ROOT, "packages"), join(dir, "packages"))
    const { commitlint } = await Bun.file(join(ROOT, "package.json")).json()
    await Bun.write(join(dir, "package.json"), JSON.stringify({ commitlint }))
    // JSON is YAML, so the steps go in as lefthook read them
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({ "commit-msg": config["commit-msg"] }),
    )
    // commitlint runs here too, so a pass below is the whole hook's; the first run alone, since lefthook syncs its hooks on its first run in a repo
    expect((await hookWith("Fix: A change\n")).code).not.toBe(0)
    // the rest at once: each starts commitlint, whose start grows with the machine's load, and seven in a row took 60s on a loaded runner
    const trailers = ["Co-authored-by", "Co-Authored-By", "co-authored-by"]
    const [upper, lower, mention, ...refused] = await Promise.all(
      [
        "feat(PG-1): x\n",
        "feat(pg-1): x\n",
        "fix: a change\n\nThe hook refuses a Co-authored-by trailer.\n",
        ...trailers.map((trailer) => `fix: a change\n\nWhy it changed.\n\n${trailer}: A <a@b.c>\n`),
      ].map(hookWith),
    )
    expect([upper, lower, mention]).toMatchObject([{ code: 0 }, { code: 0 }, { code: 0 }])
    for (const result of refused) {
      expect(result.code).not.toBe(0)
      expect(result.out).toContain("Co-authored-by")
    }
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// docs:wrap's pre-commit step reads the docs as committed, so it runs after lint-staged's formatter and on every file the tool holds to one sentence per line
test("the pre-commit docs-wrap step covers every docs:wrap file and runs after lint-staged", async () => {
  const { PATTERNS } = await import("../packages/scripts/src/docs-wrap/cli")
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>> }
  }
  const { "docs-wrap": wrap, "lint-staged": lint } = config["pre-commit"].commands
  expect(wrap).toBeDefined()
  expect(wrap!.glob as string[]).toEqual(expect.arrayContaining(PATTERNS))
  expect(wrap!.priority as number).toBeGreaterThan(lint!.priority as number)
})

// the pre-commit build, next build included, goes through commit-slot.ts, which takes the commit slot in a worktree when turbo finds a build task with work to do; env-keys' build of @packages/env stays bare, since it ran 8s after a 829s queue wait (measured); both share one turbo cache outside every checkout
test("the pre-commit build goes through commit-slot, which slots a build with work to do, env-keys' small build does not, and both share the turbo cache", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>> }
  }
  const { build, "env-keys": envKeys } = config["pre-commit"].commands
  const CACHE = 'TURBO_CACHE_DIR="${TURBO_CACHE_DIR:-$HOME/.cache/turbo/playground}" '
  const SLOT = "bun --no-env-file packages/scripts/src/commit-slot.ts "
  expect(String(build!.run)).toBe(`${CACHE}${SLOT}bun run build`)
  expect(String(envKeys!.run)).toStartWith(`${CACHE}bunx turbo run build `)
})

// lefthook on this repo's own main-checkout step, in scratch repos under a scratch HOME: a commit in the factory's main checkout (where link-skills.sh's run-slot.sh link points) is refused whatever command made it, while one in its worktree, a plain clone of a person's own or a clone beside it goes through
test("the pre-commit main-checkout step refuses a commit in the factory's main checkout alone", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, Record<string, unknown>> }
  }
  const {
    "conflict-markers": markers,
    "main-checkout": main,
    "skills-manager": skills,
  } = config["pre-commit"].commands
  expect(main).toBeDefined()
  // alone first, since lefthook runs a tie in any order and skills-manager writes AGENTS.md
  expect(main!.priority as number).toBeLessThan(markers!.priority as number)
  expect(main!.priority as number).toBeLessThan(skills!.priority as number)
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lefthook-main-")))
  const [factory, home, clone] = ["playground", "home", "clone"].map((name) => join(dir, name)) as [
    string,
    string,
    string,
  ]
  const worktree = join(factory, ".claude/worktrees/w")
  const run = (cwd: string, argv: string[], linked = true) => {
    const env = { ...SCRATCH_ENV, HOME: linked ? home : join(dir, "nohome") }
    const result = Bun.spawnSync(argv, { cwd, env, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const git = (cwd: string, ...args: string[]) =>
    run(cwd, ["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args])
  // a staged file, since lefthook skips a command when nothing is staged
  const hook = async (cwd: string, linked = true) => {
    await Bun.write(join(cwd, "x.txt"), "x")
    expect(git(cwd, "add", "x.txt")).toMatchObject({ code: 0 })
    return run(cwd, ["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"], linked)
  }
  const repo = async (path: string) => {
    mkdirSync(join(path, "scripts/ops"), { recursive: true })
    expect(git(path, "init", "-q", "-b", "main")).toMatchObject({ code: 0 })
    await Bun.write(join(path, "scripts/ops/run-slot.sh"), "")
    await Bun.write(
      join(path, "lefthook.yml"),
      JSON.stringify({ "pre-commit": { commands: { "main-checkout": main } } }),
    )
    expect(git(path, "add", ".")).toMatchObject({ code: 0 })
    expect(git(path, "commit", "-q", "--no-verify", "-m", "config")).toMatchObject({ code: 0 })
  }
  try {
    await repo(factory)
    await repo(clone)
    expect(git(factory, "worktree", "add", "-q", "-b", "w", worktree)).toMatchObject({ code: 0 })
    // link-skills.sh's link, which names the factory's main checkout
    mkdirSync(join(home, ".playground/ops"), { recursive: true })
    symlinkSync(join(factory, "scripts/ops/run-slot.sh"), join(home, ".playground/ops/run-slot.sh"))

    const refused = await hook(factory)
    expect(refused.code).not.toBe(0)
    expect(refused.out).toContain("the factory's main checkout")
    mkdirSync(join(factory, "sub"))
    expect((await hook(join(factory, "sub"))).code).not.toBe(0)

    expect(await hook(worktree)).toMatchObject({ code: 0 })
    expect(await hook(clone)).toMatchObject({ code: 0 })
    expect(await hook(factory, false)).toMatchObject({ code: 0 })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// the install's prepare as package.json gives it, run in a scratch repo, a script it names read from this checkout
const preparer = async () => {
  const { scripts } = (await Bun.file(join(ROOT, "package.json")).json()) as {
    scripts: { prepare: string }
  }
  const command = scripts.prepare.replaceAll(
    "packages/scripts/",
    `${join(ROOT, "packages/scripts")}/`,
  )
  return (dir: string) => {
    const result = Bun.spawnSync(["sh", "-c", command], {
      cwd: dir,
      env: SCRATCH_ENV,
      stdin: "ignore",
    })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
}

// a scratch repo with this checkout's lefthook and a config of one pre-commit command
const scratchRepo = async (dir: string) => {
  expect(Bun.spawnSync(["git", "init", "-q"], { cwd: dir, env: SCRATCH_ENV }).exitCode).toBe(0)
  mkdirSync(join(dir, "node_modules/.bin"), { recursive: true })
  symlinkSync(join(ROOT, LEFTHOOK_BIN), join(dir, LEFTHOOK_BIN))
  const config = `lefthook: ${OWN_LEFTHOOK}\npre-commit:\n  commands:\n    mark:\n      run: echo hook-ran\n`
  await Bun.write(join(dir, "lefthook.yml"), config)
  return config
}

// the install's prepare script in a scratch repo whose hooks folder it may not write, as Claude Code's sandbox refuses .git/hooks: hooks that match pass with no write, and a config that names a new hook still fails loudly
test("the install's prepare writes no hook while the installed ones match", async () => {
  const prepare = await preparer()
  const dir = mkdtempSync(join(tmpdir(), "lefthook-prepare-"))
  const hooks = join(dir, ".git/hooks")
  try {
    const config = await scratchRepo(dir)
    expect(prepare(dir)).toMatchObject({ code: 0 })
    chmodSync(hooks, 0o555)
    expect(prepare(dir)).toMatchObject({ code: 0 })
    await Bun.write(
      join(dir, "lefthook.yml"),
      `${config}pre-push:\n  commands:\n    mark:\n      run: echo push-ran\n`,
    )
    // lefthook reads its hooks as matching while the config's mtime, in seconds, equals the one it installed from, so a rewrite in that same second is moved on
    const later = Date.now() / 1000 + 10
    utimesSync(join(dir, "lefthook.yml"), later, later)
    expect(prepare(dir).code).not.toBe(0)
  } finally {
    if (existsSync(hooks)) chmodSync(hooks, 0o755)
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// lefthook's check-install reads its config's checksum alone, never the hooks, so a hook gone or replaced while the config still matches is the prepare's own check to catch
test("the install's prepare puts back a hook that was deleted or replaced while the config still matches", async () => {
  const prepare = await preparer()
  const dir = mkdtempSync(join(tmpdir(), "lefthook-prepare-"))
  const hook = join(dir, ".git/hooks/pre-commit")
  try {
    await scratchRepo(dir)
    expect(prepare(dir)).toMatchObject({ code: 0 })
    const installed = await Bun.file(hook).text()
    unlinkSync(hook)
    expect(prepare(dir)).toMatchObject({ code: 0 })
    expect(existsSync(hook) ? await Bun.file(hook).text() : "deleted").toBe(installed)
    await Bun.write(hook, "#!/bin/sh\necho foreign\n")
    expect(prepare(dir)).toMatchObject({ code: 0 })
    expect(await Bun.file(hook).text()).toBe(installed)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)

// Two fast tests turned four branches red in CI on 5 Nov while pre-commit never ran them: each now runs when a file it reads is staged, checked here on lefthook itself with each run swapped for an echo
test("pre-commit runs the native-title and dashboard-map tests when a file they read is staged, and skips them otherwise", async () => {
  const config = Bun.YAML.parse(await Bun.file(join(ROOT, "lefthook.yml")).text()) as {
    "pre-commit": { commands: Record<string, { glob?: string[]; run?: string }>; piped?: boolean }
  }
  const { "dashboard-map": map, "native-title": title } = config["pre-commit"].commands
  expect(title?.run).toBe("bun run test:file tests/web/next/src/native-title.test.ts")
  expect(map?.run).toBe("bun run test:file tests/packages/scripts/src/verify/dashboard-map.test.ts")
  const dir = mkdtempSync(join(tmpdir(), "lefthook-fast-tests-"))
  const run = (argv: string[]) => {
    const result = Bun.spawnSync(argv, { cwd: dir, env: SCRATCH_ENV, stdin: "ignore" })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }
  const git = (...args: string[]) =>
    run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args])
  // stage one file, run the hook, then put the tree back
  const ran = async (file: string) => {
    await Bun.write(join(dir, file), "staged\n")
    expect(git("add", file)).toMatchObject({ code: 0 })
    const hook = run(["bun", join(ROOT, LEFTHOOK_BIN), "run", "pre-commit"])
    expect(git("reset", "-q", "--hard")).toMatchObject({ code: 0 })
    expect(git("clean", "-q", "-fd")).toMatchObject({ code: 0 })
    expect(hook.code).toBe(0)
    return { map: hook.out.includes("map-ran"), title: hook.out.includes("title-ran") }
  }
  try {
    expect(git("init", "-q")).toMatchObject({ code: 0 })
    // JSON is YAML, so the steps go in as lefthook read them
    await Bun.write(
      join(dir, "lefthook.yml"),
      JSON.stringify({
        "pre-commit": {
          commands: {
            "dashboard-map": { ...map, run: "echo map-ran" },
            "native-title": { ...title, run: "echo title-ran" },
          },
          piped: config["pre-commit"].piped,
        },
      }),
    )
    expect(git("add", ".")).toMatchObject({ code: 0 })
    expect(git("commit", "-q", "--no-verify", "-m", "base")).toMatchObject({ code: 0 })

    expect(await ran("web/next/src/components/hint.tsx")).toEqual({ map: true, title: true })
    expect(await ran("web/next/src/app/(protected)/dashboard/page.tsx")).toEqual({
      map: true,
      title: true,
    })
    expect(await ran("api/hono/src/routers/inbox.ts")).toEqual({ map: true, title: false })
    expect(await ran("api/hono/src/plugins/changelog/router.ts")).toEqual({
      map: true,
      title: false,
    })
    expect(await ran("packages/scripts/src/verify/dashboard-map.json")).toEqual({
      map: true,
      title: false,
    })
    expect(await ran("tests/web/next/src/native-title.test.ts")).toEqual({
      map: false,
      title: true,
    })
    expect(await ran("tests/packages/scripts/src/verify/dashboard-map.test.ts")).toEqual({
      map: true,
      title: false,
    })
    expect(await ran("docs/playground/x.md")).toEqual({ map: false, title: false })
    expect(await ran("packages/scripts/src/pr-merge/held.ts")).toEqual({ map: false, title: false })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}, 60_000)
