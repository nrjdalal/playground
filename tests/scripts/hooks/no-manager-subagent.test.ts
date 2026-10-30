import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-manager-subagent"
import { OLD_NAMES } from "../../session-names"
import { storeWith } from "./render-set"

const root = join(import.meta.dir, "..", "..", "..")
let config = ""
let checker = ""

// Each session as cmux restores it, in Claude Code's registry by name with no PLAYGROUND_ROLE, its session id its name.
const NAMES = [
  "ops",
  "builder",
  "dispatcher",
  "dispatcher-2",
  "planner",
  "notes",
  "optimizer",
  "reviewer-calm-sift",
  "worker-calm-sift",
  "x7mh4d-builder",
]

beforeAll(async () => {
  config = await mkdtemp(join(tmpdir(), "no-manager-subagent-"))
  for (const [k, name] of NAMES.entries())
    await Bun.write(
      join(config, "sessions", `${k}.json`),
      JSON.stringify({ name, pid: k, sessionId: name }),
    )
  await Bun.write(
    join(config, "playground", "roster.json"),
    JSON.stringify({
      agents: [{ kind: "builder", name: "x7mh4d-builder", role: "manager" }],
    }),
  )
  storeWith(join(config, "playground"), {}, { "sessions.aliases": OLD_NAMES })
  // builder's name places it as a manager; its roster kind, read first, places it as a checker.
  checker = await mkdtemp(join(tmpdir(), "no-manager-subagent-"))
  await Bun.write(
    join(checker, "sessions", "0.json"),
    JSON.stringify({ name: "builder", pid: 0, sessionId: "builder" }),
  )
  await Bun.write(
    join(checker, "playground", "roster.json"),
    JSON.stringify({ agents: [{ kind: "reviewer", name: "builder" }] }),
  )
})

afterAll(async () => {
  await rm(config, { force: true, recursive: true })
  await rm(checker, { force: true, recursive: true })
})

const input = (tool: string, session?: string) =>
  JSON.stringify({ session_id: session, tool_input: { prompt: "read the hooks" }, tool_name: tool })

describe("no-manager-subagent", () => {
  test.each(["dispatcher", "lead", "manager"])(
    "refuses the Agent and Workflow tools to PLAYGROUND_ROLE %s",
    async (role) => {
      for (const tool of ["Agent", "Workflow"])
        expect(
          await check(input(tool), {
            CLAUDE_CONFIG_DIR: config,
            PLAYGROUND_DATA_DIR: join(config, "playground"),
            PLAYGROUND_ROLE: role,
          }),
        ).toMatch(/scripts\/spawn\.sh/)
    },
  )

  test.each(["ops", "builder", "dispatcher", "dispatcher-2", "planner", "optimizer"])(
    "refuses the Agent tool to %s, restored by its registry name",
    async (name) => {
      expect(
        await check(input("Agent", name), {
          CLAUDE_CONFIG_DIR: config,
          PLAYGROUND_DATA_DIR: join(config, "playground"),
        }),
      ).toMatch(/^no-manager-subagent hook refuses the Agent tool to a manager/)
    },
  )

  test("refuses the Agent tool to a manager its roster kind places", async () => {
    expect(
      await check(input("Agent", "x7mh4d-builder"), {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
      }),
    ).toBeString()
  })

  test.each(["probe", "reviewer", "runner", "tester", "worker"])(
    "passes PLAYGROUND_ROLE %s",
    async (role) => {
      for (const tool of ["Agent", "Workflow"])
        expect(
          await check(input(tool), {
            CLAUDE_CONFIG_DIR: config,
            PLAYGROUND_DATA_DIR: join(config, "playground"),
            PLAYGROUND_ROLE: role,
          }),
        ).toBeUndefined()
    },
  )

  // A reviewer's code-review runs two sub-agents, which a later change keeps.
  test.each(["reviewer-calm-sift", "worker-calm-sift"])(
    "passes %s, restored by its registry name",
    async (name) => {
      expect(
        await check(input("Agent", name), {
          CLAUDE_CONFIG_DIR: config,
          PLAYGROUND_DATA_DIR: join(config, "playground"),
        }),
      ).toBeUndefined()
    },
  )

  test("passes a checker its roster kind places, though its name reads as a manager", async () => {
    expect(
      await check(input("Agent", "builder"), {
        CLAUDE_CONFIG_DIR: checker,
        PLAYGROUND_DATA_DIR: join(checker, "playground"),
      }),
    ).toBeUndefined()
  })

  test("passes Merritt's own session, with no role and no factory name", async () => {
    expect(
      await check(input("Agent", "notes"), {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
      }),
    ).toBeUndefined()
    expect(
      await check(input("Agent"), {
        CLAUDE_CONFIG_DIR: config,
        PLAYGROUND_DATA_DIR: join(config, "playground"),
      }),
    ).toBeUndefined()
  })

  test("passes a manager's other tools", async () => {
    for (const tool of ["Bash", "Read", "Skill"])
      expect(
        await check(input(tool), {
          CLAUDE_CONFIG_DIR: config,
          PLAYGROUND_DATA_DIR: join(config, "playground"),
          PLAYGROUND_ROLE: "lead",
        }),
      ).toBeUndefined()
  })

  test.each(["", "{", "null", "[]", '"Agent"'])(
    "fails open on input it cannot read: %p",
    async (raw) => {
      expect(
        await check(raw, {
          CLAUDE_CONFIG_DIR: config,
          PLAYGROUND_DATA_DIR: join(config, "playground"),
          PLAYGROUND_ROLE: "lead",
        }),
      ).toBeUndefined()
    },
  )

  const run = async (payload: string, env: Record<string, string>) => {
    const { PLAYGROUND_ROLE: _role, ...inherited } = process.env
    const proc = Bun.spawn(
      ["bun", "--no-env-file", join(root, "scripts", "hooks", "no-manager-subagent.ts")],
      {
        env: {
          ...inherited,
          CLAUDE_CONFIG_DIR: config,
          PLAYGROUND_DATA_DIR: join(config, "playground"),
          ...env,
        },
        stderr: "pipe",
        stdin: new Blob([payload]),
      },
    )
    return { code: await proc.exited, stderr: await new Response(proc.stderr).text() }
  }

  test("exits 2 with its reason on stderr for a manager, and 0 for a worker", async () => {
    const refused = await run(input("Agent"), { PLAYGROUND_ROLE: "lead" })
    expect(refused.code).toBe(2)
    expect(refused.stderr).toMatch(/^no-manager-subagent hook refuses the Agent tool/)
    expect((await run(input("Agent"), { PLAYGROUND_ROLE: "worker" })).code).toBe(0)
  })
})
