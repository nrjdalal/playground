import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { attachmentsDir } from "../../../../../../api/hono/src/lib/dashboard/attachments"
import {
  addFacts,
  costOf,
  emptyFacts,
  kindOf,
  parentOf,
  parseJson,
  splitLines,
  stripRaw,
  subagentMeta,
  TEXT_LIMIT,
  toEntry,
  transcriptFile,
  type SessionFacts,
} from "../../../../../../api/hono/src/lib/sessions/lines"

const AT = "2026-10-06T10:00:00.000Z"
const SESSION = "066211cb-e0d6-4df4-ace8-e01fb0fc40ac"
const LAUNCHER = "b71712b9-12e9-4c9f-8e74-2f8d41de2bf5"

const entryOf = (line: Record<string, unknown>, seq = 0) => {
  const entry = toEntry(line, seq)
  if (!entry) throw new Error("expected an entry")
  return entry
}

const fold = (lines: Record<string, unknown>[]): SessionFacts =>
  lines.reduce(addFacts, emptyFacts())

describe("splitLines", () => {
  test("each complete line comes with the byte offset it starts at, counted from the read's base", () => {
    const bytes = new TextEncoder().encode('{"a":"é"}\n{"b":2}\n')
    const { consumed, lines } = splitLines(bytes, 100)
    expect(consumed).toBe(bytes.length)
    expect(lines).toEqual([
      { seq: 100, text: '{"a":"é"}' },
      { seq: 111, text: '{"b":2}' },
    ])
  })

  test("a last line still being written waits for its newline, and blank lines are skipped", () => {
    const bytes = new TextEncoder().encode('{"a":1}\n\n{"b":')
    const { consumed, lines } = splitLines(bytes, 0)
    expect(consumed).toBe(9)
    expect(lines.map((line) => line.text)).toEqual(['{"a":1}'])
  })

  test("a read that ends inside a multi-byte character never splits it", () => {
    const bytes = new TextEncoder().encode('{"a":1}\n{"b":"日')
    const { consumed } = splitLines(bytes.subarray(0, bytes.length - 1), 0)
    expect(consumed).toBe(8)
  })
})

describe("parseJson", () => {
  test("an object parses, and anything else is null", () => {
    expect(parseJson('{"type":"user"}')).toEqual({ type: "user" })
    expect(parseJson("[1]")).toBeNull()
    expect(parseJson("{not json")).toBeNull()
  })
})

