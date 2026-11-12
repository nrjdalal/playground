import { describe, expect, jest, test } from "bun:test"

import type { Entry } from "../../../../../api/hono/src/lib/dashboard/transcript"
import {
  applyOutbox,
  attachmentsOf,
  DashboardChats,
  firstLineOf,
  keepTurnIds,
  outboxMessage,
  outboxOf,
  refreshingReplies,
  subagentRunning,
  toUIMessages,
  transcriptFor,
  withTranscript,
  type DashboardMessage,
  type DashboardToolPart,
} from "../../../../../web/next/src/lib/chat"
import { historyOf, withOlder, withSteps } from "../../../../../web/next/src/lib/dashboard"
import { UNSENT_MARKER, type OutboxMessage } from "../../../../../web/next/src/lib/outbox"
import { READ_ONLY_LINE } from "../../../../../web/next/src/lib/relay"

const step = (fields: Partial<Entry> & Pick<Entry, "id" | "kind">): Entry => ({
  at: "2026-10-06T10:00:00.000Z",
  from: null,
  text: "",
  tool: null,
  ...fields,
})

const PNG = "11111111-2222-4333-8444-555555555555.png"

describe("toUIMessages", () => {
  test("a person's message is a user message of its words and its files, as file parts", () => {
    const [message] = toUIMessages([
      step({ attachments: [{ id: PNG, kind: "image" }], id: "h1", kind: "human", text: "look" }),
    ])
    expect(message?.role).toBe("user")
    expect(message?.metadata).toEqual({ at: "2026-10-06T10:00:00.000Z", from: null, kind: "human" })
    expect(message?.parts[0]).toEqual({ text: "look", type: "text" })
    expect(message?.parts[1]).toMatchObject({ filename: PNG, mediaType: "image/png", type: "file" })
    expect(message && attachmentsOf(message)).toEqual([{ id: PNG, kind: "image" }])
  })

  test("a file the API would not name gets no part, so the page never points at it", () => {
    const [message] = toUIMessages([
      step({
        attachments: [{ id: "../etc/passwd", kind: "text" }],
        id: "h1",
        kind: "human",
        text: "x",
      }),
    ])
    expect(message?.parts).toEqual([{ text: "x", type: "text" }])
  })

  test("the Undo marker is no message of its own: it marks his message before it unsent, past the reply between", () => {
    const messages = toUIMessages([
      step({ id: "h1", kind: "human", text: "first" }),
      step({ id: "h2", kind: "human", text: "delete the branch" }),
      step({ id: "a1", kind: "assistant", text: "on it" }),
      step({ id: "u1", kind: "human", text: UNSENT_MARKER }),
      step({ id: "a2", kind: "assistant", text: "stopped" }),
    ])
    expect(messages.map((m) => [m.id, m.metadata?.unsent ?? false])).toEqual([
      ["h1", false],
      ["h2", true],
      ["a1", false],
      ["a2", false],
    ])
  })

  test("only the exact marker line marks: a lookalike, one with files or a peer's stays a message", () => {
    const lookalikes = [
      step({ id: "u1", kind: "human", text: `${UNSENT_MARKER} Also stop the build.` }),
      step({ id: "u2", kind: "human", text: UNSENT_MARKER.replace("The user", "Someone") }),
      step({
        attachments: [{ id: PNG, kind: "image" }],
        id: "u3",
        kind: "human",
        text: UNSENT_MARKER,
      }),
      step({ from: "builder", id: "u4", kind: "peer", text: UNSENT_MARKER }),
    ]
    for (const marker of lookalikes) {
      const messages = toUIMessages([step({ id: "h1", kind: "human", text: "hi" }), marker])
      expect(messages.map((m) => [m.id, m.metadata?.unsent ?? false])).toEqual([
        ["h1", false],
        [marker.id, false],
      ])
    }
  })

  test("a peer's message keeps its sender and its whole text, which its folded row opens to", () => {
    const text = "PR #12 merged.\n\n- the sha is abc123\n- next is #13"
    const [message] = toUIMessages([step({ from: "builder", id: "p1", kind: "peer", text })])
    expect(message?.metadata).toMatchObject({ from: "builder", kind: "peer" })
    expect(message?.role).toBe("user")
    expect(message?.parts).toEqual([{ text, type: "text" }])
  })

  // A folded row shows a message's first line, its first line with words, its thread marker aside.
  test("firstLineOf: the first line holding words, trimmed, a leading thread marker dropped", () => {
    expect(firstLineOf("PR #12 merged.\n\n- the sha is abc123")).toBe("PR #12 merged.")
    expect(firstLineOf("\n\n   \n  Done, see below  \nmore")).toBe("Done, see below")
    expect(firstLineOf("[thread:k7mq] the plan is ready\nnext")).toBe("the plan is ready")
    expect(firstLineOf("   ")).toBe("")
  })

  test("a session's turn is one assistant message, its thinking, words and calls in order, named for its first step", () => {
    const messages = toUIMessages([
      step({ id: "h1", kind: "human", text: "check" }),
      step({ id: "a1:0", kind: "reasoning", text: "Weighing it." }),
      step({ id: "a1:1", kind: "assistant", text: "Checking." }),
      step({
        id: "a2:0",
        input: '{"command":"ls"}',
        kind: "tool",
        text: "List files",
        tool: "Bash",
        toolUseId: "t1",
      }),
      step({ id: "r1:0", kind: "result", text: "a.txt", toolUseId: "t1" }),
      step({ id: "a3:0", kind: "assistant", text: "Done." }),
      step({ id: "h2", kind: "human", text: "thanks" }),
      step({ id: "a4:0", kind: "assistant", text: "Welcome." }),
    ])
    expect(messages.map((m) => [m.id, m.role])).toEqual([
      ["h1", "user"],
      ["a1:0", "assistant"],
      ["h2", "user"],
      ["a4:0", "assistant"],
    ])
    expect(messages[1]?.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "text",
      "dynamic-tool",
      "text",
    ])
    expect(messages[1]?.parts[2]).toEqual({
      input: { json: '{"command":"ls"}', summary: "List files" },
      output: { agentId: null, text: "a.txt" },
      state: "output-available",
      title: "Bash",
      toolCallId: "t1",
      toolName: "Bash",
      type: "dynamic-tool",
    })
  })

  test("a turn whose newest step ended it reads ended, and a step after that (a stop hook's carry-on) reads it as going again", () => {
    const ended = toUIMessages([
      step({ id: "h1", kind: "human", text: "go" }),
      step({ id: "a1:0", kind: "assistant", text: "Working." }),
      step({ endsTurn: true, id: "a2:0", kind: "assistant", text: "Done." }),
    ])
    expect(ended.at(-1)?.metadata?.ended).toBe(true)
    const going = toUIMessages([
      step({ id: "h1", kind: "human", text: "go" }),
      step({ endsTurn: true, id: "a2:0", kind: "assistant", text: "Done." }),
      step({ id: "a3:0", kind: "assistant", text: "One more thing." }),
    ])
    expect(going.at(-1)?.metadata?.ended).toBeUndefined()
  })

  test("a call with no result yet is running; a failed one carries its error; an Agent's result names its subagent", () => {
    const [turn] = toUIMessages([
      step({ id: "a1:0", kind: "tool", text: "ls", tool: "Bash", toolUseId: "t1" }),
      step({ id: "a1:1", kind: "tool", text: "rm", tool: "Bash", toolUseId: "t2" }),
      step({ id: "a1:2", kind: "tool", text: "Review", tool: "Agent", toolUseId: "t3" }),
      step({ id: "r1:0", isError: true, kind: "result", text: "denied", toolUseId: "t2" }),
      step({ agentId: "a9f", id: "r2:0", kind: "result", text: "Report", toolUseId: "t3" }),
    ])
    expect(turn?.parts.map((part) => (part.type === "dynamic-tool" ? part.state : null))).toEqual([
      "input-available",
      "output-error",
      "output-available",
    ])
    expect(turn?.parts[1]).toMatchObject({ errorText: "denied" })
    expect(turn?.parts[2]).toMatchObject({ output: { agentId: "a9f", text: "Report" } })
  })

  test("a result whose call is not loaded is left out", () => {
    expect(
      toUIMessages([step({ id: "r1:0", kind: "result", text: "x", toolUseId: "gone" })]),
    ).toEqual([])
  })

  test("a subagent runs until its result, or in the background while the session lists it running", () => {
    const [turn] = toUIMessages([
      step({ id: "a1:0", kind: "tool", text: "Review", tool: "Agent", toolUseId: "t1" }),
      step({ id: "a1:1", kind: "tool", text: "Scan", tool: "Agent", toolUseId: "t2" }),
      step({ agentId: "a9f", id: "r1:0", kind: "result", text: "launched", toolUseId: "t2" }),
    ])
    const [foreground, background] = (turn?.parts ?? []) as DashboardToolPart[]
    expect(foreground && subagentRunning(foreground, [])).toBe(true)
    expect(background && subagentRunning(background, [])).toBe(false)
    expect(background && subagentRunning(background, [{ id: "t2", state: "running" }])).toBe(true)
    expect(background && subagentRunning(background, [{ id: "t2", state: "done" }])).toBe(false)
  })
})

