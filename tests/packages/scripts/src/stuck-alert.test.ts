import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  alertText,
  callKey,
  callOf,
  detailOf,
  lastWords,
  managerFor,
  pendingCalls,
  transcriptOf,
} from "../../../../packages/scripts/src/stuck-alert"

const AGENTS = [
  { kind: "builder", name: "m4n7pq-builder", status: "working" },
  { kind: "ops", name: "ops", status: "working" },
  { kind: "planner", name: "planner", status: "working" },
  { kind: "dispatcher", name: "dispatcher", status: "working" },
  { kind: "worker", name: "k3m9px-worker", status: "working", task: "PG-1: fix it" },
  { kind: "reviewer", name: "k3m9px-reviewer", worker: "k3m9px-worker" },
  { kind: "tester", name: "b7k2mq-tester", worker: "ops" },
  { kind: "runner", name: "runner-plain-relay" },
  { kind: "researcher", name: "c8d9fg-researcher" },
  { kind: "probe", name: "h2j3kl-probe" },
]
const ALL = new Set(["m4n7pq-builder", "ops", "planner", "dispatcher", "k3m9px-worker"])

describe("the manager a stuck session's alert goes to (PG-2184)", () => {
  test.each([
    ["a worker's goes to the builder's seat", "k3m9px-worker", undefined, "m4n7pq-builder"],
    ["a worker's goes to the session its brief reports to", "k3m9px-worker", "ops", "ops"],
    [
      "its reviewer's to the builder, not its worker",
      "k3m9px-reviewer",
      "k3m9px-worker",
      "m4n7pq-builder",
    ],
    ["a checker of an ops PR's to ops", "b7k2mq-tester", undefined, "ops"],
    ["a runner's to ops", "runner-plain-relay", undefined, "ops"],
    ["a research worker's to the planner", "c8d9fg-researcher", undefined, "planner"],
    ["a probe's to its spawner", "h2j3kl-probe", "k3m9px-worker", "k3m9px-worker"],
    ["a lead's own to dispatcher", "m4n7pq-builder", undefined, "dispatcher"],
    ["one whose manager is down to dispatcher", "k3m9px-worker", "worker-gone", "dispatcher"],
  ])("%s", (_, name, reportsTo, to) => {
    expect(managerFor(name, AGENTS, reportsTo, ALL)).toBe(to)
  })

  test("dispatcher's own block and a session outside the factory go nowhere", () => {
    expect(managerFor("dispatcher", AGENTS, undefined, ALL)).toBeNull()
    expect(managerFor("dispatcher-2", AGENTS, undefined, ALL)).toBeNull()
    expect(managerFor("notes", AGENTS, undefined, ALL)).toBeNull()
  })
})