describe("toEntry", () => {
  test("a person's message is a human entry, with its time, parent and the line kept as raw", () => {
    const line = {
      type: "user",
      uuid: "h1",
      parentUuid: "p0",
      timestamp: AT,
      origin: { kind: "human" },
      message: { role: "user", content: "ship it" },
    }
    expect(toEntry(line, 42)).toEqual({
      at: new Date(AT),
      cacheCreationTokens: null,
      cacheReadTokens: null,
      inputTokens: null,
      kind: "human",
      messageId: null,
      model: null,
      outputTokens: null,
      parentUuid: "p0",
      raw: line,
      sender: null,
      seq: 42,
      text: "ship it",
      tool: null,
      toolUseId: null,
      type: "user",
      uuid: "h1",
    })
  })

  test("a peer session's message is a peer entry, named for its sender, with the body alone", () => {
    const entry = entryOf({
      type: "user",
      uuid: "p1",
      isMeta: true,
      origin: {
        kind: "peer",
        name: "dispatcher",
        from: "uds:/tmp/cc-socks/1.sock",
        body: "Start P1",
      },
      message: { role: "user", content: "Another Claude session sent a message:\nStart P1" },
    })
    expect(entry.kind).toBe("peer")
    expect(entry.sender).toBe("dispatcher")
    expect(entry.text).toBe("Start P1")
  })

  test("a message typed or sent mid-turn (a queued_command attachment) keeps who sent it", () => {
    const human = entryOf({
      type: "attachment",
      uuid: "q1",
      attachment: { type: "queued_command", prompt: "also check CI", origin: { kind: "human" } },
    })
    expect([human.kind, human.text]).toEqual(["human", "also check CI"])
    const peer = entryOf({
      type: "attachment",
      uuid: "q2",
      attachment: {
        type: "queued_command",
        prompt: "wrapped",
        origin: { kind: "peer", name: "dispatcher", body: "go" },
      },
    })
    expect([peer.kind, peer.sender, peer.text]).toEqual(["peer", "dispatcher", "go"])
  })

  test("a long paste is stored as its words, without Claude Code's tags", () => {
    const wrapped = '\n\n<pasted_content id="ab12">\nlong words\n</pasted_content id="ab12">\n'
    const typed = entryOf({
      type: "user",
      uuid: "w1",
      origin: { kind: "human" },
      message: { role: "user", content: wrapped },
    })
    const queued = entryOf({
      type: "attachment",
      uuid: "w2",
      attachment: { type: "queued_command", prompt: wrapped, origin: { kind: "human" } },
    })
    expect([typed.text, queued.text]).toEqual(["long words", "long words"])
  })

  test("a mid-turn message with a pasted image keeps its text", () => {
    const entry = entryOf({
      type: "attachment",
      uuid: "q3",
      attachment: {
        type: "queued_command",
        prompt: [
          { type: "text", text: "see this" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
        ],
        origin: { kind: "human" },
      },
    })
    expect([entry.kind, entry.text]).toEqual(["human", "see this"])
  })

  test("what a headless `claude -p` run was launched with is a prompt entry", () => {
    const entry = entryOf({
      type: "user",
      uuid: "l1",
      entrypoint: "sdk-cli",
      message: { role: "user", content: "/linear every bug in To do" },
    })
    expect([entry.kind, entry.text]).toEqual(["prompt", "/linear every bug in To do"])
  })

  test("a subagent's task, after its meta skill body, is a prompt entry", () => {
    const body = entryOf({
      type: "user",
      uuid: "k1",
      isMeta: true,
      isSidechain: true,
      message: { role: "user", content: "Base directory for this skill: /skills/linear-scan" },
    })
    const task = entryOf({
      type: "user",
      uuid: "k2",
      isSidechain: true,
      message: { role: "user", content: [{ type: "text", text: "Scan the board" }] },
    })
    expect([body.kind, task.kind, task.text]).toEqual(["meta", "prompt", "Scan the board"])
  })

  test("a slash command is a prompt entry, read back as the command it ran", () => {
    const entry = entryOf({
      type: "user",
      uuid: "sc",
      message: {
        role: "user",
        content:
          "<command-message>linear</command-message>\n<command-name>/linear</command-name>\n<command-args>QA</command-args>",
      },
    })
    expect([entry.kind, entry.text]).toEqual(["prompt", "/linear QA"])
  })

  test("a person's slash command is a human entry, read back as the command it ran", () => {
    const entry = entryOf({
      type: "user",
      uuid: "hc",
      origin: { kind: "human" },
      message: {
        role: "user",
        content:
          "<command-message>linear</command-message>\n<command-name>/linear</command-name>\n<command-args>QA</command-args>",
      },
    })
    expect([entry.kind, entry.text]).toEqual(["human", "/linear QA"])
  })

  test("a person's queued slash command is read back as the command it ran", () => {
    const entry = entryOf({
      type: "attachment",
      uuid: "qc",
      attachment: {
        type: "queued_command",
        prompt: "<command-name>/linear</command-name>\n<command-args>QA</command-args>",
        origin: { kind: "human" },
      },
    })
    expect([entry.kind, entry.text]).toEqual(["human", "/linear QA"])
  })

  test("a line holding only a command's message tag stays meta, never a prompt", () => {
    const entry = entryOf({
      type: "user",
      uuid: "mo",
      message: {
        role: "user",
        content: "<command-message>init is analyzing your codebase…</command-message>",
      },
    })
    expect(entry.kind).toBe("meta")
  })

  test("a command's arguments are kept whole, even holding a <", () => {
    const entry = entryOf({
      type: "user",
      uuid: "sa",
      message: {
        role: "user",
        content:
          "<command-name>/claim</command-name>\n<command-args>CEDAR-1109 if a < b</command-args>",
      },
    })
    expect(entry.text).toBe("/claim CEDAR-1109 if a < b")
  })

  test("a prompt that quotes a command tag partway through stays the whole prompt", () => {
    const content =
      "Review this transcript line:\n<command-name>/rename</command-name>\nand say what it does"
    const entry = entryOf({ type: "user", uuid: "qp", message: { role: "user", content } })
    expect([entry.kind, entry.text]).toEqual(["prompt", content])
  })

  test("an interrupt marker is meta, never a prompt", () => {
    for (const text of [
      "[Request interrupted by user]",
      "[Request interrupted by user for tool use]",
    ]) {
      const entry = entryOf({
        type: "user",
        uuid: "ir",
        message: { role: "user", content: [{ type: "text", text }] },
      })
      expect(entry.kind).toBe("meta")
    }
  })

  test("a command's output, shell input and a compaction summary are meta, not prompts", () => {
    for (const content of [
      "<local-command-caveat>Caveat: the messages below were generated by the user</local-command-caveat>",
      "<local-command-stdout>Renamed</local-command-stdout>",
      "<bash-input>git status</bash-input>",
    ]) {
      expect(entryOf({ type: "user", uuid: "c", message: { role: "user", content } }).kind).toBe(
        "meta",
      )
    }
    const summary = entryOf({
      type: "user",
      uuid: "cs",
      isCompactSummary: true,
      message: { role: "user", content: "This session is being continued from a previous one" },
    })
    expect(summary.kind).toBe("meta")
  })

  test("a message from the session that started a subagent is a peer entry", () => {
    const said = entryOf({
      type: "user",
      uuid: "co",
      isMeta: true,
      origin: { kind: "coordinator" },
      message: { role: "user", content: "The coordinator sent a message: the head moved" },
    })
    expect([said.kind, said.sender]).toEqual(["peer", null])
    const queued = entryOf({
      type: "attachment",
      uuid: "cq",
      attachment: { type: "queued_command", prompt: "head moved", origin: { kind: "coordinator" } },
    })
    expect([queued.kind, queued.text]).toEqual(["peer", "head moved"])
  })

  test("a skill body, a task notification or any other user line nobody typed is meta", () => {
    const entry = entryOf({
      type: "user",
      uuid: "m1",
      isMeta: true,
      origin: { kind: "task-notification" },
      message: { role: "user", content: [{ type: "text", text: "task done" }] },
    })
    expect([entry.kind, entry.text]).toEqual(["meta", "task done"])
  })

  test("an assistant line carries its message's usage so far, and only whole numbers count", () => {
    const entry = entryOf({
      type: "assistant",
      uuid: "a0",
      message: {
        id: "msg_0",
        content: [{ type: "text", text: "hi" }],
        usage: {
          input_tokens: 2,
          output_tokens: 435,
          cache_read_input_tokens: 942386,
          cache_creation_input_tokens: 1047,
        },
      },
    })
    expect(entry).toMatchObject({
      cacheCreationTokens: 1047,
      cacheReadTokens: 942386,
      inputTokens: 2,
      messageId: "msg_0",
      outputTokens: 435,
    })
    const odd = entryOf({
      type: "assistant",
      uuid: "a5",
      message: { id: "m", content: [{ type: "text", text: "x" }], usage: { input_tokens: 1.5 } },
    })
    expect(odd.inputTokens).toBeNull()
  })

  test("a tool call is a tool entry: its name, its id, a one-line summary and then its whole input", () => {
    const entry = entryOf({
      type: "assistant",
      uuid: "a1",
      message: {
        id: "msg_1",
        model: "claude-opus-5-5",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "git status", description: "Show status" },
          },
        ],
      },
    })
    expect(entry).toMatchObject({
      kind: "tool",
      messageId: "msg_1",
      model: "claude-opus-5-5",
      tool: "Bash",
      toolUseId: "toolu_1",
    })
    expect(entry.text).toBe('Show status\n{"command":"git status","description":"Show status"}')
  })

  test("a tool result is a result entry holding the output, keyed to the call it answers", () => {
    const entry = entryOf({
      type: "user",
      uuid: "r1",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "On branch canary" },
          {
            type: "tool_result",
            tool_use_id: "toolu_2",
            content: [{ type: "text", text: "second" }],
          },
        ],
      },
      toolUseResult: { stdout: "On branch canary", stderr: "" },
    })
    expect([entry.kind, entry.toolUseId, entry.text]).toEqual([
      "result",
      "toolu_1",
      "On branch canary\nsecond",
    ])
    expect(entry.raw).not.toHaveProperty("toolUseResult")
  })

  test("what the session said is an assistant entry; a redacted thinking line is meta with no text", () => {
    const said = entryOf({
      type: "assistant",
      uuid: "a2",
      message: { id: "msg_2", content: [{ type: "text", text: "Done." }] },
    })
    expect([said.kind, said.text]).toEqual(["assistant", "Done."])
    const thought = entryOf({
      type: "assistant",
      uuid: "a3",
      message: { id: "msg_2", content: [{ type: "thinking", thinking: "", signature: "opaque" }] },
    })
    expect([thought.kind, thought.text, thought.messageId]).toEqual(["meta", "", "msg_2"])
    expect(thought.raw).toEqual({
      type: "assistant",
      uuid: "a3",
      message: { id: "msg_2", content: [{ type: "thinking", thinking: "" }] },
    })
  })

  test("thinking that carries its text is a thinking entry, searchable by it", () => {
    const entry = entryOf({
      type: "assistant",
      uuid: "a4",
      message: {
        id: "msg_3",
        content: [{ type: "thinking", thinking: "Check the hub first", signature: "x" }],
      },
    })
    expect([entry.kind, entry.text]).toEqual(["thinking", "Check the hub first"])
  })

  test("a system line keeps its content, or its subtype when it has none", () => {
    expect(
      entryOf({ type: "system", uuid: "s1", subtype: "away_summary", content: "Built P1" }).text,
    ).toBe("Built P1")
    expect(entryOf({ type: "system", uuid: "s2", subtype: "turn_duration" }).text).toBe(
      "turn_duration",
    )
  })

  test("an attachment is searchable by what it carried, a hook by its output", () => {
    const hook = entryOf({
      type: "attachment",
      uuid: "t1",
      attachment: { type: "hook_success", stdout: "ok", stderr: "warn" },
    })
    expect([hook.kind, hook.text]).toEqual(["attachment", "ok\nwarn"])
    const texts = [
      { type: "hook_additional_context", content: ["keep going", "phase 2"] },
      {
        type: "file",
        content: { type: "text", file: { filePath: "/a.ts", content: "const a = 1" } },
      },
      {
        type: "hook_blocking_error",
        blockingError: { blockingError: "tests failed", command: "x" },
      },
    ].map((attachment) => entryOf({ type: "attachment", uuid: "t", attachment }).text)
    expect(texts).toEqual(["keep going\nphase 2", "const a = 1", "tests failed"])
  })

  test("a stop hook's summary keeps its errors and the context it added", () => {
    const entry = entryOf({
      type: "system",
      uuid: "sh",
      subtype: "stop_hook_summary",
      hookErrors: ["/captest is still running"],
      hookAdditionalContext: [],
      stopReason: "",
    })
    expect(entry.text).toBe("/captest is still running")
  })

  test("a line without a uuid is no entry", () => {
    expect(toEntry({ type: "agent-name", agentName: "worker-gluttony" }, 0)).toBeNull()
  })

  test("a line holding a NUL is stored with the NUL replaced, since Postgres refuses it", () => {
    const entry = entryOf({
      type: "user",
      uuid: "n1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t", content: "a\u0000b" }],
      },
    })
    expect(entry.text).toBe("a\uFFFDb")
    expect(JSON.stringify(entry.raw)).not.toContain("\\u0000")
  })

  test("a lone surrogate (half an emoji, as a cut can leave) is replaced, since Postgres refuses it", () => {
    const entry = entryOf({
      type: "user",
      uuid: "ls",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t", content: "a\uD83Db" }],
      },
    })
    expect(entry.text).toBe("a\uFFFDb")
    expect(JSON.stringify(entry.raw)).toContain("a\uFFFDb")
  })

  test("a huge output is cut at the text limit, while raw keeps it whole", () => {
    const output = "x".repeat(TEXT_LIMIT + 10)
    const entry = entryOf({
      type: "user",
      uuid: "b1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t", content: output }],
      },
    })
    expect(entry.text.length).toBe(TEXT_LIMIT)
    expect(JSON.stringify(entry.raw)).toContain(output)
  })
})