const record = (fields: Partial<OutboxMessage> & Pick<OutboxMessage, "id">): OutboxMessage => ({
  at: "2026-10-06T10:00:00.000Z",
  attachments: [],
  attempts: 0,
  code: null,
  deliveredAt: null,
  entryId: null,
  reason: null,
  retryAt: null,
  sawPicker: false,
  sessionId: null,
  state: "queued",
  text: "hi",
  to: "dispatcher",
  typedAt: null,
  unanswered: false,
  unreached: 0,
  ...fields,
})

describe("a turn's name", () => {
  const at = (i: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, 0) + i * 1000).toISOString()
  const prompt = (i: number) => step({ at: at(i), id: `h${i}`, kind: "human", text: "go" })
  const tool = (i: number) => step({ at: at(i), id: `t${i}`, kind: "tool", tool: "Bash" })
  // the transcript as the stream shows it: the session's steps through the chat, each change carried over the last
  const shown = (previous: DashboardMessage[], list: Entry[]) =>
    withTranscript(previous, toUIMessages(list))
  const turnOf = (messages: DashboardMessage[]) => messages.find((m) => m.role === "assistant")

  test("each step of a turn is named for its own entry, in its part's place", () => {
    const messages = toUIMessages([prompt(0), tool(1), tool(2)])
    expect(messages[1]?.metadata?.steps).toEqual(["t1", "t2"])
  })

  test("a turn streamed past the 400-step window one step at a time keeps one name, and each step it keeps keeps its own", () => {
    let history = withSteps(historyOf("s"), [prompt(0)])
    let messages: DashboardMessage[] = []
    const names = new Set<string>()
    for (let i = 1; i <= 600; i++) {
      history = withSteps(history, [tool(i)])
      const before = turnOf(messages)?.metadata?.steps ?? []
      messages = shown(messages, history.list)
      const turn = turnOf(messages)
      names.add(turn?.id ?? "")
      expect(before.filter((id) => turn?.metadata?.steps?.includes(id))).toEqual(
        before.slice(before.length === 400 ? 1 : 0),
      )
    }
    expect([...names]).toEqual(["t1"])
  })

  // A stream row draws again only when its message object changes (sameStep), so a frame that grows one turn hands every other message back as the object it was; the dashboard tab's CPU once grew with the stream because each frame rebuilt them all.
  test("a step that grows one turn keeps every other message's object", () => {
    const first = shown([], [prompt(0), tool(1), prompt(2), tool(3)])
    const next = shown(first, [prompt(0), tool(1), prompt(2), tool(3), tool(4)])
    expect(next.map((m, i) => m === first[i])).toEqual([true, true, true, false])
    expect(next[3]?.metadata?.steps).toEqual(["t3", "t4"])
  })

  test("a result that answers a call changes that turn's object and no other", () => {
    const first = shown([], [prompt(0), tool(1), prompt(2), tool(3)])
    const next = shown(first, [
      prompt(0),
      tool(1),
      prompt(2),
      tool(3),
      step({ at: at(4), id: "r3", kind: "result", text: "done", toolUseId: "t3" }),
    ])
    expect(next.map((m, i) => m === first[i])).toEqual([true, true, true, false])
  })

  test("a turn opened with its prompt out of the window keeps its name when Load older brings the prompt in", () => {
    const all = [prompt(0), ...Array.from({ length: 450 }, (_, i) => tool(i + 1))]
    let history = withSteps(historyOf("s"), all.slice(-400))
    const opened = shown([], history.list)
    history = withOlder({ ...history, older: "loading", request: 1 }, 1, {
      before: null,
      entries: all.slice(0, 51),
      hasMore: false,
      kind: "page",
    })
    const loaded = shown(opened, history.list)
    expect(loaded.map((m) => m.id)).toEqual(["h0", turnOf(opened)?.id ?? ""])
  })

  test("keepTurnIds never takes a name another turn has of its own", () => {
    const tool = (id: string, i: number) => step({ at: at(i), id, kind: "tool", tool: "Bash" })
    const shownAt = toUIMessages([prompt(0), tool("a", 10), tool("b", 11)])
    // a step with an earlier time joins the turn, which keeps its name, then a peer message lands inside it
    const joined = keepTurnIds(
      shownAt,
      toUIMessages([prompt(0), tool("z", 5), tool("a", 10), tool("b", 11)]),
    )
    const split = keepTurnIds(
      joined,
      toUIMessages([
        prompt(0),
        tool("z", 5),
        step({ at: at(7), from: "builder", id: "p", kind: "peer", text: "hi" }),
        tool("a", 10),
        tool("b", 11),
      ]),
    )
    expect(joined.map((m) => m.id)).toEqual(["h0", "a"])
    expect(split.map((m) => m.id)).toEqual(["h0", "z", "p", "a"])
  })

  test("keepTurnIds keeps a name once, so two turns never share one", () => {
    const previous = toUIMessages([prompt(0), tool(1), tool(2)])
    const split = toUIMessages([prompt(0), tool(1), prompt(2), tool(3)])
    const next = toUIMessages([prompt(0), tool(1), prompt(2), tool(2)])
    expect(keepTurnIds(previous, split).map((m) => m.id)).toEqual(["h0", "t1", "h2", "t3"])
    expect(keepTurnIds(previous, next).map((m) => m.id)).toEqual(["h0", "t1", "h2", "t2"])
  })
})

