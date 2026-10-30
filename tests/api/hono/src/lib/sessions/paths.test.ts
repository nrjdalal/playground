import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { opsDir as reportOpsDir } from "../../../../../../api/hono/src/lib/apps/ops-report"
import { planPath } from "../../../../../../api/hono/src/lib/apps/plan"
import { orderPath } from "../../../../../../api/hono/src/lib/apps/plan-order"
import { previewsDir } from "../../../../../../api/hono/src/lib/apps/previews"
import { mergedPullsPath } from "../../../../../../api/hono/src/lib/dashboard/agents"
import { attachmentsDir } from "../../../../../../api/hono/src/lib/dashboard/attachments"
import { rosterAgents } from "../../../../../../api/hono/src/lib/dashboard/cmux"
import { debugReportsDir } from "../../../../../../api/hono/src/lib/dashboard/debug-report"
import { heldPath } from "../../../../../../api/hono/src/lib/dashboard/held"
import { herdrServers, readStates } from "../../../../../../api/hono/src/lib/dashboard/herdr"
import { managersOrderPath } from "../../../../../../api/hono/src/lib/dashboard/managers-order"
import { mergeQueuePath } from "../../../../../../api/hono/src/lib/dashboard/merge-queue"
import { opsDir } from "../../../../../../api/hono/src/lib/dashboard/ops"
import { rosterPath } from "../../../../../../api/hono/src/lib/dashboard/roster"
import { unstickPath } from "../../../../../../api/hono/src/lib/dashboard/unstick"
import { claudeDir, dataDir, projectsDir } from "../../../../../../api/hono/src/lib/sessions/paths"
import { usagePath } from "../../../../../../api/hono/src/lib/usage/window"
import { zaiPath } from "../../../../../../api/hono/src/lib/usage/zai"
import { imagesDir } from "../../../../../../api/hono/src/plugins/changelog/images"
import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

describe("claudeDir and projectsDir", () => {
  const saved = process.env.CLAUDE_CONFIG_DIR
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = saved
  })

  test("CLAUDE_CONFIG_DIR wins when it is set", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-alt"
    expect(claudeDir()).toBe("/tmp/claude-alt")
    expect(projectsDir()).toBe("/tmp/claude-alt/projects")
  })

  test("otherwise ~/.claude", () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(projectsDir()).toBe(join(homedir(), ".claude", "projects"))
  })
})

// Every file the dashboard keeps outside the database, by the function that names it.
const PATHS: Record<string, () => string> = {
  attachmentsDir,
  debugPaste: () => debugReportsDir("paste"),
  heldPath,
  imagesDir,
  managersOrderPath,
  mergeQueuePath,
  mergedPullsPath,
  opsDir,
  orderPath,
  planPath,
  previewsDir,
  reportOpsDir,
  rosterPath,
  unstickPath,
  usagePath,
  zaiPath,
}

// The env each path reads, cleared around each test so the machine's own never decides.
const KEYS = [
  "CLAUDE_CONFIG_DIR",
  "PLAYGROUND_ATTACHMENTS_DIR",
  "PLAYGROUND_CHANGELOG_DIR",
  "PLAYGROUND_DATA_DIR",
  "PLAYGROUND_DEBUG_PASTE_DIR",
  "PLAYGROUND_MERGED_PULLS",
  "PLAYGROUND_PREVIEWS_DIR",
]

const under = (folder: string): string[] =>
  Object.entries(PATHS)
    .filter(([, path]) => !path().startsWith(`${folder}/`))
    .map(([name]) => name)

