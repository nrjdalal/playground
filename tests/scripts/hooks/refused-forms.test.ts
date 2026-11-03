import { afterAll, describe, expect, test } from "bun:test"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { check as desktopOwnerApp } from "../../../scripts/hooks/no-desktop-owner-app"
import { check as envDump } from "../../../scripts/hooks/no-env-dump"
import { check as extensionRepoWrite } from "../../../scripts/hooks/no-extension-repo-write"
import { check as extensionsWrite } from "../../../scripts/hooks/no-extensions-write"
import { check as glmHeavyPath } from "../../../scripts/hooks/no-glm-heavy-path"
import { check as headlessLogin } from "../../../scripts/hooks/no-headless-login"
import { check as killByName } from "../../../scripts/hooks/no-kill-by-name"
import { check as linearTicket } from "../../../scripts/hooks/no-linear-ticket"
import { check as mainCheckout } from "../../../scripts/hooks/no-main-checkout"
import { check as playgroundLeak } from "../../../scripts/hooks/no-playground-leak"
import { check as publicLeak } from "../../../scripts/hooks/no-public-leak"
import { check as rawDelete } from "../../../scripts/hooks/no-raw-delete"
import { check as rawSpawn } from "../../../scripts/hooks/no-raw-spawn"
import { check as releaseComment } from "../../../scripts/hooks/no-release-comment"
import { check as stash } from "../../../scripts/hooks/no-stash"
import { check as unslottedRun } from "../../../scripts/hooks/no-unslotted-run"
import {
  ALLOWED,
  type Call,
  type Folder,
  type Guard,
  type Paths,
  NEVER_MADE,
  REFUSED_FORMS,
} from "./fixtures/refused-forms"
import { storeWith } from "./render-set"
import { git } from "./scratch-git"

const CHECKOUT = join(import.meta.dir, "..", "..", "..")
const SCRATCH = mkdtempSync(join(tmpdir(), "refused-forms-"))
afterAll(() => rmSync(SCRATCH, { force: true, recursive: true }))

// A home whose data folder holds an extensions root, its links and files, as the guards' own tests build it.
const HOME = join(SCRATCH, "home")
const DATA = join(HOME, ".playground")
const ROOT = join(DATA, "extensions")
const SCOPE = join(ROOT, "login")
const OTHER = join(SCRATCH, "other")
const PATHS: Paths = {
  BARE: join(SCRATCH, "bare"),
  CLI_DIR: join(CHECKOUT, "packages", "scripts", "src", "playground"),
  DATA,
  HOME,
  LINK: join(HOME, "store"),
  LIST: join(ROOT, "hooks", "desktop-owner-apps.json"),
  MAIN: join(SCRATCH, "main"),
  ROOT,
  SCOPE,
  WORDS: join(HOME, "words"),
  WORK: join(HOME, "work"),
}
for (const dir of [
  join(ROOT, "hooks"),
  join(SCOPE, "lists"),
  join(ROOT, "hooks", "~-"),
  join(ROOT, "hooks", "~+"),
  join(DATA, "handoffs"),
  join(PATHS.WORK, "playground"),
  join(PATHS.MAIN, ".claude", "worktrees", "a"),
  PATHS.BARE,
])
  mkdirSync(dir, { recursive: true })