describe("the outbox in a chat's messages", () => {
  const transcript = toUIMessages([step({ id: "h1", kind: "human", text: "earlier" })])

  test("a move rewrites its record in place and leaves the transcript alone", () => {
    const messages: DashboardMessage[] = [...transcript, outboxMessage(record({ id: "m1" }))]
    const next = applyOutbox(messages, { id: "m1", type: "sending" })
    expect(next[0]).toBe(messages[0] as DashboardMessage)
    expect(outboxOf(next)).toEqual([record({ attempts: 1, id: "m1", state: "sending" })])
  })

  test("a stale move changes nothing, and a cancel drops the message", () => {
    const messages = [outboxMessage(record({ id: "m1", state: "sending" }))]
    expect(applyOutbox(messages, { id: "m1", type: "cancel" })).toBe(messages)
    const queued = [outboxMessage(record({ id: "m2" }))]
    expect(applyOutbox(queued, { id: "m2", type: "cancel" })).toEqual([])
  })

  test("a new transcript replaces the old and keeps the outbox's messages after it, in order", () => {
    const messages = [
      ...transcript,
      outboxMessage(record({ id: "m1" })),
      outboxMessage(record({ id: "m2" })),
    ]
    const fresh = toUIMessages([step({ id: "h9", kind: "human", text: "new" })])
    expect(withTranscript(messages, fresh).map((m) => m.id)).toEqual(["h9", "m1", "m2"])
  })
})

