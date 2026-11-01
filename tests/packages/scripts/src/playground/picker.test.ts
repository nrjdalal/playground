import { describe, expect, test } from "bun:test"

import { type PickerDeps, runPicker } from "../../../../../packages/scripts/src/playground/picker"
import { callKey } from "../../../../../packages/scripts/src/stuck-alert"
import { PERMISSION_ID, permissionItem } from "../../../../api/hono/src/lib/dashboard/feed-fixtures"
import { OLD } from "../../../../session-names"

const SESSION = "d9d2ef1a-a7b9-4ecb-a758-087576d79391"
const KEY = callKey({ command: "rm -rf build" })
const RULE = "─".repeat(27)
const DASHES = "╌".repeat(27)
// A permission prompt as a herdr pane shows it, in the shape read off mydf54-probe's pane on 26 Oct.
const PERMISSION = [
  "⏺ Bash(rm -rf build)",
  RULE,
  " Bash command",
  " Clear the build",
  DASHES,
  " │ rm -rf build",
  DASHES,
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and don't ask again for rm commands",
  "   3. No, and tell Claude what to do differently (esc)",
].join("\n")
const call = (id: string, command: string) =>
  JSON.stringify({
    message: { content: [{ id, input: { command }, name: "Bash", type: "tool_use" }] },
    type: "assistant",
  })
const result = (id: string) =>
  JSON.stringify({ message: { content: [{ tool_use_id: id, type: "tool_result" }] }, type: "user" })
const AGENTS = [
  { kind: "builder", name: "m4n7pq-builder" },
  { kind: "dispatcher", name: "dispatcher" },
  { kind: "worker", name: "k3m9px-worker" },
]

// A herdr server holding the session's pane (or none), a cmux Feed, and a recorder for every press, log line and queued message.
const fake = (
  where: "cmux" | "herdr",
  {
    by = "m4n7pq-builder",
    feedInput = JSON.stringify({ command: "rm -rf build" }) as unknown,
    screen = PERMISSION,
    sticky = false,
    transcript = call("t1", "rm -rf build"),
  } = {},
) => {
  const calls: string[][] = []
  const logged: string[] = []
  const queued: [string, string][] = []
  const deps: PickerDeps = {
    agents: AGENTS,
    by,
    cmux: async (args) => {
      calls.push(["cmux", ...args])
      if (args[1] === "feed.list") {
        const workstream = `claude:${Buffer.from(SESSION).toString("base64")}`
        return JSON.stringify({
          items:
            where === "cmux" && (sticky || !calls.some((call) => call[2]?.endsWith(".reply")))
              ? [
                  {
                    kind: "permissionRequest",
                    request_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
                    tool_input: feedInput,
                    workstream_id: workstream,
                  },
                ]
              : [],
        })
      }
      return "{}"
    },
    herdr: async (server, args) => {
      calls.push(["herdr", server, ...args])
      if (args[1] === "list") return JSON.stringify({ result: { panes: [{ pane_id: "w1:p2" }] } })
      if (args[1] === "process-info")
        return JSON.stringify({
          result: {
            process_info: {
              foreground_processes: [{ name: "claude", pid: where === "herdr" ? 4242 : 1 }],
            },
          },
        })
      if (args[1] === "read") return screen
      return ""
    },
    live: async () =>
      new Map([
        ["k3m9px-worker", { pid: 4242, sessionId: SESSION }],
        ["dispatcher", { pid: 4343, sessionId: "e0e0e0e0-0000-4000-8000-000000000000" }],
        ["m4n7pq-builder", { pid: 4444, sessionId: "f0f0f0f0-0000-4000-8000-000000000000" }],
      ]),
    log: async (line) => void logged.push(line),
    now: () => new Date("2026-10-26T05:00:00Z"),
    queue: async (to, text) => void queued.push([to, text]),
    reportsTo: async () => undefined,
    servers: ["factory"],
    transcript: async () => transcript,
  }
  const presses = () =>
    calls.filter((call) => call.includes("send-keys") || call[2]?.endsWith(".reply"))
  return { calls, deps, logged, presses, queued }
}