writeFileSync(PATHS.LIST, '["Slack"]\n')
writeFileSync(join(ROOT, "policy.json"), "{}\n")
writeFileSync(join(SCOPE, "lists", "release-owners.json"), "[]\n")
writeFileSync(PATHS.WORDS, "y ".repeat(400_000))
symlinkSync(ROOT, PATHS.LINK)
symlinkSync(ROOT, join(DATA, "store"))
symlinkSync(DATA, join(HOME, "pg"))
symlinkSync(join(PATHS.CLI_DIR, "cli.ts"), join(HOME, "pc"))
git(SCRATCH, "init", "-q", OTHER)
git(OTHER, "remote", "add", "origin", "https://github.com/acme-labs/demo.git")
// A repo with a heavy path staged, as no-glm-heavy-path's own test stages one.
const GLM_REPO = join(SCRATCH, "glm-repo")
git(SCRATCH, "init", "-q", "-b", "canary", GLM_REPO)
git(GLM_REPO, "commit", "-q", "--allow-empty", "-m", "base")
mkdirSync(join(GLM_REPO, "web", "next", "src"), { recursive: true })
writeFileSync(join(GLM_REPO, "web", "next", "src", "x.ts"), "x\n")
git(GLM_REPO, "add", ".")
// The leak guard's lists as core holds them, with ext.links guarding a made-up org's repositories, as its own test sets them.
const LISTS = join(CHECKOUT, "extensions", "core", "lists")
const LEAK = join(SCRATCH, "leak")
// no-linear-ticket reads its approvals folder under PLAYGROUND_DATA_DIR, so its rows cd into the data folder the fixture makes
const TICKETS = join(SCRATCH, "tickets")
storeWith(
  join(LEAK, "playground"),
  {
    "playground-terms.json": readFileSync(join(LISTS, "playground-terms.json"), "utf8"),
    "slack-cleared.json": readFileSync(join(LISTS, "slack-cleared.json"), "utf8"),
  },
  { "ext.links": { "made-up-org": ["acme-blue"] } },
)
// A data folder whose extensions root lacks no-public-leak's list, which core never ships, so its rows pin the writes that refusal still refuses.
const LISTLESS = storeWith(join(SCRATCH, "listless"), {})
const OWNED = storeWith(join(SCRATCH, "owned"), { "release-owners.json": '["qmarsh"]' })
const DESKTOP = storeWith(join(SCRATCH, "desktop"), { "desktop-owner-apps.json": '["Slack"]' })
// A data folder whose scope acme syncs with the made-up extension repo quillco/acme-skills.
const SYNCED = storeWith(
  join(SCRATCH, "synced"),
  {},
  { "ext.repos": { acme: "quillco/acme-skills" } },
)
mkdirSync(join(SYNCED, "extensions", "acme"), { recursive: true })
git(join(SYNCED, "extensions", "acme"), "init", "-q")
// A fabricated main checkout (holds scripts/spawn.sh and maps ask/thread to their Playground entries) and a linked worktree of it whose package.json and entry files match byte for byte, since no-desktop-owner-app's prose allowance holds from the main checkout alone. PLAYGROUND_REPO pins mainCheckout() to NDMAIN, restored after.
const NDMAIN = join(SCRATCH, "nd-main")
const NDWORK = join(SCRATCH, "nd-work")
git(SCRATCH, "init", "-q", "-b", "canary", NDMAIN)
mkdirSync(join(NDMAIN, "scripts"), { recursive: true })
writeFileSync(join(NDMAIN, "scripts", "spawn.sh"), "#!/bin/sh\n")
mkdirSync(join(NDMAIN, "api", "hono", "src", "bin"), { recursive: true })
writeFileSync(join(NDMAIN, "api", "hono", "src", "bin", "dashboard-ask.ts"), "")
writeFileSync(join(NDMAIN, "api", "hono", "src", "bin", "dashboard-thread.ts"), "")
writeFileSync(
  join(NDMAIN, "package.json"),
  `${JSON.stringify({
    scripts: {
      ask: "bun api/hono/src/bin/dashboard-ask.ts",
      thread: "bun api/hono/src/bin/dashboard-thread.ts",
    },
  })}\n`,
)
git(NDMAIN, "add", ".")
git(NDMAIN, "commit", "-q", "-m", "base")
git(NDMAIN, "worktree", "add", "-q", "--detach", NDWORK)
const PRIOR_REPO = process.env.PLAYGROUND_REPO
process.env.PLAYGROUND_REPO = NDMAIN
afterAll(() =>
  PRIOR_REPO === undefined
    ? delete process.env.PLAYGROUND_REPO
    : (process.env.PLAYGROUND_REPO = PRIOR_REPO),
)