type Reply = Awaited<
  ReturnType<NonNullable<ConstructorParameters<typeof DashboardChats>[0]["send"]>>
>

// A send the test answers by hand, one request at a time, in the order they were made.
function fakeSend() {
  const calls: {
    newThread?: boolean
    resolve: (reply: Reply) => void
    text: string
    threadId?: string
  }[] = []
  const send = (
    _to: string,
    text: string,
    _files: string[],
    _id: string,
    { newThread, threadId }: { newThread?: boolean; threadId?: string } = {},
  ) => new Promise<Reply>((resolve) => calls.push({ newThread, resolve, text, threadId }))
  return { calls, send: send as never }
}

const typed = { data: { at: "2026-10-06T10:00:05.000Z", sessionId: "s1" }, error: null } as Reply
const refused = (code: string, extra: Record<string, unknown> = {}) =>
  ({ data: null, error: { code, message: `${code} message`, ...extra } }) as unknown as Reply

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// Runs every pending promise step while the clock is faked, which a timer of 0 cannot.
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

describe("DashboardChats", () => {
  test("a session's messages go one at a time, in the order they were written, and settle as typed", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "one" })
    chats.post("dispatcher", { attachments: [], text: "two" })
    await settle()
    expect(calls.map((c) => c.text)).toEqual(["one"])
    expect(chats.outbox().map((m) => m.state)).toEqual(["sending", "queued"])
    calls[0]?.resolve(typed)
    await settle()
    expect(calls.map((c) => c.text)).toEqual(["one", "two"])
    expect(chats.outbox().map((m) => m.state)).toEqual(["typed", "sending"])
    calls[1]?.resolve(typed)
    await settle()
    expect(chats.outbox().map((m) => [m.state, m.sessionId])).toEqual([
      ["typed", "s1"],
      ["typed", "s1"],
    ])
  })

  test("a message sent from a thread's view carries its thread to the API, on a retry too, one from the full chat carries none, and one sent with New thread carries newThread", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "in the thread", threadId: "k7mq" })
    await settle()
    calls[0]?.resolve(refused("COMMAND"))
    await settle()
    const [failed] = chats.outbox()
    chats.retry("dispatcher", failed?.id ?? "")
    await settle()
    calls[1]?.resolve(typed)
    await settle()
    chats.post("dispatcher", { attachments: [], text: "in the chat" })
    await settle()
    calls[2]?.resolve(typed)
    await settle()
    chats.post("dispatcher", { attachments: [], newThread: true, text: "a new thread" })
    await settle()
    expect(calls.map((c) => [c.text, c.threadId, c.newThread])).toEqual([
      ["in the thread", "k7mq", undefined],
      ["in the thread", "k7mq", undefined],
      ["in the chat", undefined, undefined],
      ["a new thread", undefined, true],
    ])
  })

  test("each message is a user message in its session's chat, with its record as metadata", () => {
    const { send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "hello" })
    const [message] = chats.chat("dispatcher").messages
    expect(message?.role).toBe("user")
    expect(message?.parts).toEqual([{ text: "hello", type: "text" }])
    expect(message?.metadata?.outbox?.text).toBe("hello")
  })

  test("a picker holds a message until it is seen answered, then it goes at once", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "wait" })
    await settle()
    calls[0]?.resolve(refused("CONFLICT", { delivery: "ON_PICKER" }))
    await settle()
    const [held] = chats.outbox()
    expect([held?.state, held?.code, held?.reason]).toEqual([
      "queued",
      "ON_PICKER",
      "dispatcher is on a prompt",
    ])
    chats.dispatch("dispatcher", { id: held?.id ?? "", type: "saw" })
    chats.dispatch("dispatcher", { id: held?.id ?? "", type: "release" })
    await settle()
    expect(calls).toHaveLength(2)
  })

  test("a refusal for what the message says fails it; Retry sends it again in its place", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "/clear" })
    await settle()
    calls[0]?.resolve(refused("COMMAND"))
    await settle()
    const [failed] = chats.outbox()
    expect([failed?.state, failed?.reason]).toEqual(["failed", "COMMAND message"])
    chats.retry("dispatcher", failed?.id ?? "")
    await settle()
    expect(calls).toHaveLength(2)
    expect(chats.outbox()[0]?.state).toBe("sending")
  })

  test("the page's last send to a session stays its last, whatever then leaves the outbox; an Undo's marker is no send", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    expect(chats.lastPosted("dispatcher")).toBeNull()
    chats.post("dispatcher", { attachments: [], text: "a" })
    chats.post("dispatcher", { attachments: [], text: "b" })
    const [, b] = chats.outbox()
    chats.post("dispatcher", { attachments: [], text: UNSENT_MARKER })
    expect(chats.lastPosted("dispatcher")).toBe(b?.at ?? "")
    await settle()
    calls[0]?.resolve(typed)
    await settle()
    calls[1]?.resolve(typed)
    await settle()
    chats.dispatch("dispatcher", { id: b?.id ?? "", type: "dismiss" })
    expect(chats.lastPosted("dispatcher")).toBe(b?.at ?? "")
    expect(chats.lastPosted("builder")).toBeNull()
  })

  test("Discard drops a failed message from its session's chat and the outbox, and sends nothing", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "/clear" })
    await settle()
    calls[0]?.resolve(refused("COMMAND"))
    await settle()
    const [failed] = chats.outbox()
    expect(failed?.state).toBe("failed")
    chats.discard("dispatcher", failed?.id ?? "")
    await settle()
    expect(chats.outbox()).toEqual([])
    expect(chats.chat("dispatcher").messages).toEqual([])
    expect(calls).toHaveLength(1)
  })

  test("a cancelled message never goes, and the one behind it does", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "one" })
    chats.post("dispatcher", { attachments: [], text: "two" })
    chats.post("dispatcher", { attachments: [], text: "three" })
    await settle()
    const second = chats.outbox()[1]
    chats.dispatch("dispatcher", { id: second?.id ?? "", type: "cancel" })
    calls[0]?.resolve(typed)
    await settle()
    expect(calls.map((c) => c.text)).toEqual(["one", "three"])
  })

  test("the API's own failure fails with its fate unknown, and nothing behind it waits on it", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, send })
    chats.post("dispatcher", { attachments: [], text: "one" })
    chats.post("dispatcher", { attachments: [], text: "two" })
    await settle()
    calls[0]?.resolve(refused("INTERNAL_SERVER_ERROR"))
    await settle()
    expect(chats.outbox().map((m) => m.state)).toEqual(["failed", "sending"])
    expect(chats.outbox()[0]?.reason).toContain("reads Delivered once its transcript shows it")
  })

  // A dashboard restart restarts next dev too, and the page reloads when its dev socket reaches the new server: what was unsent goes again from the tab's storage, under the same id.
  test("a message unsent when the page reloads is sent again under its id, and the page's first paint does not wipe it", async () => {
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
    const before = fakeSend()
    const page = new DashboardChats({ label: (name) => name, send: before.send, storage })
    page.resume()
    page.post("dispatcher", { attachments: [], text: "during the roll" })
    await settle()
    before.calls[0]?.resolve(refused("NETWORK_ERROR"))
    await settle()
    const [waiting] = page.outbox()
    expect(waiting?.state).toBe("queued")

    const ids: string[] = []
    const after = new DashboardChats({
      label: (name) => name,
      send: (async (_to: string, _text: string, _files: string[], id: string) => {
        ids.push(id)
        return typed
      }) as never,
      storage,
    })
    after.setTranscript("dispatcher", [])
    after.resume()
    await settle()
    expect(ids).toEqual([waiting?.id])
    expect(after.outbox().map((m) => [m.id, m.state, m.unreached])).toEqual([
      [waiting?.id, "typed", 1],
    ])
    expect(JSON.parse(kept.get("outbox") ?? "null")).toEqual([])
  })

  test("an Undo still waiting when the page reloads is not kept, since nothing after the reload shows it or can unsend it", async () => {
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
    const { calls, send } = fakeSend()
    const page = new DashboardChats({ label: (name) => name, send, storage })
    page.resume()
    page.post("dispatcher", { attachments: [], text: "on a picker" })
    page.post("dispatcher", { attachments: [], text: UNSENT_MARKER })
    await settle()
    calls[0]?.resolve(refused("CONFLICT", { delivery: "ON_PICKER" }))
    await settle()
    expect(page.outbox().map((m) => [m.text, m.state])).toEqual([
      ["on a picker", "queued"],
      [UNSENT_MARKER, "queued"],
    ])
    expect((JSON.parse(kept.get("outbox") ?? "[]") as OutboxMessage[]).map((m) => m.text)).toEqual([
      "on a picker",
    ])
  })

  // The dashboard restarting: its first try typed the message and the answer was lost, then the API is down for 60s; every try carries the message's id, so the API that comes back answers it delivered without typing it again.
  test("a message sent while the API is down for 60s waits queued and is delivered once when it returns", async () => {
    jest.useFakeTimers()
    try {
      const start = Date.now()
      const ids: string[] = []
      const recorded = new Set<string>()
      let typings = 0
      const send = (async (_to: string, _text: string, _files: string[], id: string) => {
        ids.push(id)
        const elapsed = Date.now() - start
        if (elapsed === 0) {
          recorded.add(id)
          typings += 1
          return refused("NETWORK_ERROR")
        }
        if (elapsed < 60_000) return refused("NETWORK_ERROR")
        if (!recorded.has(id)) {
          recorded.add(id)
          typings += 1
        }
        return typed
      }) as never
      const chats = new DashboardChats({ label: (name) => name, send })
      chats.post("dispatcher", { attachments: [], text: "during the restart" })
      const seen = new Set<string>()
      for (let second = 0; second <= 120; second++) {
        await flush()
        const [message] = chats.outbox()
        seen.add(message?.state === "queued" ? `queued: ${message.reason}` : `${message?.state}`)
        if (message?.state === "typed") break
        jest.advanceTimersByTime(1000)
      }
      expect(chats.outbox().map((m) => m.state)).toEqual(["typed"])
      expect(typings).toBe(1)
      expect(new Set(ids).size).toBe(1)
      expect(ids.length).toBeGreaterThan(2)
      expect([...seen]).not.toContain("failed")
      expect(seen).toContain("queued: the server did not answer")
    } finally {
      jest.useRealTimers()
    }
  })

  // Claude Code held it, then the dashboard restarted and forgot that: every try after the first carries when it was first held, through the restart's unanswered tries, so the API that comes back reads it again rather than typing it twice
  test("a held message's tries carry when it was first held, through an API restart", async () => {
    jest.useFakeTimers()
    try {
      const start = Date.now()
      const held: (string | undefined)[] = []
      const send = (async (
        _to: string,
        _text: string,
        _files: string[],
        _id: string,
        { queuedAt }: { queuedAt?: string } = {},
      ) => {
        held.push(queuedAt)
        const elapsed = Date.now() - start
        if (elapsed < 10_000) return refused("CONFLICT", { delivery: "QUEUED" })
        if (elapsed < 40_000) return refused("NETWORK_ERROR")
        return typed
      }) as never
      const chats = new DashboardChats({ label: (name) => name, send })
      chats.post("dispatcher", { attachments: [], text: "while it compacts" })
      for (let second = 0; second <= 120; second++) {
        await flush()
        if (chats.outbox()[0]?.state === "typed") break
        jest.advanceTimersByTime(1000)
      }
      expect(chats.outbox().map((m) => m.state)).toEqual(["typed"])
      const first = new Date(start).toISOString()
      expect(held[0]).toBeUndefined()
      expect(held.slice(1)).toEqual(held.slice(1).map(() => first))
      expect(held.length).toBeGreaterThan(3)
    } finally {
      jest.useRealTimers()
    }
  })

  // the API times the hold from the paste, which a queued_command's stamp follows, rather than from when this tab read the answer
  test("a held message keeps the API's time for the hold, when its refusal gives one", async () => {
    const pasted = "2026-10-18T02:29:50.000Z"
    const held: (string | undefined)[] = []
    let tries = 0
    const send = (async (
      _to: string,
      _text: string,
      _files: string[],
      _id: string,
      { queuedAt }: { queuedAt?: string } = {},
    ) => {
      held.push(queuedAt)
      tries += 1
      return tries === 1 ? refused("CONFLICT", { delivery: "QUEUED", queuedAt: pasted }) : typed
    }) as never
    jest.useFakeTimers()
    try {
      const chats = new DashboardChats({ label: (name) => name, send })
      chats.post("dispatcher", { attachments: [], text: "while it compacts" })
      for (let second = 0; second <= 20 && chats.outbox()[0]?.state !== "typed"; second++) {
        await flush()
        jest.advanceTimersByTime(1000)
      }
      expect(held).toEqual([undefined, pasted])
    } finally {
      jest.useRealTimers()
    }
  })
})

