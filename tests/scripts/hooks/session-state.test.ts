import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sessionStateDir, sessionStateSchema } from "../../../packages/config/src/session-state"
import { callKey } from "../../../packages/scripts/src/stuck-alert"
import { herdrArgs, recordOf, run, statePath } from "../../../scripts/hooks/session-state"

// A config folder for the hook, its data folder named by PLAYGROUND_DATA_DIR, since the config folder never places it.
const envOf = (config: string) => ({
  CLAUDE_CONFIG_DIR: config,
  PLAYGROUND_DATA_DIR: join(config, "playground"),
})

const NOW = new Date("2026-10-18T01:00:00.000Z")
const ID = "d9d2ef1a-a7b9-4ecb-a758-087576d79391"
const base = { cwd: "/w", session_id: ID, transcript_path: "/nowhere.jsonl" }

// Hook inputs as Claude Code 2.1.302 sent them to a probe, trimmed to the fields the hook reads.
const PROMPT = { ...base, hook_event_name: "UserPromptSubmit", prompt: "say hi" }
const STOP = { ...base, hook_event_name: "Stop" }
const permission = (tool: string) => ({
  ...base,
  hook_event_name: "PermissionRequest",
  tool_input: {},
  tool_name: tool,
})
const postTool = (tool: string, more: Record<string, string> = {}) => ({
  ...base,
  hook_event_name: "PostToolUse",
  tool_input: {},
  tool_name: tool,
  tool_use_id: "toolu_1",
  ...more,
})
const notification = (type: string) => ({
  ...base,
  hook_event_name: "Notification",
  message: "Claude needs your permission",
  notification_type: type,
})
const failure = (error: string, text: string, transcript = base.transcript_path) => ({
  ...base,
  error,
  hook_event_name: "StopFailure",
  last_assistant_message: text,
  transcript_path: transcript,
})
const GLM_LIMIT =
  "API Error: Request rejected (429) · [1308][Usage limit reached for 5 hour. Your limit will reset at 2026-10-18 11:11:16][2026101800]"

