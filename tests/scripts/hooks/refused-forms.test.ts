import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { check as envDump } from "../../../scripts/hooks/no-env-dump"
import { check as extensionRepoWrite } from "../../../scripts/hooks/no-extension-repo-write"
import { check as extensionsWrite } from "../../../scripts/hooks/no-extensions-write"
import { check as headlessLogin } from "../../../scripts/hooks/no-headless-login"
import { check as killByName } from "../../../scripts/hooks/no-kill-by-name"
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
  LINK: join(HOME, "store"),
  LIST: join(ROOT, "hooks", "desktop-owner-apps.json"),
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
Bun.spawnSync(["git", "init", "-q", OTHER])
Bun.spawnSync([
  "git",
  "-C",
  OTHER,
  "remote",
  "add",
  "origin",
  "https://github.com/acme-labs/demo.git",
])
const OWNED = storeWith(join(SCRATCH, "owned"), { "release-owners.json": '["qmarsh"]' })
// A data folder whose scope acme syncs with the made-up extension repo quillco/acme-skills.
const SYNCED = storeWith(
  join(SCRATCH, "synced"),
  {},
  { "ext.repos": { acme: "quillco/acme-skills" } },
)
mkdirSync(join(SYNCED, "extensions", "acme"), { recursive: true })
Bun.spawnSync(["git", "-C", join(SYNCED, "extensions", "acme"), "init", "-q"])

type Run = (raw: string, home: string) => Promise<string | undefined>

// Each guard's check with the environment its own test gives it, and the folders it runs in, each a cwd and the HOME that goes with it.
const GUARDS: Record<Guard, { folders: Partial<Record<Folder, [string, string]>>; run: Run }> = {
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
  "no-raw-spawn": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => rawSpawn(raw) },
  "no-release-comment": {
    folders: { checkout: [OTHER, HOME] },
    run: (raw) => releaseComment(raw, { PLAYGROUND_DATA_DIR: OWNED }),
  },
  "no-stash": { folders: { checkout: [CHECKOUT, HOME] }, run: (raw) => stash(raw, {}) },
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