describe("stripRaw", () => {
  test("base64 media keeps its type and length but not its bytes, wherever it sits", () => {
    const raw = stripRaw({
      type: "user",
      message: {
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
          {
            type: "tool_result",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AA" } },
            ],
          },
        ],
      },
    })
    expect(JSON.stringify(raw)).toBe(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", omittedLength: 4 },
            },
            {
              type: "tool_result",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", omittedLength: 2 },
                },
              ],
            },
          ],
        },
      }),
    )
  })

  test("a redacted thinking block keeps its place but not its data", () => {
    expect(stripRaw({ content: [{ type: "redacted_thinking", data: "opaque" }] })).toEqual({
      content: [{ type: "redacted_thinking", omittedLength: 6 }],
    })
  })
})

describe("addFacts", () => {
  test("the last agent-name line names the session, so a /rename after `-n` wins", () => {
    const facts = fold([
      { type: "agent-name", agentName: "pride" },
      { type: "custom-title", customTitle: "pride" },
      { type: "agent-name", agentName: "worker-pride" },
    ])
    expect(facts.name).toBe("worker-pride")
  })

  test("the launch directory and entrypoint are the first seen; branch, version and model the latest", () => {
    const facts = fold([
      { type: "user", cwd: "/repo", entrypoint: "cli", gitBranch: "main", version: "2.1.288" },
      {
        type: "assistant",
        cwd: "/repo/.claude/worktrees/x",
        gitBranch: "feat/x",
        version: "2.1.289",
        message: { model: "claude-opus-5-5" },
      },
      { type: "assistant", message: { model: "<synthetic>" } },
    ])
    expect(facts).toMatchObject({
      cwd: "/repo",
      entrypoint: "cli",
      gitBranch: "feat/x",
      model: "claude-opus-5-5",
      version: "2.1.289",
    })
  })

  test("the cost is the highest total per startTime, and separate keys add up", () => {
    const facts = fold([
      { type: "cost-state", startTime: 1, totalCostUSD: 0.5 },
      { type: "cost-state", startTime: 1, totalCostUSD: 0.75 },
      { type: "cost-state", startTime: 2, totalCostUSD: 0.25 },
    ])
    expect(facts.costs).toEqual({ "1": 0.75, "2": 0.25 })
    expect(costOf(facts.costs)).toBe(1)
    expect(costOf(emptyFacts().costs)).toBeNull()
  })

  test("the task is the first thing a person, a peer or a launch prompt asked, cut to its first line", () => {
    const facts = fold([
      {
        type: "user",
        uuid: "m",
        isMeta: true,
        message: { content: "Base directory for this skill" },
      },
      {
        type: "user",
        uuid: "p",
        entrypoint: "sdk-cli",
        message: { content: "/claim DUNE-2045 dry run\nmore" },
      },
      { type: "user", uuid: "h", origin: { kind: "human" }, message: { content: "later ask" } },
    ])
    expect(facts.task).toBe("/claim DUNE-2045 dry run")
    expect(fold([{ type: "agent-name", agentName: "x" }]).task).toBeNull()
  })

  test("a session a person started with a slash command has the command as its task", () => {
    const facts = fold([
      {
        type: "user",
        uuid: "c",
        origin: { kind: "human" },
        message: {
          content:
            "<command-message>linear</command-message>\n<command-name>/linear</command-name>",
        },
      },
      {
        type: "user",
        uuid: "m",
        isMeta: true,
        message: { content: "Base directory for this skill: /x/skills/linear" },
      },
    ])
    expect(facts.task).toBe("/linear")
  })

  test("a person's message of files alone sets no task, and one with words is asked by its words", () => {
    const sent = (uuid: string, text: string) => ({
      type: "user",
      uuid,
      origin: { kind: "human" },
      message: { content: text },
    })
    const path = join(attachmentsDir(), "11111111-2222-4333-8444-555555555555.png")
    expect(fold([sent("a", `Attached: ${path}`), sent("b", "what is this?")]).task).toBe(
      "what is this?",
    )
    expect(fold([sent("c", `look\n\nAttached: ${path}`)]).task).toBe("look")
    expect(fold([sent("d", `Attached: ${path}\n`), sent("e", "and now?")]).task).toBe("and now?")
  })

  test("a long paste is asked by its first line of words, not Claude Code's tag", () => {
    const content =
      '\n\n<pasted_content id="ab12">\nfirst line\nsecond\n</pasted_content id="ab12">\n'
    const line = { type: "user", uuid: "p", origin: { kind: "human" }, message: { content } }
    expect(fold([line]).task).toBe("first line")
  })

  test("a subagent forked from a skill, with no prompt of its own, has the skill as its task", () => {
    const facts = fold([
      {
        type: "user",
        uuid: "sk",
        isMeta: true,
        message: {
          content: "Base directory for this skill: /skills/playground/linear-scan\n\n# Scan",
        },
      },
      {
        type: "user",
        uuid: "r",
        message: { content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
      },
    ])
    expect(facts.task).toBe("/linear-scan")
  })

  test("each PR is listed once, and the AI title and fork parent are kept", () => {
    const facts = fold([
      { type: "pr-link", prUrl: "https://github.com/acme/archive/pull/27" },
      { type: "pr-link", prUrl: "https://github.com/acme/archive/pull/27" },
      { type: "ai-title", aiTitle: "Start review bot" },
      { type: "fork-context-ref", parentSessionId: LAUNCHER },
    ])
    expect(facts.prUrls).toEqual(["https://github.com/acme/archive/pull/27"])
    expect(facts.aiTitle).toBe("Start review bot")
    expect(facts.forkParent).toBe(LAUNCHER)
  })
})

describe("transcriptFile, kindOf and parentOf", () => {
  const projects = "/home/me/.claude/projects"

  test("a top-level transcript is a session; a subagents/agent-<id> file is a subagent of the directory it sits in", () => {
    expect(transcriptFile(projects, join(projects, "-repo", `${SESSION}.jsonl`))).toEqual({
      id: SESSION,
      parentId: null,
      projectDir: "-repo",
      subagent: false,
    })
    expect(
      transcriptFile(
        projects,
        join(projects, "-repo", SESSION, "subagents", "agent-a285d23191423e9db.jsonl"),
      ),
    ).toEqual({ id: "a285d23191423e9db", parentId: SESSION, projectDir: "-repo", subagent: true })
  })

  test("anything else under projects, or outside it, is not a transcript", () => {
    expect(
      transcriptFile(projects, join(projects, "-repo", SESSION, "tool-results", "b1.txt")),
    ).toBeNull()
    expect(
      transcriptFile(projects, join(projects, "-repo", SESSION, "subagents", "agent-a1.meta.json")),
    ).toBeNull()
    expect(transcriptFile(projects, "/elsewhere/x.jsonl")).toBeNull()
  })

  test("the entrypoint tells an interactive session from a headless `-p` run; a fork-context-ref marks a fork", () => {
    const main = { id: SESSION, parentId: null, projectDir: "-repo", subagent: false }
    const sub = { id: "a1", parentId: SESSION, projectDir: "-repo", subagent: true }
    expect(kindOf(main, fold([{ entrypoint: "cli" }]))).toBe("interactive")
    expect(kindOf(main, fold([{ entrypoint: "sdk-cli" }]))).toBe("headless")
    expect(kindOf(main, emptyFacts())).toBeNull()
    expect(kindOf(sub, emptyFacts())).toBe("subagent")
    expect(kindOf(sub, fold([{ type: "fork-context-ref", parentSessionId: SESSION }]))).toBe("fork")
  })

  test("a subagent's meta file marks a fork and names the subagent that started a nested one", () => {
    const sub = { id: "a2", parentId: SESSION, projectDir: "-repo", subagent: true }
    const meta = subagentMeta({ agentType: "general-purpose", isFork: true, parentAgentId: "a1" })
    expect(kindOf(sub, emptyFacts(), meta)).toBe("fork")
    expect(parentOf(sub, emptyFacts(), meta)).toBe("a1")
    expect(parentOf(sub, emptyFacts(), subagentMeta({ agentType: "Explore" }))).toBe(SESSION)
  })

  test("a session launched inside another session's scratchpad is that session's child, never its own", () => {
    const file = { id: SESSION, parentId: null, projectDir: "-tmp", subagent: false }
    const cwd = `/private/tmp/claude-501/-Users-me-repo/${LAUNCHER}/scratchpad/review-pr9/probe`
    expect(parentOf(file, fold([{ cwd }]))).toBe(LAUNCHER)
    expect(parentOf({ ...file, id: LAUNCHER }, fold([{ cwd }]))).toBeNull()
    expect(parentOf(file, fold([{ cwd: "/Users/me/repo" }]))).toBeNull()
    expect(parentOf({ ...file, parentId: "p", subagent: true }, fold([{ cwd }]))).toBe("p")
  })

  test("a subagent's meta file gives its agent type and description", () => {
    expect(subagentMeta({ agentType: "Explore", description: "Find the hub" })).toEqual({
      agentType: "Explore",
      description: "Find the hub",
      isFork: false,
      parentAgentId: null,
    })
    expect(subagentMeta(null)).toEqual({
      agentType: null,
      description: null,
      isFork: false,
      parentAgentId: null,
    })
  })
})