const scratch = mkdtempSync(join(tmpdir(), "session-state-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

describe("each hook event becomes the state the session is in", () => {
  test.each([
    ["a prompt starts a turn", PROMPT, { state: "working" }],
    ["a stop ends it", STOP, { state: "idle" }],
    [
      "a permission prompt",
      permission("Bash"),
      { reason: "permission", state: "stuck", tool: "Bash" },
    ],
    [
      "a picker",
      permission("AskUserQuestion"),
      { reason: "question", state: "stuck", tool: "AskUserQuestion" },
    ],
    [
      "a plan to approve",
      permission("ExitPlanMode"),
      { reason: "plan", state: "stuck", tool: "ExitPlanMode" },
    ],
    [
      "the permission notice",
      notification("permission_prompt"),
      { reason: "permission", state: "stuck" },
    ],
    [
      "an MCP server's question",
      notification("elicitation_dialog"),
      { reason: "elicitation", state: "stuck" },
    ],
    ["the idle notice", notification("idle_prompt"), { state: "idle" }],
    [
      "a login screen",
      failure("authentication_failed", "Please run /login"),
      { reason: "login", state: "stuck" },
    ],
    [
      "a dropped connection",
      failure("server_error", "API Error: Connection dropped (ECONNRESET)"),
      { reason: "server_error", state: "failed" },
    ],
    [
      "a request rate limit",
      failure(
        "rate_limit",
        "API Error: Request rejected (429) · [1302][Rate limit reached for requests]",
      ),
      { reason: "rate_limit", state: "failed" },
    ],
  ])("%s", async (_, input, expected) => {
    const record = await recordOf(input, NOW)
    expect(record as unknown).toEqual({
      at: NOW.toISOString(),
      event: input.hook_event_name,
      sessionId: ID,
      ...expected,
    })
    expect(sessionStateSchema.parse(record)).toEqual(record!)
  })

  test("a notice the session is not waiting on writes nothing", async () => {
    expect(await recordOf(notification("auth_success"), NOW)).toBeNull()
  })

  test("an input with no session id, or one that is not a plain id, writes nothing", async () => {
    expect(await recordOf({ hook_event_name: "Stop" }, NOW)).toBeNull()
    expect(await recordOf({ ...STOP, session_id: "../x" }, NOW)).toBeNull()
  })
})

describe("a turn that ends on a usage limit records out of usage with its reset", () => {
  test("GLM prints its reset in UTC+8", async () => {
    expect(await recordOf(failure("rate_limit", GLM_LIMIT), NOW)).toMatchObject({
      reason: "rate_limit",
      resetsAt: "2026-10-18T03:11:16.000Z",
      state: "usage-limit",
    })
  })

  test("Claude's reset comes from the limit line in the transcript", async () => {
    const transcript = join(scratch, "claude.jsonl")
    const line = (resetsAt: number) =>
      JSON.stringify({
        error: "rate_limit",
        isApiErrorMessage: true,
        message: {
          content: [
            {
              text: "You've hit your session limit · resets 12:50am (Asia/Calcutta)",
              type: "text",
            },
          ],
        },
        quotaLimits: { rateLimitType: "five_hour", resetsAt, status: "rejected" },
        type: "assistant",
      })
    writeFileSync(
      transcript,
      `${line(1791800000)}\n{"type":"user"}\n${line(1791832800)}\n{"type":"system","subtype":"turn_duration"}\n`,
    )
    expect(
      await recordOf(
        failure(
          "rate_limit",
          "You've hit your session limit · resets 12:50am (Asia/Calcutta)",
          transcript,
        ),
        NOW,
      ),
    ).toMatchObject({ resetsAt: new Date(1791832800 * 1000).toISOString(), state: "usage-limit" })
  })

  test("a limit whose reset cannot be read still records out of usage", async () => {
    const record = await recordOf(
      failure("rate_limit", "You've hit your weekly limit · resets Oct 20"),
      NOW,
    )
    expect(record).toMatchObject({ state: "usage-limit" })
    expect(record?.resetsAt).toBeUndefined()
  })

  test("Claude's short form, with no window named, is a usage limit too", async () => {
    expect(
      await recordOf(failure("rate_limit", "You've hit your limit · resets 3am (UTC)"), NOW),
    ).toMatchObject({ state: "usage-limit" })
  })
})

describe("herdr's own state follows the hook, under dispatcher's own source, as the agent claude herdr can prompt (#1066)", () => {
  const env = { HERDR_BIN_PATH: "/bin/herdr", HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" }

  test.each([
    ["working", "working"],
    ["idle", "idle"],
    ["stuck", "blocked"],
    ["usage-limit", "blocked"],
    ["failed", "blocked"],
  ] as const)("%s reports %s", (state, herdr) => {
    expect(
      herdrArgs({ at: NOW.toISOString(), event: "Stop", sessionId: ID, state }, env, 7),
    ).toEqual([
      "/bin/herdr",
      "pane",
      "report-agent",
      "w1:p2",
      "--source",
      "custom:playground",
      "--agent",
      "claude",
      "--state",
      herdr,
      "--seq",
      "7",
    ])
  })

  test("an ended session hands the pane back to herdr's own reading", () => {
    expect(herdrArgs(null, env, 8)).toEqual([
      "/bin/herdr",
      "pane",
      "release-agent",
      "w1:p2",
      "--source",
      "custom:playground",
      "--agent",
      "claude",
      "--seq",
      "8",
    ])
  })

  test("an ended session writes no state", async () => {
    const own = envOf(join(scratch, "ended"))
    await run(
      JSON.stringify({
        ...base,
        hook_event_name: "SessionEnd",
        reason: "exit",
      }),
      own,
      NOW,
    )
    expect(await Bun.file(statePath(own, ID)).exists()).toBe(false)
  })

  test("outside herdr it reports nothing", () => {
    const record = {
      at: NOW.toISOString(),
      event: "Stop",
      sessionId: ID,
      state: "idle" as const,
    }
    expect(herdrArgs(record, {}, 7)).toBeNull()
    expect(herdrArgs(record, { ...env, HERDR_ENV: "0" }, 7)).toBeNull()
    expect(herdrArgs(record, { ...env, HERDR_PANE_ID: "" }, 7)).toBeNull()
    expect(herdrArgs(null, {}, 7)).toBeNull()
  })
})

describe("the hook writes one file per session where the Dashboard reads it", () => {
  const config = join(scratch, "config")
  const env = envOf(config)

  test("its path is the shared module's folder", () => {
    expect(statePath(env, ID)).toBe(join(sessionStateDir(join(config, "playground")), `${ID}.json`))
  })

  test("each event replaces the session's file, leaving no temp file", async () => {
    await run(JSON.stringify(PROMPT), env, NOW)
    await run(JSON.stringify(permission("Bash")), env, NOW)
    const record = sessionStateSchema.parse(await Bun.file(statePath(env, ID)).json())
    expect(record).toMatchObject({ state: "stuck", tool: "Bash" })
    expect(readdirSync(sessionStateDir(join(config, "playground")))).toEqual([`${ID}.json`])
  })

  test("the permission notice after a PermissionRequest keeps the prompt's tool", async () => {
    const own = envOf(join(scratch, "notice"))
    await run(JSON.stringify(permission("AskUserQuestion")), own, NOW)
    await run(JSON.stringify(notification("permission_prompt")), own, NOW)
    expect(await Bun.file(statePath(own, ID)).json()).toMatchObject({
      event: "PermissionRequest",
      reason: "question",
      tool: "AskUserQuestion",
    })
  })

  test("the idle notice after a turn that ended on a usage limit keeps the limit", async () => {
    const own = envOf(join(scratch, "limit-idle"))
    await run(JSON.stringify(failure("rate_limit", GLM_LIMIT)), own, NOW)
    await run(JSON.stringify(notification("idle_prompt")), own, NOW)
    expect(await Bun.file(statePath(own, ID)).json()).toMatchObject({
      resetsAt: "2026-10-18T03:11:16.000Z",
      state: "usage-limit",
    })
  })

  test("the idle notice after a stop records idle", async () => {
    const own = envOf(join(scratch, "stop-idle"))
    await run(JSON.stringify(STOP), own, NOW)
    await run(JSON.stringify(notification("idle_prompt")), own, NOW)
    expect(await Bun.file(statePath(own, ID)).json()).toMatchObject({
      event: "Notification",
      state: "idle",
    })
  })

  test("the permission notice alone still records the session as stuck", async () => {
    const own = envOf(join(scratch, "notice-alone"))
    await run(JSON.stringify(PROMPT), own, NOW)
    await run(JSON.stringify(notification("permission_prompt")), own, NOW)
    expect(await Bun.file(statePath(own, ID)).json()).toMatchObject({
      event: "Notification",
      reason: "permission",
      state: "stuck",
    })
  })

  test("an input that does not read writes nothing and does not throw", async () => {
    const empty = envOf(join(scratch, "empty"))
    await run("not json", empty, NOW)
    expect(await Bun.file(statePath(empty, ID)).exists()).toBe(false)
  })
})

describe("a tool that ran ends the prompt it waited on", () => {
  const steps = async (name: string, ...inputs: object[]) => {
    const own = envOf(join(scratch, name))
    for (const input of inputs) await run(JSON.stringify(input), own, NOW)
    const file = Bun.file(statePath(own, ID))
    return (await file.exists()) ? ((await file.json()) as Record<string, unknown>) : null
  }

  test("an answered picker reads working", async () => {
    expect(
      await steps("answered", permission("AskUserQuestion"), postTool("AskUserQuestion")),
    ).toMatchObject({
      event: "PostToolUse",
      state: "working",
      tool: "AskUserQuestion",
    })
  })

  test("an approved permission reads working, and its notice 6s later keeps it", async () => {
    expect(
      await steps(
        "approved",
        permission("Bash"),
        postTool("Bash"),
        notification("permission_prompt"),
      ),
    ).toMatchObject({ event: "PostToolUse", state: "working" })
  })

  test("a tool with no prompt waiting writes nothing", async () => {
    expect(await steps("no-prompt", postTool("Read"))).toBeNull()
    expect(await steps("after-prompt", PROMPT, postTool("Read"))).toMatchObject({
      event: "UserPromptSubmit",
    })
  })

  test("another tool, or a subagent's, keeps the prompt", async () => {
    expect(await steps("other-tool", permission("Bash"), postTool("Read"))).toMatchObject({
      state: "stuck",
      tool: "Bash",
    })
    expect(
      await steps("subagent", permission("Bash"), postTool("Bash", { agent_id: "a1" })),
    ).toMatchObject({ state: "stuck", tool: "Bash" })
    expect(
      await steps(
        "own-subagent",
        permission("Bash"),
        { ...permission("Bash"), agent_id: "a1" },
        postTool("Bash", { agent_id: "a1" }),
      ),
    ).toMatchObject({ agentId: "a1", state: "working" })
  })

  test("a tool after a Stop a Stop hook continued reads working, once; a subagent's keeps idle", async () => {
    expect(await steps("continued", PROMPT, STOP, postTool("Bash"))).toMatchObject({
      event: "PostToolUse",
      state: "working",
    })
    expect(
      await steps("background", PROMPT, STOP, postTool("Bash", { agent_id: "a1" })),
    ).toMatchObject({ event: "Stop", state: "idle" })
    const own = envOf(join(scratch, "continued-once"))
    for (const input of [PROMPT, STOP, postTool("Bash")]) await run(JSON.stringify(input), own, NOW)
    await run(JSON.stringify(postTool("Read")), own, new Date(NOW.getTime() + 5000))
    expect(await Bun.file(statePath(own, ID)).json()).toMatchObject({
      at: NOW.toISOString(),
      tool: "Bash",
    })
  })

  test("a main-agent tool after a turn that failed reads working; a login and a subagent's tool keep it", async () => {
    expect(
      await steps("login", failure("authentication_failed", "Please run /login"), postTool("Read")),
    ).toMatchObject({ reason: "login", state: "stuck" })
    expect(await steps("limit", failure("rate_limit", GLM_LIMIT), postTool("Read"))).toMatchObject({
      event: "PostToolUse",
      state: "working",
    })
    expect(
      await steps("failed", failure("server_error", "API Error: 500"), postTool("Read")),
    ).toMatchObject({ state: "working" })
    expect(
      await steps(
        "limit-subagent",
        failure("rate_limit", GLM_LIMIT),
        postTool("Read", { agent_id: "a1" }),
      ),
    ).toMatchObject({ state: "usage-limit" })
  })

  test("an approved tool that fails, or a denied one, ends its prompt too", async () => {
    expect(
      await steps("tool-failed", permission("Bash"), {
        ...postTool("Bash"),
        hook_event_name: "PostToolUseFailure",
      }),
    ).toMatchObject({ event: "PostToolUseFailure", state: "working" })
    expect(
      await steps(
        "denied",
        permission("Bash"),
        { ...postTool("Bash"), hook_event_name: "PermissionDenied" },
        notification("permission_prompt"),
      ),
    ).toMatchObject({ event: "PermissionDenied", state: "working" })
  })

  test("an MCP prompt raised after a tool ran still records stuck", async () => {
    expect(
      await steps(
        "elicitation",
        permission("Bash"),
        postTool("Bash"),
        notification("elicitation_dialog"),
      ),
    ).toMatchObject({ reason: "elicitation", state: "stuck" })
  })
})

describe("a stuck or failed record tells the session's manager at once (PG-2184)", () => {
  const setup = (name: string) => {
    const config = mkdtempSync(join(scratch, "alert-"))
    mkdirSync(join(config, "sessions"))
    mkdirSync(join(config, "playground"))
    const live = [
      [name, ID],
      ["m4n7pq-builder", "b0b0b0b0-0000-4000-8000-000000000000"],
    ]
    for (const [i, [who, sessionId]] of live.entries())
      writeFileSync(
        join(config, "sessions", `${i}.json`),
        JSON.stringify({ name: who, pid: process.pid, sessionId }),
      )
    const agents = [
      { kind: "builder", name: "m4n7pq-builder", status: "working" },
      { kind: "worker", name: "k3m9px-worker", status: "working", task: "PG-1: fix it" },
    ]
    writeFileSync(join(config, "playground", "roster.json"), JSON.stringify({ agents }))
    const transcript = join(config, "t.jsonl")
    writeFileSync(
      transcript,
      `${JSON.stringify({
        message: { content: [{ text: "Clearing the build.", type: "text" }] },
        type: "assistant",
      })}\n`,
    )
    const outbox = join(config, "playground", "ops", "outbox", "ops-stuck-alert.jsonl")
    const sent = async () =>
      (
        await Bun.file(outbox)
          .text()
          .catch(() => "")
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { job: string; text: string; to: string })
    return { env: envOf(config), sent, transcript }
  }

  test("a worker's permission prompt queues one line to its manager alone, with the command and its last words", async () => {
    const { env, sent, transcript } = setup("k3m9px-worker")
    const input = {
      ...permission("Bash"),
      tool_input: { command: "rm -rf build" },
      transcript_path: transcript,
    }
    await run(JSON.stringify(input), env, NOW)
    await run(JSON.stringify(notification("permission_prompt")), env, NOW)
    const lines = await sent()
    expect(lines.map(({ job, to }) => [job, to])).toEqual([["stuck-alert", "m4n7pq-builder"]])
    expect(lines[0]!.text).toContain("rm -rf build")
    expect(lines[0]!.text).toContain("Clearing the build.")
    expect(lines[0]!.text).toContain("PG-1: fix it")
    expect(lines[0]!.text).toContain(
      `playground picker k3m9px-worker allow ${callKey({ command: "rm -rf build" })}.`,
    )
  })

  test("a call with no command, file or URL (an MCP tool's) shows its whole input beside the key", async () => {
    const { env, sent, transcript } = setup("k3m9px-worker")
    const tool_input = { channel: "C0123", text: "hello" }
    await run(
      JSON.stringify({
        ...permission("mcp__slack__post"),
        tool_input,
        transcript_path: transcript,
      }),
      env,
      NOW,
    )
    const [line] = await sent()
    expect(line!.text).toContain(`:\n${JSON.stringify(tool_input)}\n`)
    expect(line!.text).toContain(`allow ${callKey(tool_input)}.`)
  })

  test("a failed turn alerts too; a working or idle one does not", async () => {
    const { env, sent } = setup("k3m9px-worker")
    await run(JSON.stringify(PROMPT), env, NOW)
    await run(JSON.stringify(STOP), env, NOW)
    expect(await sent()).toEqual([])
    await run(JSON.stringify(failure("server_error", "API Error: 500")), env, NOW)
    expect((await sent()).map(({ to }) => to)).toEqual(["m4n7pq-builder"])
  })

  test("dispatcher's own prompt and a session outside the factory queue nothing", async () => {
    for (const name of ["dispatcher", "notes"]) {
      const { env, sent } = setup(name)
      await run(JSON.stringify(permission("Bash")), env, NOW)
      expect(await sent()).toEqual([])
    }
  })
})