type Run = (raw: string, home: string) => Promise<string | undefined>

// Each guard's check() by the name this file calls it: the source's, and the bundle's its wrapper runs.
// oxlint-disable-next-line typescript/no-explicit-any
type Checks = Record<(typeof CHECK_NAMES)[number], (...args: any[]) => Promise<string | undefined>>
const CHECK_NAMES = [
  "desktopOwnerApp",
  "envDump",
  "extensionRepoWrite",
  "extensionsWrite",
  "glmHeavyPath",
  "headlessLogin",
  "killByName",
  "linearTicket",
  "mainCheckout",
  "playgroundLeak",
  "publicLeak",
  "rawSpawn",
  "releaseComment",
  "stash",
  "unslottedRun",
] as const
const SOURCE: Checks = {
  desktopOwnerApp,
  envDump,
  extensionRepoWrite,
  extensionsWrite,
  glmHeavyPath,
  headlessLogin,
  killByName,
  linearTicket,
  mainCheckout,
  playgroundLeak,
  publicLeak,
  rawSpawn,
  releaseComment,
  stash,
  unslottedRun,
}
const GUARD_OF: Record<(typeof CHECK_NAMES)[number], Guard> = {
  desktopOwnerApp: "no-desktop-owner-app",
  envDump: "no-env-dump",
  extensionRepoWrite: "no-extension-repo-write",
  extensionsWrite: "no-extensions-write",
  glmHeavyPath: "no-glm-heavy-path",
  headlessLogin: "no-headless-login",
  killByName: "no-kill-by-name",
  linearTicket: "no-linear-ticket",
  mainCheckout: "no-main-checkout",
  playgroundLeak: "no-playground-leak",
  publicLeak: "no-public-leak",
  rawSpawn: "no-raw-spawn",
  releaseComment: "no-release-comment",
  stash: "no-stash",
  unslottedRun: "no-unslotted-run",
}

// Each guard's bundle, copied into a scratch checkout with no node_modules above it, as a damaged install leaves one; the folders the bundles read beside them (extensions' lists, the settings reader role.ts runs in its own process) link to this checkout's.
const BUNDLED_ROOT = join(SCRATCH, "bundled-checkout")
const BUNDLED_DIR = join(BUNDLED_ROOT, "scripts", "hooks", "bundled")
mkdirSync(BUNDLED_DIR, { recursive: true })
for (const file of readdirSync(join(CHECKOUT, "scripts", "hooks", "bundled")))
  copyFileSync(join(CHECKOUT, "scripts", "hooks", "bundled", file), join(BUNDLED_DIR, file))
for (const path of [
  "extensions",
  "packages",
  join("scripts", "roster-statuses.json"),
  join("scripts", "spawn.sh"),
])
  symlinkSync(join(CHECKOUT, path), join(BUNDLED_ROOT, path))
const BUNDLED: Checks = Object.fromEntries(
  await Promise.all(
    CHECK_NAMES.map(async (name) => [
      name,
      (await import(join(BUNDLED_DIR, `${GUARD_OF[name]}.js`))).check,
    ]),
  ),
) as Checks

