import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { check as desktopOwnerApp } from "../../../scripts/hooks/no-desktop-owner-app"
import { check as envDump } from "../../../scripts/hooks/no-env-dump"
import { check as extensionRepoWrite } from "../../../scripts/hooks/no-extension-repo-write"
import { check as extensionsWrite } from "../../../scripts/hooks/no-extensions-write"
import { check as glmHeavyPath } from "../../../scripts/hooks/no-glm-heavy-path"
import { check as headlessLogin } from "../../../scripts/hooks/no-headless-login"
import { check as killByName } from "../../../scripts/hooks/no-kill-by-name"
import { check as mainCheckout } from "../../../scripts/hooks/no-main-checkout"
import { check as playgroundLeak } from "../../../scripts/hooks/no-playground-leak"
import { check as rawSpawn } from "../../../scripts/hooks/no-raw-spawn"
import { check as releaseComment } from "../../../scripts/hooks/no-release-comment"
import { check as stash } from "../../../scripts/hooks/no-stash"
import {
  ALLOWED,
  type Call,
  type Folder,
  type Guard,
  type Paths,
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
storeWith(
  join(LEAK, "playground"),
  {
    "playground-terms.json": readFileSync(join(LISTS, "playground-terms.json"), "utf8"),
    "slack-cleared.json": readFileSync(join(LISTS, "slack-cleared.json"), "utf8"),
  },
  { "ext.links": { "made-up-org": ["acme-blue"] } },
)
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

// Each guard's check with the environment its own test gives it, and the folders it runs in, each a cwd and the HOME that goes with it.
const GUARDS: Record<Guard, { folders: Partial<Record<Folder, [string, string]>>; run: Run }> = {
  "no-desktop-owner-app": {
    folders: {
      checkout: [CHECKOUT, HOME],
      home: [HOME, HOME],
      "main checkout": [NDMAIN, HOME],
      worktree: [NDWORK, HOME],
    },
    run: (raw) => desktopOwnerApp(raw, { PLAYGROUND_DATA_DIR: DESKTOP }),
  },
  "no-env-dump": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => envDump(raw) },
  "no-extension-repo-write": {
    folders: { checkout: [OTHER, HOME] },
    run: (raw, home) =>
      extensionRepoWrite(raw, {
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
    run: (raw, home) => extensionsWrite(raw, { HOME: home }),
  },
  "no-glm-heavy-path": {
    folders: { "glm repo": [GLM_REPO, HOME] },
    run: (raw) => glmHeavyPath(raw, { ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" }, 1),
  },
  "no-headless-login": {
    folders: { checkout: [CHECKOUT, "/nonexistent"] },
    run: (raw, home) =>
      headlessLogin(raw, {
        CLAUDE_CONFIG_DIR: "/nonexistent",
        HOME: home,
        PLAYGROUND_ROLE: "worker",
      }),
  },
  "no-kill-by-name": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => killByName(raw) },
  "no-main-checkout": {
    folders: {
      checkout: [join(PATHS.MAIN, ".claude", "worktrees", "a"), HOME],
      "main checkout": [PATHS.MAIN, HOME],
    },
    run: (raw, home) => mainCheckout(raw, { HOME: home }, PATHS.MAIN),
  },
  "no-playground-leak": {
    folders: { "data folder": [DATA, HOME], home: [HOME, HOME] },
    run: (raw) =>
      playgroundLeak(
        raw,
        { CLAUDE_CONFIG_DIR: LEAK, PLAYGROUND_DATA_DIR: join(LEAK, "playground") },
        undefined,
        LISTS,
      ),
  },
  "no-raw-spawn": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => rawSpawn(raw) },
  "no-release-comment": {
    folders: { checkout: [OTHER, HOME] },
    run: (raw) => releaseComment(raw, { PLAYGROUND_DATA_DIR: OWNED }),
  },
  "no-stash": {
    folders: { checkout: [CHECKOUT, HOME], "data folder": [DATA, HOME], home: [HOME, HOME] },
    run: (raw) => stash(raw, {}),
  },
}

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

  test("every allow-list entry names a case", () => {
    for (const entry of ALLOWED)
      expect(CASES.some(({ id, key }) => entry === id || entry === key)).toBe(true)
  })
})