describe("refreshingReplies", () => {
  const typed = { data: { at: "2026-10-18T02:30:00.000Z", sessionId: "s1" }, error: null }
  const refused = { data: null, error: { code: "ON_PICKER", message: "on a picker" } }
  const sender = (result: unknown) => jest.fn(async () => result) as never

  test("refreshes the inbox once a reply naming an item is typed, so its count drops at once", async () => {
    const refresh = jest.fn()
    const send = sender(typed)
    expect(await refreshingReplies(send, refresh)("dispatcher", "re #i7: go ahead", [], "m1")).toBe(
      typed as never,
    )
    expect(send).toHaveBeenCalledWith("dispatcher", "re #i7: go ahead", [], "m1")
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  test("leaves the inbox alone for a message that names no item", async () => {
    const refresh = jest.fn()
    await refreshingReplies(sender(typed), refresh)("dispatcher", "how is #184 going?")
    expect(refresh).not.toHaveBeenCalled()
  })

  test("leaves the inbox alone when the reply was not typed, since nothing was recorded", async () => {
    const refresh = jest.fn()
    await refreshingReplies(sender(refused), refresh)("dispatcher", "re #i7: go ahead")
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("transcriptFor", () => {
  test("a stream that reads a session fills that session's chat", () => {
    expect(transcriptFor({ entries: [], sessionId: "s2", sessionName: "worker-a" })).toBe(
      "worker-a",
    )
  })

  test("an empty slot naming the session the other slot reads fills no chat", () => {
    expect(transcriptFor({ entries: [], sessionId: null, sessionName: "dispatcher" })).toBeNull()
  })
})

describe("the hosted build's outbox", () => {
  // in a browser with no paired key the relay carries no send, so a message read "retry 3 · <session> is not live" and retried with no end
  test("fails a new message at once with the read-only line, sends nothing and never retries it", async () => {
    const { calls, send } = fakeSend()
    const chats = new DashboardChats({ label: (name) => name, readOnly: true, send })
    chats.post("dispatcher", { attachments: [], text: "hello" })
    await settle()
    const [dropped] = chats.outbox()
    expect(dropped?.state).toBe("failed")
    expect(dropped?.reason).toBe(READ_ONLY_LINE)
    chats.retry("dispatcher", dropped!.id)
    await settle()
    expect(calls).toEqual([])
    expect(chats.outbox().map((m) => m.state)).toEqual(["failed"])
  })

  test("drops what a reloaded tab still held, with the same reason, and sends none of it", async () => {
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
    const before = fakeSend()
    const page = new DashboardChats({ label: (name) => name, send: before.send, storage })
    page.resume()
    page.post("dispatcher", { attachments: [], text: "held" })
    await settle()
    before.calls[0]?.resolve(refused("NETWORK_ERROR"))
    await settle()
    const after = fakeSend()
    const hosted = new DashboardChats({
      label: (name) => name,
      readOnly: true,
      send: after.send,
      storage,
    })
    hosted.resume()
    await settle()
    expect(after.calls).toEqual([])
    expect(hosted.outbox().map((m) => [m.state, m.reason])).toEqual([["failed", READ_ONLY_LINE]])
  })

  test("sends what a reloaded tab still held once the page reads a paired key, and drops nothing", async () => {
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
    const before = fakeSend()
    const page = new DashboardChats({ label: (name) => name, send: before.send, storage })
    page.resume()
    page.post("dispatcher", { attachments: [], text: "held" })
    await settle()
    before.calls[0]?.resolve(refused("NETWORK_ERROR"))
    await settle()
    const after = fakeSend()
    const hosted = new DashboardChats({
      label: (name) => name,
      readOnly: true,
      send: after.send,
      storage,
    })
    hosted.setReadOnly(false)
    hosted.resume()
    await settle()
    expect(after.calls.map((call) => call.text)).toEqual(["held"])
    expect(hosted.outbox().map((m) => m.state)).toEqual(["sending"])
  })
})