// Each guard's check with the environment its own test gives it, and the folders it runs in, each a cwd and the HOME that goes with it.
const guardsOf = (
  c: Checks,
): Record<Guard, { folders: Partial<Record<Folder, [string, string]>>; run: Run }> => ({
  "no-desktop-owner-app": {
    folders: {
      checkout: [CHECKOUT, HOME],
      home: [HOME, HOME],
      "main checkout": [NDMAIN, HOME],
      worktree: [NDWORK, HOME],
    },
    run: (raw) => c.desktopOwnerApp(raw, { PLAYGROUND_DATA_DIR: DESKTOP }),
  },
  "no-env-dump": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => c.envDump(raw) },
  "no-extension-repo-write": {
    folders: { checkout: [OTHER, HOME] },
    run: (raw, home) =>
      c.extensionRepoWrite(raw, {
        HOME: home,
        PLAYGROUND_DATA_DIR: SYNCED,
        PLAYGROUND_ROLE: "worker",
      }),
  },
  "no-extensions-write": {
    folders: {
      "bare home": [PATHS.BARE, PATHS.BARE],
      checkout: [CHECKOUT, HOME],
      "cli folder": [PATHS.CLI_DIR, HOME],
      "data folder": [DATA, HOME],
      "extensions root": [SCOPE, HOME],
      home: [HOME, HOME],
      "process data folder": [join(homedir(), ".playground"), homedir()],
      "process home": [homedir(), homedir()],
      "process tmp": [tmpdir(), homedir()],
      "process worktree": [join(homedir(), "x", ".claude", "worktrees", "y"), homedir()],
      tmp: ["/tmp", HOME],
    },
    run: (raw, home) => c.extensionsWrite(raw, { HOME: home }),
  },
  "no-glm-heavy-path": {
    folders: { "glm repo": [GLM_REPO, HOME] },
    run: (raw) => c.glmHeavyPath(raw, { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" }, 1),
  },
  "no-headless-login": {
    folders: { checkout: [CHECKOUT, "/nonexistent"] },
    run: (raw, home) =>
      c.headlessLogin(raw, {
        CLAUDE_CONFIG_DIR: "/nonexistent",
        HOME: home,
        PLAYGROUND_ROLE: "worker",
      }),
  },
  "no-kill-by-name": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => c.killByName(raw) },
  "no-linear-ticket": {
    folders: { checkout: [CHECKOUT, HOME], "data folder": [DATA, HOME] },
    run: (raw, home) =>
      c.linearTicket(raw, {
        CLAUDE_CONFIG_DIR: TICKETS,
        HOME: home,
        PLAYGROUND_DATA_DIR: DATA,
        PLAYGROUND_ROLE: "worker",
      }),
  },
  "no-main-checkout": {
    folders: {
      checkout: [join(PATHS.MAIN, ".claude", "worktrees", "a"), HOME],
      "main checkout": [PATHS.MAIN, HOME],
    },
    run: (raw, home) => c.mainCheckout(raw, { HOME: home }, PATHS.MAIN),
  },
  "no-playground-leak": {
    folders: { "data folder": [DATA, HOME], home: [HOME, HOME] },
    run: (raw) =>
      c.playgroundLeak(
        raw,
        { CLAUDE_CONFIG_DIR: LEAK, PLAYGROUND_DATA_DIR: join(LEAK, "playground") },
        undefined,
        LISTS,
      ),
  },
  "no-public-leak": {
    folders: { checkout: [CHECKOUT, HOME], home: [HOME, HOME] },
    run: (raw) => c.publicLeak(raw, { CLAUDE_CONFIG_DIR: SCRATCH, PLAYGROUND_DATA_DIR: LISTLESS }),
  },
  // No bundle while no settings file registers it, so only its source runs, and the bundled pass below leaves it out, since GUARD_OF names no check of it.
  "no-raw-delete": {
    folders: {
      checkout: [CHECKOUT, HOME],
      "process worktree": [join(homedir(), "x", ".claude", "worktrees", "y"), homedir()],
    },
    run: (raw) => rawDelete(raw),
  },
  "no-raw-spawn": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => c.rawSpawn(raw) },
  "no-release-comment": {
    folders: { checkout: [OTHER, HOME] },
    run: (raw) => c.releaseComment(raw, { PLAYGROUND_DATA_DIR: OWNED }),
  },
  "no-stash": {
    folders: { checkout: [CHECKOUT, HOME], "data folder": [DATA, HOME], home: [HOME, HOME] },
    run: (raw) => c.stash(raw, {}),
  },
  "no-unslotted-run": {
    folders: {
      checkout: [join(PATHS.MAIN, ".claude", "worktrees", "a"), HOME],
      "main checkout": [PATHS.MAIN, HOME],
    },
    run: (raw, home) => c.unslottedRun(raw, { HOME: home, PLAYGROUND_ROLE: "worker" }, PATHS.MAIN),
  },
})

