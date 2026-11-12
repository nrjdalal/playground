import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check as guards } from "../../../scripts/hooks/guards"
import { check } from "../../../scripts/hooks/no-prepare-write"

const ROOT = join(import.meta.dir, "..", "..", "..")
let config = ""
let env: Record<string, string> = {}

// Three sessions in Claude Code's registry, each session id its name: a prepare-only worker, a worker whose claim cleared its mode, and one the roster never marked.
beforeAll(async () => {
  config = await mkdtemp(join(tmpdir(), "no-prepare-write-"))
  for (const [k, name] of ["worker-made-up-1", "worker-made-up-2", "worker-made-up-3"].entries())
    await Bun.write(
      join(config, "sessions", `${k}.json`),
      JSON.stringify({ name, pid: k, sessionId: name }),
    )
  await Bun.write(
    join(config, "playground", "roster.json"),
    JSON.stringify({
      agents: [
        { kind: "worker", mode: "prepare", name: "worker-made-up-1", task: "t", ticket: "MADE-1" },
        { kind: "worker", name: "worker-made-up-2", task: "t", ticket: "MADE-2" },
      ],
    }),
  )
  env = { CLAUDE_CONFIG_DIR: config, PLAYGROUND_DATA_DIR: join(config, "playground") }
})

afterAll(async () => {
  await rm(config, { force: true, recursive: true })
})

const bash = (command: string, session = "worker-made-up-1") =>
  JSON.stringify({ cwd: config, session_id: session, tool_input: { command }, tool_name: "Bash" })
const tool = (name: string, session = "worker-made-up-1") =>
  JSON.stringify({ session_id: session, tool_input: {}, tool_name: name })

const WRITES = [
  "mcp__linear-shared__save_issue",
  "mcp__linear__save_comment",
  "mcp__slack-shared__chat_post_message",
  "mcp__github-shared__create_pull_request",
]
const PR_CREATES = [
  "gh pr create --draft --title made-up --body-file /made-up/body.md",
  "cd /made-up && gh -R made-up/app pr create --fill",
  "env GH_TOKEN=x gh pr create --fill",
  "git commit -m made-up && gh pr create --fill",
]
const PUSHES = [
  "git push -u origin made-up",
  "git push -u origin made-up && gh pr create --fill",
  "git -C /made-up push origin HEAD:made-up",
  "env GIT_TRACE=0 git push",
]

describe("no-prepare-write refuses a prepare-only session's writes", () => {
  test.each(WRITES)("refuses %s", async (name) => {
    expect(await check(tool(name), env)).toStartWith("no-prepare-write hook refused the tool ")
  })

  test.each(PR_CREATES)("refuses %s", async (command) => {
    expect(await check(bash(command), env)).toStartWith(
      "no-prepare-write hook refused gh pr create",
    )
  })

  test.each(PUSHES)("refuses %s", async (command) => {
    expect(await check(bash(command), env)).toStartWith("no-prepare-write hook refused git push")
  })

  test.each([
    "mcp__linear-shared__get_issue",
    "mcp__linear-shared__list_comments",
    "mcp__slack-shared__conversations_history",
    "mcp__github-shared__pull_request_read",
  ])("lets it read with %s", async (name) => {
    expect(await check(tool(name), env)).toBeUndefined()
  })

  test.each([
    "gh pr view 1 --json state",
    "gh pr list",
    "git commit -m made-up",
    "git fetch origin",
    "git log --oneline -1",
    "echo gh pr create",
    "echo git push",
  ])("lets it run %s", async (command) => {
    expect(await check(bash(command), env)).toBeUndefined()
  })
})

describe("no-prepare-write lets the same writes run for a session not marked prepare-only", () => {
  test.each(["worker-made-up-2", "worker-made-up-3", "not-in-the-registry"])(
    "%s, whose roster row reads no mode or which the roster or the registry does not hold",
    async (session) => {
      for (const name of WRITES) expect(await check(tool(name, session), env)).toBeUndefined()
      for (const command of [...PR_CREATES, ...PUSHES])
        expect(await check(bash(command, session), env)).toBeUndefined()
    },
  )

  test("the claim's assign runs the moment roster.ts clears the mode", async () => {
    const data = join(config, "claim")
    await Bun.write(
      join(data, "roster.json"),
      JSON.stringify({
        agents: [{ kind: "worker", mode: "prepare", name: "worker-made-up-1", task: "t" }],
      }),
    )
    const claim = { ...env, PLAYGROUND_DATA_DIR: data }
    const assign = tool("mcp__linear-shared__save_issue")
    const push = bash("git push -u origin made-up")
    expect(await check(assign, claim)).toStartWith("no-prepare-write hook refused")
    expect(await check(push, claim)).toStartWith("no-prepare-write hook refused git push")
    const cleared = Bun.spawnSync(
      [process.execPath, join(ROOT, "scripts", "roster.ts"), "set", "worker-made-up-1", "mode="],
      { env: { ...process.env, ...claim } },
    )
    expect(cleared.exitCode).toBe(0)
    expect(await check(assign, claim)).toBeUndefined()
    expect(await check(push, claim)).toBeUndefined()
  })
})

describe("no-prepare-write runs where its calls arrive", () => {
  test("guards.ts runs it on a Bash call", async () => {
    const reason = await guards(bash("gh pr create --fill"), { ...env, PLAYGROUND_ROLE: "worker" })
    expect(reason).toContain("no-prepare-write hook refused gh pr create")
  })

  test("no-playground-leak's own process runs it on a tracker, chat or GitHub tool", async () => {
    const hook = Bun.spawnSync(
      [process.execPath, "--no-env-file", join(ROOT, "scripts", "hooks", "no-playground-leak.ts")],
      {
        env: { ...process.env, ...env, PLAYGROUND_ROLE: "worker" },
        stdin: Buffer.from(tool("mcp__slack-shared__chat_post_message")),
      },
    )
    expect(hook.exitCode).toBe(2)
    expect(hook.stderr.toString()).toStartWith("no-prepare-write hook refused the tool ")
  })
})

describe("no-prepare-write fails open, and logs each read that fails", () => {
  test("input it cannot read runs", async () => {
    expect(await check("not json", env)).toBeUndefined()
  })

  test("a roster it cannot read lets the write run, with a line in its log", async () => {
    const data = join(config, "broken")
    await Bun.write(join(data, "roster.json"), "not json")
    const broken = { ...env, PLAYGROUND_DATA_DIR: data }
    expect(await check(tool("mcp__linear-shared__save_issue"), broken)).toBeUndefined()
    const log = (await readFile(join(data, "ops", "no-prepare-write.log"), "utf8")).trim()
    expect(JSON.parse(log)).toMatchObject({
      session: "worker-made-up-1",
      tool: "mcp__linear-shared__save_issue",
    })
  })
})