describe("playground picker (PG-2184)", () => {
  test("allow on herdr presses 1 in the session's own pane once its prompt shows the keyed call, and logs it", async () => {
    const { deps, logged, presses, queued } = fake("herdr")
    expect(await runPicker(["k3m9px-worker", "allow", KEY], deps)).toEqual({
      code: 0,
      out: "2026-10-26T05:00:00Z m4n7pq-builder allow k3m9px-worker via herdr: rm -rf build",
    })
    expect(presses()).toEqual([["herdr", "factory", "pane", "send-keys", "w1:p2", "1"]])
    expect(logged).toEqual([
      "2026-10-26T05:00:00Z m4n7pq-builder allow k3m9px-worker via herdr: rm -rf build",
    ])
    expect(queued).toEqual([])
  })

  test("deny on herdr presses Escape, and the reason goes to the session as a message", async () => {
    const { deps, logged, presses, queued } = fake("herdr")
    expect(
      (await runPicker(["k3m9px-worker", "deny", KEY, "use", "mv", "instead"], deps)).code,
    ).toBe(0)
    expect(presses()).toEqual([["herdr", "factory", "pane", "send-keys", "w1:p2", "esc"]])
    expect(logged).toEqual([
      "2026-10-26T05:00:00Z m4n7pq-builder deny k3m9px-worker via herdr: rm -rf build (use mv instead)",
    ])
    expect(queued).toEqual([
      [
        "k3m9px-worker",
        "m4n7pq-builder denied your permission prompt (rm -rf build): use mv instead",
      ],
    ])
  })

  test("a deny with no reason is refused, since Escape alone leaves the session idle with nothing to go on", async () => {
    const { deps, presses, queued } = fake("herdr")
    const result = await runPicker(["k3m9px-worker", "deny", KEY], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("a deny carries its reason")
    expect(presses()).toEqual([])
    expect(queued).toEqual([])
  })

  test("a herdr pane showing no permission prompt gets no key", async () => {
    const { deps, logged, presses } = fake("herdr", { screen: "❯ \n  ? for shortcuts" })
    const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("shows no permission prompt")
    expect(presses()).toEqual([])
    expect(logged).toEqual([])
  })

  test("a prompt for another command than the keyed call gets no key", async () => {
    const screen = PERMISSION.replaceAll("rm -rf build", "rm -rf / --no-preserve-root")
    const transcript = [call("t1", "rm -rf build"), call("t2", "rm -rf / --no-preserve-root")].join(
      "\n",
    )
    const { deps, presses } = fake("herdr", { screen, transcript })
    const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("not for the call with key")
    expect(presses()).toEqual([])
  })

  test("a prompt for another call in the same worktree gets no key, though both share the cd prefix and the waiting call's header shows above it", async () => {
    const cd = `cd /Users/acme-dev/acme-dev/${OLD.dispatcher}/.claude/worktrees/pg-2184-stuck-alerts && `
    const a = `${cd}ls -la packages`
    const b = `${cd}rm -rf ~/.claude`
    const screen = PERMISSION.replace("⏺ Bash(rm -rf build)", `⏺ Bash(${a})`).replace(
      " │ rm -rf build",
      ` │ ${b}`,
    )
    const { deps, presses } = fake("herdr", {
      screen,
      transcript: [call("t1", a), call("t2", b)].join("\n"),
    })
    const result = await runPicker(["k3m9px-worker", "allow", callKey({ command: a })], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("not for the call with key")
    expect(presses()).toEqual([])
  })

  test("a dialog with no dashed rules that shows two waiting calls whole gets no key", async () => {
    const screen = [
      RULE,
      " Bash command",
      "   ls; rm -rf /",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. No",
    ].join("\n")
    const { deps, presses } = fake("herdr", {
      screen,
      transcript: [call("t1", "ls"), call("t2", "ls; rm -rf /")].join("\n"),
    })
    const result = await runPicker(["k3m9px-worker", "allow", callKey({ command: "ls" })], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("may be another waiting call's")
    expect(presses()).toEqual([])
  })

  test("two subagents' edits to files of one name: the prompt for the other's gets no key", async () => {
    const edit = (id: string, file_path: string) =>
      JSON.stringify({
        message: {
          content: [
            {
              id,
              input: { file_path, new_string: "x", old_string: "y" },
              name: "Edit",
              type: "tool_use",
            },
          ],
        },
        type: "assistant",
      })
    const screen = [
      RULE,
      " Edit file",
      " b/index.ts",
      " Do you want to make this edit to index.ts?",
      " ❯ 1. Yes",
      "   2. No",
    ].join("\n")
    const transcript = [edit("s1", "/repo/a/index.ts"), edit("s2", "/repo/b/index.ts")].join("\n")
    const { deps, presses } = fake("herdr", { screen, transcript })
    const key = callKey({ file_path: "/repo/a/index.ts", new_string: "x", old_string: "y" })
    const result = await runPicker(["k3m9px-worker", "allow", key], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("may be another waiting call's")
    expect(presses()).toEqual([])
  })

  test("the screen read off a real pane matches its call: the command wrapped in a narrow column, a warning and Claude Code's countdown below it", async () => {
    const command = `cd /Users/acme-dev/acme-dev/${OLD.dispatcher}/.claude/worktrees/pg-2184-stuck-alerts && f=x:1,2; for p in \${(s:,:)\${f#*:}}; do echo "$p"; done`
    const screen = [
      "",
      "───────────────────────────",
      " Bash command",
      " PG-2184 probe split",
      "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
      " │ cd /Users/acme-dev/acme",
      ` │ -dev/${OLD.dispatcher}/.claude/w`,
      " │ orktrees/pg-2184-stuck-",
      " │ alerts && f=x:1,2; for",
      " │ p in \${(s:,:)\${f#*:}};",
      ' │ do echo "$p"; done',
      "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
      " │ Dangerous rm operation",
      " │ not ruled out, the",
      " │ shell may read this",
      " │ command differently",
      " │ than it was parsed",
      " ⚠ Claude Code will",
      " automatically deny this",
      " request in 1:26, to avoid",
      " blocking progress on an",
      " unattended session",
      "",
      "",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. No",
      "",
      " Esc to cancel · Tab to",
      " amend",
    ].join("\n")
    const { deps, presses } = fake("herdr", { screen, transcript: call("t1", command) })
    expect((await runPicker(["k3m9px-worker", "allow", callKey({ command })], deps)).code).toBe(0)
    expect(presses()).toEqual([["herdr", "factory", "pane", "send-keys", "w1:p2", "1"]])
  })

  test("a key naming no waiting call gets no key: one that already ran, or another command's", async () => {
    for (const transcript of [
      [call("t1", "rm -rf build"), result("t1"), call("t2", "ls")].join("\n"),
      call("t2", "ls"),
    ]) {
      const { deps, presses } = fake("herdr", { transcript })
      const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
      expect(result.code).toBe(1)
      expect(result.out).toContain("no call waiting with key")
      expect(presses()).toEqual([])
    }
  })

  test("a long command wrapped across the pane's lines still matches its key", async () => {
    const command = `bun run test:file ${"tests/a/very/long/path.test.ts ".repeat(4).trim()}`
    const screen = PERMISSION.replace(
      " │ rm -rf build",
      ` │ ${command.slice(0, 50)}\n │ ${command.slice(50)}`,
    )
    const { deps, presses } = fake("herdr", { screen, transcript: call("t1", command) })
    expect((await runPicker(["k3m9px-worker", "allow", callKey({ command })], deps)).code).toBe(0)
    expect(presses()).toHaveLength(1)
  })

  test("on cmux it answers the session's pending Feed permission for the keyed call once, or denies it", async () => {
    for (const [answer, mode, ...words] of [
      ["allow", "once"],
      ["deny", "deny", "use mv"],
    ]) {
      const { deps, logged, presses } = fake("cmux", { transcript: "" })
      expect((await runPicker(["k3m9px-worker", answer!, KEY, ...words], deps)).code).toBe(0)
      expect(presses()).toEqual([
        [
          "cmux",
          "rpc",
          "feed.permission.reply",
          JSON.stringify({ mode, request_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }),
        ],
      ])
      expect(logged[0]).toStartWith(
        `2026-10-26T05:00:00Z m4n7pq-builder ${answer} k3m9px-worker via cmux: rm -rf build`,
      )
    }
  })

  test("answers a Feed item in cmux's own shape, its tool_input a JSON string, by the key of the command inside it", async () => {
    const { deps } = fake("cmux", { transcript: "" })
    const replies: string[][] = []
    deps.cmux = async (args) => {
      if (args[1] === "feed.list")
        return JSON.stringify({ items: replies.length ? [] : [permissionItem(SESSION)] })
      replies.push(args)
      return "{}"
    }
    const key = callKey({ command: "touch /tmp/scratch/denied-marker" })
    expect((await runPicker(["k3m9px-worker", "allow", key], deps)).out).toBe(
      "2026-10-26T05:00:00Z m4n7pq-builder allow k3m9px-worker via cmux: touch /tmp/scratch/denied-marker",
    )
    expect(replies).toEqual([
      ["rpc", "feed.permission.reply", JSON.stringify({ mode: "once", request_id: PERMISSION_ID })],
    ])
  })

  test("a cmux reply the Feed still holds afterwards is not logged as answered", async () => {
    const { deps, logged } = fake("cmux", { sticky: true, transcript: "" })
    const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("still holds the prompt")
    expect(logged).toEqual([])
  })

  test("a waiting call the screen cannot judge (an MCP tool's) beside the keyed one gets no key", async () => {
    const mcp = JSON.stringify({
      message: {
        content: [
          {
            id: "m1",
            input: { channel: "C1", text: "rm -rf build" },
            name: "mcp__slack__post",
            type: "tool_use",
          },
        ],
      },
      type: "assistant",
    })
    const { deps, presses } = fake("herdr", {
      transcript: [call("t1", "rm -rf build"), mcp].join("\n"),
    })
    const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
    expect(result.code).toBe(1)
    expect(result.out).toContain("may be another waiting call's")
    expect(presses()).toEqual([])
  })

  // The picker's whole decision on herdr, one row per waiting parent and prompt on screen (rounds 10 to 12).
  // Parent: none, a call whose child raises prompts (Agent, Task, Skill, Workflow), or a plain tool the screen cannot judge (an MCP call).
  // Prompt: the keyed command's own dialog, its command whole between the dashed rules ("box"); a dialog with no box that quotes the command, as a parent's own prompt draws ("quote"); or none.
  const PARENT_INPUTS = {
    Agent: {
      description: "Review",
      prompt: "Review it: rm -rf build",
      subagent_type: "general-purpose",
    },
    Skill: { skill: "end-of-day-scan" },
    Task: { description: "Review", prompt: "Review it: rm -rf build" },
    Workflow: { script: "export const meta = {}" },
    mcp__slack__post: { channel: "C1", text: "rm -rf build" },
  } as const
  const SCREENS = {
    box: PERMISSION,
    none: "❯ \n  ? for shortcuts",
    quote: [
      RULE,
      " Agent",
      " Review it: rm -rf build",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. No",
    ].join("\n"),
  }
  const TABLE: (readonly [
    keyof typeof PARENT_INPUTS | "none",
    keyof typeof SCREENS,
    "leave" | "press" | "refuse",
  ])[] = [
    ["none", "box", "press"],
    ["none", "quote", "press"],
    ["none", "none", "leave"],
    ...(["Agent", "Task", "Skill", "Workflow"] as const).flatMap((parent) => [
      [parent, "box", "press"] as const,
      [parent, "quote", "refuse"] as const,
      [parent, "none", "leave"] as const,
    ]),
    ["mcp__slack__post", "box", "refuse"],
    ["mcp__slack__post", "quote", "refuse"],
    ["mcp__slack__post", "none", "leave"],
  ]
  for (const [parent, screen, action] of TABLE)
    test(`waiting parent ${parent}, prompt ${screen}: ${action}`, async () => {
      const lines = [call("s1", "rm -rf build")]
      if (parent !== "none")
        lines.unshift(
          JSON.stringify({
            message: {
              content: [{ id: "p1", input: PARENT_INPUTS[parent], name: parent, type: "tool_use" }],
            },
            type: "assistant",
          }),
        )
      const { deps, presses } = fake("herdr", {
        screen: SCREENS[screen],
        transcript: lines.join("\n"),
      })
      const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
      expect(result.code).toBe(action === "press" ? 0 : 1)
      expect(presses()).toEqual(
        action === "press" ? [["herdr", "factory", "pane", "send-keys", "w1:p2", "1"]] : [],
      )
      if (action === "leave") expect(result.out).toContain("shows no permission prompt")
      if (action === "refuse") expect(result.out).toContain("may be another waiting call's")
    })

  test("a cmux Feed permission for another command is not answered", async () => {
    const { deps, presses } = fake("cmux", { feedInput: JSON.stringify({ command: "rm -rf /" }) })
    const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
    expect(result.code).toBe(1)
    expect(presses()).toEqual([])
  })

  test("only the session's manager or the primary dispatcher answers: not the session itself, another session, or an unknown caller", async () => {
    for (const by of ["k3m9px-worker", "x7c2vb-worker", "unknown"]) {
      const { deps, presses } = fake("herdr", { by })
      const result = await runPicker(["k3m9px-worker", "allow", KEY], deps)
      expect(result.code).toBe(1)
      expect(result.out).toContain("only k3m9px-worker's manager, m4n7pq-builder")
      expect(presses()).toEqual([])
    }
    expect(
      (await runPicker(["k3m9px-worker", "allow", KEY], fake("herdr", { by: "dispatcher" }).deps))
        .code,
    ).toBe(0)
  })

  test("refuses a session that is not live, a dispatcher's own by its roster kind, a bad key, and any answer but allow or deny", async () => {
    const { deps, presses } = fake("herdr")
    deps.agents = [...AGENTS, { kind: "dispatcher", name: "nightdesk" }]
    const live = await deps.live()
    deps.live = async () => new Map([...live, ["nightdesk", { pid: 4545, sessionId: SESSION }]])
    for (const args of [
      ["worker-gone", "allow", KEY],
      ["dispatcher", "allow", KEY],
      ["nightdesk", "allow", KEY],
      ["k3m9px-worker", "allow"],
      ["k3m9px-worker", "allow", "rm -rf build"],
      ["k3m9px-worker", "always", KEY],
      [],
    ])
      expect((await runPicker(args, deps)).code).toBe(1)
    expect(presses()).toEqual([])
  })

  test("the log line holds the command's first 120 characters", async () => {
    const command = `echo ${"x".repeat(200)}`
    const screen = PERMISSION.replace(" │ rm -rf build", ` │ ${command}`)
    const { deps, logged } = fake("herdr", { screen, transcript: call("t1", command) })
    expect((await runPicker(["k3m9px-worker", "allow", callKey({ command })], deps)).code).toBe(0)
    expect(logged[0]).toBe(
      `2026-10-26T05:00:00Z m4n7pq-builder allow k3m9px-worker via herdr: ${command.slice(0, 120)}`,
    )
  })
})