describe("dataDir and every path under it", () => {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
  let config = ""
  beforeEach(() => {
    for (const key of KEYS) delete process.env[key]
    config = mkdtempSync(join(tmpdir(), "paths-"))
    process.env.CLAUDE_CONFIG_DIR = config
  })
  afterEach(() => {
    rmSync(config, { force: true, recursive: true })
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  test("a scratch PLAYGROUND_DATA_DIR holds every path", () => {
    process.env.PLAYGROUND_DATA_DIR = join(config, "data")
    expect(dataDir()).toBe(join(config, "data"))
    expect(under(join(config, "data"))).toEqual([])
  })

  test("a scratch PLAYGROUND_DATA_DIR holds the roster cmux reads raw and each herdr session's state, never the config folder's", async () => {
    const state = (state: string) =>
      JSON.stringify({ at: "2026-10-29T11:00:00.000Z", event: "Stop", sessionId: "s-1", state })
    const write = (folder: string, agent: string, sessionState: string) => {
      mkdirSync(join(folder, "session-state"), { recursive: true })
      writeFileSync(join(folder, "roster.json"), JSON.stringify({ agents: [{ name: agent }] }))
      writeFileSync(join(folder, "session-state", "s-1.json"), state(sessionState))
    }
    write(join(config, "playground"), "from-config", "working")
    write(join(config, "data"), "from-scratch", "idle")
    process.env.PLAYGROUND_DATA_DIR = join(config, "data")
    expect(await rosterAgents()).toEqual([{ name: "from-scratch" }])
    expect((await readStates(["s-1"])).get("s-1")?.state).toBe("idle")
  })

  test("unset, every path is under the home folder's .playground, never the config folder", () => {
    const home = process.env.HOME
    process.env.HOME = join(config, "home")
    try {
      expect(under(join(config, "home", ".playground"))).toEqual([])
    } finally {
      process.env.HOME = home
    }
  })

  test("each override wins", () => {
    const overrides: [string, () => string][] = [
      ["PLAYGROUND_ATTACHMENTS_DIR", attachmentsDir],
      ["PLAYGROUND_CHANGELOG_DIR", imagesDir],
      ["PLAYGROUND_DEBUG_PASTE_DIR", PATHS.debugPaste],
      ["PLAYGROUND_MERGED_PULLS", mergedPullsPath],
      ["PLAYGROUND_PREVIEWS_DIR", previewsDir],
    ]
    for (const [name, path] of overrides) {
      process.env[name] = `/new/${name}`
      expect(path(), name).toBe(`/new/${name}`)
    }
  })

  test.skipIf(onLiveDashboard())(
    "a fixture stack keeps every path in its fixture, whatever PLAYGROUND_DATA_DIR and the overrides say",
    async () => {
      const modules: Record<string, string> = {
        attachmentsDir: "lib/dashboard/attachments",
        debugReportsDir: "lib/dashboard/debug-report",
        heldPath: "lib/dashboard/held",
        imagesDir: "plugins/changelog/images",
        managersOrderPath: "lib/dashboard/managers-order",
        mergeQueuePath: "lib/dashboard/merge-queue",
        opsDir: "lib/dashboard/ops",
        orderPath: "lib/apps/plan-order",
        planPath: "lib/apps/plan",
        previewsDir: "lib/apps/previews",
        rosterPath: "lib/dashboard/roster",
        unstickPath: "lib/dashboard/unstick",
        usagePath: "lib/usage/window",
        zaiPath: "lib/usage/zai",
      }
      const script = [
        "const { configDir } = await import(`${API}/lib/dashboard/fixture`)",
        "const paths = {}",
        ...Object.entries(modules).map(
          ([name, module]) =>
            `paths.${name} = (await import(\`\${API}/${module}\`)).${name}(${name === "debugReportsDir" ? '"paste"' : ""})`,
        ),
        "console.log(JSON.stringify({ config: configDir(), paths }))",
        "process.exit(0)",
      ].join("\n")
      const scratchEnv = Object.fromEntries(
        KEYS.filter((key) => key !== "CLAUDE_CONFIG_DIR").map((key) => [
          key,
          join(config, "live", key),
        ]),
      )
      const { code, result, stderr } = await inFixture(script, config, scratchEnv)
      expect(stderr).not.toContain("error")
      expect(code).toBe(0)
      const { config: fixtureConfig, paths } = result as {
        config: string
        paths: Record<string, string>
      }
      expect(Object.keys(paths)).toHaveLength(Object.keys(modules).length)
      expect(
        Object.entries(paths)
          .filter(([, path]) => !path.startsWith(`${fixtureConfig}/`))
          .map(([name]) => name),
      ).toEqual([])
    },
    60_000,
  )

  test("herdr's servers follow HOME's data folder and never PLAYGROUND_DATA_DIR", () => {
    mkdirSync(join(config, ".playground"), { recursive: true })
    const env = { PLAYGROUND_DATA_DIR: "/data/dashboard", HOME: config }
    const dirOf = (more: Record<string, string>) => herdrServers({ ...env, ...more })[0]?.socket
    expect(dirOf({})).toStartWith(join(config, ".playground", "herdr") + "/")
    expect(dirOf({ PLAYGROUND_HERDR_DIR: "/new" })).toStartWith("/new/")
  })
})