const GUARDS = guardsOf(SOURCE)
const BUNDLED_GUARDS = guardsOf(BUNDLED)
const BUNDLED_PASS = new Set<Guard>(Object.values(GUARD_OF))

const input = (call: Call, cwd: string) =>
  JSON.stringify(
    typeof call === "string"
      ? { cwd, hook_event_name: "PreToolUse", tool_input: { command: call }, tool_name: "Bash" }
      : { cwd, hook_event_name: "PreToolUse", tool_input: call.input, tool_name: call.tool },
  )

const CASES = REFUSED_FORMS.flatMap(({ folders, guards, rows, source }) =>
  rows(PATHS).flatMap(([what, call, own]) =>
    guards.flatMap((guard) =>
      (own ? [own] : folders).map((folder) => ({
        call,
        folder,
        guard,
        id: `${source} ${what}`,
        key: `${source} ${what} | ${guard} | ${folder}`,
      })),
    ),
  ),
)

const allowed = ({ id, key }: { id: string; key: string }) =>
  ALLOWED.includes(id) || ALLOWED.includes(key)

describe("every refused form stays refused unless the allow list names it", () => {
  test.each(CASES.map((c) => [c.key, c] as const))(
    "%s",
    async (_, c) => {
      const at = GUARDS[c.guard].folders[c.folder]
      if (!at) throw new Error(`${c.guard} has no ${c.folder} folder`)
      const reason = await GUARDS[c.guard].run(input(c.call, at[0]), at[1])
      if (allowed(c)) expect(reason).toBeUndefined()
      else expect(reason).toContain(`${c.guard} hook `)
    },
    60_000,
  )

  // the extensions root left out, since no-extensions-write refuses any program run inside it
  test.each(
    Object.entries(GUARDS).flatMap(([guard, { folders }]) =>
      Object.keys(folders)
        .filter((folder) => folder !== "extensions root")
        .map((folder) => [guard, folder] as const),
    ),
  )("%s's setup lets a plain call run from its %s folder", async (guard, folder) => {
    const { folders, run } = GUARDS[guard as Guard]
    const at = folders[folder as Folder] as [string, string]
    expect(await run(input("true", at[0]), at[1])).toBeUndefined()
  })

  test("each row's name is its source's only one", () => {
    const ids = new Set<string>()
    for (const { guards, rows, source } of REFUSED_FORMS)
      for (const [what] of rows(PATHS))
        for (const guard of guards) {
          const id = `${source} ${what} | ${guard}`
          expect(ids.has(id)).toBe(false)
          ids.add(id)
        }
  })

  // A recursive rm (-r, -R or --recursive, alone or in a cluster) and the folder it names, read from a row's text, where a backslash starts an escape (printf's \n) rather than the folder's name.
  const RECURSIVE = /\brm\s+((?:-\S+\s+)*)([^\s'"`;)&|\\]+)/g
  // A folder named from HOME, and a cd or pushd to HOME, after which a relative folder is in HOME too; a bare cd or pushd goes there as well, as the shared reader reads one
  const HOME_PATH = /^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/
  const CD_HOME = /\b(?:cd|pushd)\s+(?:~|\$HOME|\$\{HOME\})\/?(?=[\s;&|)]|$)/
  // A bare cd or pushd, with no folder word and a redirect of its own aside, which the shared reader reads as the home too
  const BARE_HOME = /\b(?:cd|pushd)(?:\s+\d?>{1,2}\s*\S+)*\s*(?=[;&|)]|$)/
  // A folder written from ~ is NEVER_MADE itself, or a glob of it that keeps its last name
  const never = (path: string) =>
    path.endsWith(NEVER_MADE.slice(NEVER_MADE.lastIndexOf("/"))) &&
    new Bun.Glob(path).match(NEVER_MADE)
  // Each recursive delete in a text whose folder is in HOME and is not NEVER_MADE
  const homeDeletes = (text: string) =>
    [...text.matchAll(RECURSIVE)].flatMap(({ 0: rm, 1: flags = "", 2: target = "", index = 0 }) => {
      if (!/(?:^|\s)(?:-[a-zA-Z]*[rR]|--recursive)/.test(flags)) return []
      const path = HOME_PATH.test(target)
        ? target.replace(HOME_PATH, "~")
        : !/^[/~$]/.test(target) &&
            (CD_HOME.test(text.slice(0, index)) || BARE_HOME.test(text.slice(0, index)))
          ? `~/${target}`
          : undefined
      return path !== undefined && !never(path) ? [rm] : []
    })

  test("every recursive delete from HOME names a path under the root that never exists", () => {
    const left: string[] = []
    for (const { rows, source } of REFUSED_FORMS)
      for (const [what, call] of rows(PATHS)) {
        const text = typeof call === "string" ? call : JSON.stringify(call)
        for (const rm of homeDeletes(text)) left.push(`${source} ${what}: ${rm}`)
      }
    expect(left).toEqual([])
  })

  // Test files that hold commands as strings outside the fixture, read line by line as source, a \n escape read as the line break it writes
  test.each([
    "tests/packages/scripts/src/playground/picker.test.ts",
    "tests/scripts/hooks/no-extensions-write.test.ts",
  ])(
    "every recursive delete from HOME in %s names a path under the root that never exists",
    (file) => {
      const lines = readFileSync(join(CHECKOUT, file), "utf8").split("\n")
      const left = lines.flatMap((line, i) =>
        homeDeletes(line.replaceAll("\\n", "\n")).map((rm) => `${file}:${i + 1}: ${rm}`),
      )
      expect(left).toEqual([])
    },
  )

  test("every allow-list entry names a case", () => {
    for (const entry of ALLOWED)
      expect(CASES.some(({ id, key }) => entry === id || entry === key)).toBe(true)
  })
})