describe("what the alert says", () => {
  test("a permission prompt names the command, the task, the last words and the picker commands with the call's key", () => {
    expect(
      alertText({
        detail: "rm -rf build",
        key: "0a1b2c3d",
        last: "Clearing the build.",
        name: "k3m9px-worker",
        reason: "permission",
        state: "stuck",
        task: "PG-1: fix it",
        tool: "Bash",
      }),
    ).toBe(
      'k3m9px-worker is stuck on a permission prompt (Bash):\nrm -rf build\nTask: PG-1: fix it. Its last message: "Clearing the build." Allow it if it is needed: playground picker k3m9px-worker allow 0a1b2c3d. Else deny it with a simpler shape: playground picker k3m9px-worker deny 0a1b2c3d "<the simpler shape>".',
    )
  })

  test("a call shows its command, file or URL alone only beside how it runs, else its whole input, and keys by what shows", () => {
    expect(callOf({ command: "ls", description: "List", timeout: 5000 })).toBe("ls")
    const unsandboxed = { command: "ls", dangerouslyDisableSandbox: true }
    expect(callOf(unsandboxed)).toBe(JSON.stringify(unsandboxed))
    expect(callKey(unsandboxed)).not.toBe(callKey({ command: "ls" }))
    const edit = { file_path: "/repo/a.ts", new_string: "b", old_string: "a" }
    expect(callOf(edit)).toBe(JSON.stringify(edit))
    expect(callOf({ channel: "C1", text: "hi" })).toBe('{"channel":"C1","text":"hi"}')
  })

  test("a command keeps its own punctuation, its trailing dot or question mark included", () => {
    const text = alertText({
      detail: "ls *.?",
      key: "0a1b2c3d",
      last: "",
      name: "k3m9px-worker",
      reason: "permission",
      state: "stuck",
      task: "",
      tool: "Bash",
    })
    expect(text.split("\n")[1]).toBe("ls *.?")
  })

  test("a failed turn and a quiet session read as such", () => {
    const base = { detail: "", last: "", name: "x-worker", task: "" }
    expect(alertText({ ...base, reason: "server_error", state: "failed" })).toBe(
      "x-worker stopped on an error (server_error). Resolve it; if you cannot, tell dispatcher.",
    )
    expect(alertText({ ...base, reason: "15 minutes", state: "quiet" })).toBe(
      "x-worker has made no tool call for 15 minutes. Resolve it; if you cannot, tell dispatcher.",
    )
  })

  test("the detail is the command whole, a picker's questions or a notice's words", () => {
    const heredoc = `cat <<'EOF' > notes.md\n${"a line of notes\n".repeat(30)}EOF\nrm -rf "$HOME/important"`
    expect(detailOf({ tool_input: { command: heredoc } })).toBe(heredoc)
    expect(detailOf({ tool_input: { command: "ls\n  -la" } })).toBe("ls\n  -la")
    expect(
      detailOf({ tool_input: { questions: [{ question: "Which one?" }, { question: "Why?" }] } }),
    ).toBe("Which one? / Why?")
    expect(detailOf({ message: "Claude needs your permission" })).toBe(
      "Claude needs your permission",
    )
    expect(detailOf({})).toBe("")
  })

  test("the last words are the newest assistant text in the transcript", () => {
    const lines = [
      { message: { content: [{ text: "First.", type: "text" }] }, type: "assistant" },
      { message: { content: [{ text: "Then this.", type: "text" }] }, type: "assistant" },
      { message: { content: [{ id: "t", input: {}, type: "tool_use" }] }, type: "assistant" },
      { message: { content: "ok" }, type: "user" },
    ]
    expect(lastWords(lines.map((line) => JSON.stringify(line)).join("\n"))).toBe("Then this.")
  })
})

describe("a session's transcript for its waiting calls", () => {
  const SESSION = "d9d2ef1a-a7b9-4ecb-a758-087576d79391"
  const config = mkdtempSync(join(tmpdir(), "stuck-alert-transcript-"))
  afterAll(() => rmSync(config, { force: true, recursive: true }))
  const project = join(config, "projects", "p")
  const subagents = join(project, SESSION, "subagents")
  mkdirSync(subagents, { recursive: true })
  const call = (id: string, command: string) =>
    `${JSON.stringify({ message: { content: [{ id, input: { command }, name: "Bash", type: "tool_use" }] }, type: "assistant" })}\n`
  writeFileSync(join(project, `${SESSION}.jsonl`), call("t1", "ls"))

  test("holds the main transcript's calls, and every subagent's, so two subagents prompting at once both show", async () => {
    writeFileSync(join(subagents, "agent-a1.jsonl"), call("s1", "rm -rf a"))
    writeFileSync(join(subagents, "agent-b2.jsonl"), call("s2", "rm -rf b"))
    const commands = pendingCalls(await transcriptOf(config, SESSION)).map((input) => input.command)
    expect(commands.toSorted()).toEqual(["ls", "rm -rf a", "rm -rf b"])
  })

  test("reads the 8 newest subagents alone", async () => {
    for (let i = 0; i < 10; i++) {
      const file = join(subagents, `agent-old${i}.jsonl`)
      writeFileSync(file, call(`o${i}`, `echo ${i}`))
      const when = new Date(Date.UTC(2026, 0, 1, 0, i))
      utimesSync(file, when, when)
    }
    const commands = pendingCalls(await transcriptOf(config, SESSION)).map((input) => input.command)
    expect(commands).toContain("rm -rf a")
    expect(commands).toContain("echo 9")
    expect(commands).not.toContain("echo 0")
  })

  test("is empty for a session with no transcript", async () => {
    expect(await transcriptOf(config, "00000000-0000-4000-8000-000000000000")).toBe("")
  })
})