// A guard's wrapper runs its bundle, so the bundle is held to its source's verdict on every row, run where no node_modules can be reached.
describe("each bundled guard gives its source's verdict with no node_modules reachable", () => {
  test("no package resolves from the bundles' folder", () => {
    expect(() => Bun.resolveSync("zod", BUNDLED_DIR)).toThrow()
  })

  // A guard with a bundle goes through its bundle's check(), so registering one with no entry in GUARD_OF fails here rather than comparing its source with itself.
  test("every guard here has a bundle exactly when GUARD_OF names its check", () => {
    for (const guard of Object.keys(GUARDS))
      expect({ bundled: existsSync(join(BUNDLED_DIR, `${guard}.js`)), guard }).toEqual({
        bundled: BUNDLED_PASS.has(guard as Guard),
        guard,
      })
  })

  test.each(CASES.filter((c) => BUNDLED_PASS.has(c.guard)).map((c) => [c.key, c] as const))(
    "%s",
    async (_, c) => {
      const at = GUARDS[c.guard].folders[c.folder] as [string, string]
      const [source, bundled] = await Promise.all([
        GUARDS[c.guard].run(input(c.call, at[0]), at[1]),
        BUNDLED_GUARDS[c.guard].run(input(c.call, at[0]), at[1]),
      ])
      expect(bundled === undefined).toBe(source === undefined)
      if (bundled !== undefined) expect(bundled).toContain(`${c.guard} hook `)
    },
    60_000,
  )

  test("the bundled no-extensions-write's worker gives its check's verdict", async () => {
    const { guarded } = await import(join(BUNDLED_DIR, "no-extensions-write.js"))
    const refused = CASES.find((c) => c.guard === "no-extensions-write" && !allowed(c))!
    const [cwd, home] = GUARDS["no-extensions-write"].folders[refused.folder]!
    expect(await guarded(input(refused.call, cwd), { HOME: home })).toContain(
      "no-extensions-write hook ",
    )
    expect(await guarded(input("true", CHECKOUT), { HOME })).toBeUndefined()
  })
})
