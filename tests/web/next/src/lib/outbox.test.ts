import { describe, expect, test } from "bun:test"

import { type Entry, parseLines } from "../../../../../api/hono/src/lib/dashboard/transcript"
import {
  canRetry,
  comparable,
  deliveredAt,
  failWithFiles,
  findDelivery,
  isNext,
  MAX_ATTEMPTS,
  matchDeliveries,
  nextToSend,
  nextWake,
  onRefusal,
  othersWaiting,
  outboxReducer,
  pickerMoves,
  refusalCode,
  retryDelay,
  retryNote,
  resumable,
  sameText,
  sentSince,
  statusLine,
  statusMark,
  submittable,
  typedHeld,
  TYPED_HOLD_MS,
  UNDO_MS,
  undoOf,
  undoState,
  UNREACHED_ATTEMPTS,
  UNSENT_MARKER,
  waiting,
  waitReason,
  type OutboxAction,
  type OutboxMessage,
} from "../../../../../web/next/src/lib/outbox"
import { NORMALIZE_CASES } from "../../../../dashboard-normalize-cases"

const T0 = "2026-10-06T00:00:00.000Z"
const SESSION = { id: "s-1", name: "dispatcher" }

const message = (id: string, overrides: Partial<OutboxMessage> = {}): OutboxMessage => ({
  at: T0,
  attachments: [],
  attempts: 0,
  code: null,
  deliveredAt: null,
  entryId: null,
  id,
  reason: null,
  retryAt: null,
  sawPicker: false,
  sessionId: null,
  state: "queued",
  text: id,
  to: "dispatcher",
  typedAt: null,
  unanswered: false,
  unreached: 0,
  ...overrides,
})

const human = (id: string, at: string, text: string): Entry => ({
  at,
  from: null,
  id,
  kind: "human",
  text,
  tool: null,
})

// The row type, taken from the function itself: the API's source resolves its own @/ paths, which this test's config does not.
type Worker = NonNullable<Parameters<typeof pickerMoves>[1]>[number]
const worker = (name: string, light: Worker["light"]) => ({ light, name }) as Worker

describe("outboxReducer", () => {
  test("a message moves queued, sending, typed, delivered", () => {
    let state = outboxReducer([], { message: message("a"), type: "add" })
    state = outboxReducer(state, { id: "a", type: "sending" })
    expect(state[0]).toMatchObject({ attempts: 1, state: "sending" })
    state = outboxReducer(state, { at: T0, id: "a", sessionId: "s-1", type: "typed" })
    expect(state[0]).toMatchObject({ sessionId: "s-1", state: "typed", typedAt: T0 })
    state = outboxReducer(state, { at: T0, entryId: "e1", id: "a", type: "delivered" })
    expect(state[0]).toMatchObject({ deliveredAt: T0, entryId: "e1", state: "delivered" })
  })

  test("a refusal that can pass queues it again with its reason and retry time", () => {
    const sending = [message("a", { attempts: 1, sawPicker: true, state: "sending" })]
    const [waited] = outboxReducer(sending, {
      attempts: 1,
      code: "INPUT_NOT_EMPTY",
      id: "a",
      reason: "waiting for dispatcher's input to clear",
      retryAt: 5,
      type: "wait",
      unreached: 2,
    })
    expect(waited).toMatchObject({
      code: "INPUT_NOT_EMPTY",
      retryAt: 5,
      sawPicker: false,
      state: "queued",
      unreached: 2,
    })
  })

  // The picker effect and the send effect run in one commit, so a release can arrive after the send has started: it must leave the request alone rather than queue it for a second send.
  test("a move from the wrong state changes nothing", () => {
    const sending = [message("a", { state: "sending" })]
    for (const type of ["release", "cancel", "sending", "saw", "dismiss"] as const) {
      expect(outboxReducer(sending, { id: "a", type })).toBe(sending)
    }
    const typed = [message("a", { state: "typed" })]
    expect(
      outboxReducer(typed, {
        attempts: 1,
        code: "X",
        id: "a",
        reason: "x",
        retryAt: 0,
        type: "wait",
        unreached: 0,
      }),
    ).toBe(typed)
    expect(outboxReducer(typed, { id: "a", type: "retry" })).toBe(typed)
    expect(outboxReducer(typed, { id: "a", type: "remove" })).toBe(typed)
    expect(outboxReducer(typed, { id: "missing", type: "cancel" })).toBe(typed)
  })

  test("cancel drops a queued message, dismiss a typed one, remove a failed one", () => {
    expect(outboxReducer([message("a")], { id: "a", type: "cancel" })).toEqual([])
    const typed = [message("a", { state: "typed" })]
    expect(outboxReducer(typed, { id: "a", type: "dismiss" })).toEqual([])
    const failed = [message("a", { state: "failed" })]
    expect(outboxReducer(failed, { id: "a", type: "remove" })).toEqual([])
  })

  test("retry starts a failed message over, and a failure keeps its code", () => {
    const failed = [
      message("a", { attempts: 8, code: "NETWORK_ERROR", state: "failed", unreached: 7 }),
    ]
    expect(outboxReducer(failed, { id: "a", type: "retry" })[0]).toMatchObject({
      attempts: 0,
      code: null,
      state: "queued",
      unreached: 0,
    })
    const [kept] = outboxReducer([message("a", { state: "sending" })], {
      code: "COMMAND",
      id: "a",
      reason: "a command",
      type: "fail",
    })
    expect(kept).toMatchObject({ code: "COMMAND", state: "failed" })
  })

  // a New thread send left pasted and unsent waits, and its retry goes to the thread its paste names
  test("a New thread send that waits naming its kept thread retries to that thread", () => {
    const [waiting] = outboxReducer([message("a", { newThread: true, state: "sending" })], {
      attempts: 1,
      code: "INPUT_NOT_EMPTY",
      id: "a",
      reason: "sits unsent",
      retryAt: 2000,
      threadId: "n3wt",
      type: "wait",
      unreached: 0,
    })
    expect(waiting).toMatchObject({ newThread: undefined, state: "queued", threadId: "n3wt" })
  })

  // a reviewer: a New thread send cut off while typing keeps its thread, so its Retry goes to that thread rather than opening another
  test("a New thread send that fails naming its kept thread retries to that thread", () => {
    const [failed] = outboxReducer([message("a", { newThread: true, state: "sending" })], {
      code: "INTERRUPTED",
      id: "a",
      reason: "cut off",
      threadId: "n3wt",
      type: "fail",
    })
    expect(failed).toMatchObject({ newThread: undefined, state: "failed", threadId: "n3wt" })
    const [plain] = outboxReducer([message("b", { newThread: true, state: "sending" })], {
      code: "COMMAND",
      id: "b",
      reason: "a command",
      type: "fail",
    })
    expect(plain).toMatchObject({ newThread: true, state: "failed" })
  })

  test("a picker seen answered releases its message with a fresh count", () => {
    const held = [message("a", { attempts: 57, code: "ON_PICKER", retryAt: 99 })]
    const seen = outboxReducer(held, { id: "a", type: "saw" })
    expect(seen[0]?.sawPicker).toBe(true)
    expect(outboxReducer(seen, { id: "a", type: "release" })[0]).toMatchObject({
      attempts: 0,
      retryAt: null,
      sawPicker: false,
    })
  })
})

describe("order and timing", () => {
  test("a session's messages go one at a time, in the order written", () => {
    const behindSend = [message("a", { state: "sending" }), message("b")]
    expect(nextToSend(behindSend, "dispatcher", 0)).toBeNull()
    const behindTyped = [message("a", { state: "typed" }), message("b")]
    expect(nextToSend(behindTyped, "dispatcher", 0)?.id).toBe("b")
  })

  test("a message waiting on a retry holds the ones after it", () => {
    const messages = [message("a", { retryAt: 100 }), message("b")]
    expect(nextToSend(messages, "dispatcher", 50)).toBeNull()
    expect(nextToSend(messages, "dispatcher", 100)?.id).toBe("a")
  })

  test("sessions do not wait on each other", () => {
    const messages = [message("a", { state: "sending" }), message("b", { to: "builder" })]
    expect(nextToSend(messages, "builder", 0)?.id).toBe("b")
  })

  test("the timer wakes for the earliest retry ahead among the sessions' next messages", () => {
    const messages = [
      message("a", { retryAt: 300 }),
      message("b", { retryAt: 200, to: "builder" }),
      message("c", { retryAt: 100 }),
    ]
    expect(nextWake(messages, 0)).toBe(200)
  })

  // A message behind one whose request is out, its own retry time already past, used to re-arm a 0ms timer on every tick until that request settled.
  test("nothing behind a request in flight, and nothing already due, sets a timer", () => {
    const behind = [message("a", { state: "sending" }), message("b", { retryAt: 5 })]
    expect(nextWake(behind, 10)).toBeNull()
    expect(nextWake([message("a", { retryAt: 5 })], 10)).toBeNull()
    expect(nextWake([message("a", { retryAt: 50, state: "typed" })], 10)).toBeNull()
  })

  test("only the session's next message says it is sending", () => {
    const [first, second] = [
      message("a", { code: "ON_PICKER", reason: "on a picker" }),
      message("b"),
    ]
    const messages = [first, second]
    expect(isNext(messages, first)).toBe(true)
    expect(isNext(messages, second)).toBe(false)
    expect(statusLine(second, { busy: false, label: "x", next: false })).toBe(
      "Queued: waiting its turn",
    )
    expect(statusLine(second, { busy: false, label: "x", next: true })).toBe("Sending…")
  })
})

describe("pickerMoves", () => {
  const held = message("a", { code: "ON_PICKER", reason: "on a picker", retryAt: 999 })

  // The client's light can lag the API's refusal (the hub's debounce, a missed event, a reconnect): releasing on it would resend into the same picker over and over.
  test("a light that has not caught up with the picker releases nothing", () => {
    expect(pickerMoves([held], [worker("dispatcher", "working")])).toEqual({ release: [], saw: [] })
  })

  test("the picker seen marks the message, and seen answered releases it", () => {
    expect(pickerMoves([held], [worker("dispatcher", "needs-you")])).toEqual({
      release: [],
      saw: ["a"],
    })
    const marked = { ...held, sawPicker: true }
    expect(pickerMoves([marked], [worker("dispatcher", "needs-you")])).toEqual({
      release: [],
      saw: [],
    })
    expect(pickerMoves([marked], [worker("dispatcher", "idle")])).toEqual({
      release: ["a"],
      saw: [],
    })
  })

  test("other waits and missing sessions are left alone", () => {
    const draft = message("b", { code: "INPUT_NOT_EMPTY", sawPicker: true })
    expect(pickerMoves([draft], [worker("dispatcher", "idle")])).toEqual({ release: [], saw: [] })
    expect(pickerMoves([{ ...held, sawPicker: true }], null)).toEqual({ release: [], saw: [] })
  })
})

describe("refusals", () => {
  test("a delivery's own code is read from under the API's broader one", () => {
    expect(refusalCode({ code: "CONFLICT", delivery: "ON_PICKER" })).toBe("ON_PICKER")
    expect(refusalCode({ code: "TOO_MANY_REQUESTS" })).toBe("TOO_MANY_REQUESTS")
  })

  test("an attachment that is gone is its own code, which fails at once and offers Edit alone", () => {
    const gone = {
      attachment: "GONE",
      code: "NOT_FOUND",
      id: "x.png",
      message: "An attachment is gone",
    }
    expect(refusalCode(gone)).toBe("ATTACHMENT_GONE")
    expect(refusalCode({ code: "NOT_FOUND" })).toBe("NOT_FOUND")
    const refusal = { code: refusalCode(gone), message: gone.message }
    expect(
      onRefusal({ attempts: 1, code: null, id: "a", unreached: 0 }, refusal, "dispatcher", 0),
    ).toEqual({
      code: "ATTACHMENT_GONE",
      id: "a",
      reason: "An attachment is gone",
      type: "fail",
    })
    expect(canRetry("ATTACHMENT_GONE")).toBe(false)
  })

  test("the file that has gone leaves the message and is named in its reason, so Edit hands back the rest", () => {
    const file = (id: string) => ({
      id,
      kind: "text" as const,
      name: `${id}-name`,
      previewUrl: null,
      size: 1,
    })
    const files = [file("a.md"), file("b.md"), file("c.md")]
    const fail = {
      code: "ATTACHMENT_GONE",
      id: "m",
      reason: "An attachment is gone",
      type: "fail" as const,
    }
    const gone = failWithFiles(fail, files, { attachment: "GONE", code: "NOT_FOUND", id: "b.md" })
    expect(gone.attachments?.map((f) => f.id)).toEqual(["a.md", "c.md"])
    expect(gone.reason).toStartWith("b.md-name is gone")
    const other = { code: "COMMAND", id: "m", reason: "no", type: "fail" as const }
    expect(failWithFiles(other, files, { code: "VALIDATION_ERROR", delivery: "COMMAND" })).toBe(
      other,
    )
    const sending = message("m", { attachments: files, state: "sending" })
    expect(outboxReducer([sending], gone)[0]?.attachments.map((f) => f.id)).toEqual([
      "a.md",
      "c.md",
    ])
    expect(outboxReducer([sending], other)[0]?.attachments).toBe(files)
  })

  test("a refusal waits with backoff until the tries run out, a picker for as long as it takes", () => {
    const draft = { code: "INPUT_NOT_EMPTY", message: "holds a draft" }
    const again = { attempts: 2, code: "INPUT_NOT_EMPTY", id: "a", unreached: 0 }
    expect(onRefusal(again, draft, "dispatcher", 1000)).toEqual({
      attempts: 2,
      code: "INPUT_NOT_EMPTY",
      id: "a",
      reason: "waiting for dispatcher's input to clear",
      retryAt: 5000,
      type: "wait",
      unreached: 0,
    })
    const spent = { attempts: MAX_ATTEMPTS, code: "INPUT_NOT_EMPTY", id: "a", unreached: 0 }
    expect(onRefusal(spent, draft, "dispatcher", 0)).toMatchObject({
      reason: "holds a draft",
      type: "fail",
    })
    const picker = { code: "ON_PICKER", message: "on a picker" }
    const long = { attempts: 500, code: "ON_PICKER", id: "a", unreached: 0 }
    expect(onRefusal(long, picker, "dispatcher", 0)).toMatchObject({
      retryAt: 30_000,
      type: "wait",
    })
  })

  // The backoff timer can send a message just after its picker is answered, before the release: hours of picker tries must not fail the refusal that follows.
  test("a picker's tries are its own", () => {
    const draft = { code: "INPUT_NOT_EMPTY", message: "holds a draft" }
    const afterPicker = { attempts: 241, code: "ON_PICKER", id: "a", unreached: 0 }
    expect(onRefusal(afterPicker, draft, "dispatcher", 0)).toMatchObject({
      attempts: 1,
      retryAt: 2000,
      type: "wait",
    })
    expect(
      onRefusal({ attempts: 1, code: null, id: "a", unreached: 0 }, draft, "x", 0),
    ).toMatchObject({
      attempts: 1,
    })
  })

  // A draft that stays while cmux's read fails now and then would otherwise restart the count each time and never give up.
  test("other reasons share one count, so two that take turns still run out", () => {
    let message = { attempts: 0, code: null as string | null, id: "a", unreached: 0 }
    const codes = ["INPUT_NOT_EMPTY", "CMUX_FAILED"]
    let last: ReturnType<typeof onRefusal> | null = null
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const code = codes[i % 2]!
      last = onRefusal(
        { ...message, attempts: message.attempts + 1 },
        { code, message: code },
        "x",
        0,
      )
      if (last.type !== "wait") break
      message = { attempts: last.attempts, code, id: "a", unreached: 0 }
    }
    expect(last).toMatchObject({ type: "fail" })
    expect(message.attempts).toBe(MAX_ATTEMPTS - 1)
  })

  // Typing that began and did not finish may have sent the message already, so a second try waits for a person.
  test("a delivery cut off while typing fails, offering Edit alone", () => {
    const cut = { code: "INTERRUPTED", message: "The Enter may have gone through anyway" }
    expect(onRefusal({ attempts: 1, code: null, id: "a", unreached: 0 }, cut, "x", 0)).toEqual({
      code: "INTERRUPTED",
      id: "a",
      reason: "The Enter may have gone through anyway",
      type: "fail",
    })
    expect(canRetry("INTERRUPTED")).toBe(false)
  })

  // deliver() throws when it cannot write its activity row, which can come after the Enter, so a 500 is as unknown as no answer at all.
  test("the API's own failure fails at once, saying to look before a Retry it offers", () => {
    const sent = { attempts: 1, code: null, id: "a", unreached: 0 }
    const action = onRefusal(sent, { code: "INTERNAL_SERVER_ERROR", message: "x" }, "dispatcher", 0)
    expect(action).toMatchObject({ code: "INTERNAL_SERVER_ERROR", type: "fail" })
    expect(action.type === "fail" ? action.reason : "").toContain("look at its terminal")
    expect(canRetry("INTERNAL_SERVER_ERROR")).toBe(true)
  })

  // A dashboard restart answers nothing for a while; each retry carries the message's id, so the API answers one it already typed as delivered.
  test("no answer waits out about 2 minutes of tries, then fails saying to look before a Retry it offers", () => {
    for (const code of ["NETWORK_ERROR", "UNKNOWN_ERROR"]) {
      let waited = 0
      for (let unreached = 0; unreached < UNREACHED_ATTEMPTS - 1; unreached++) {
        const sent = { attempts: unreached + 1, code, id: "a", unreached }
        const action = onRefusal(sent, { code, message: "x" }, "dispatcher", 0)
        expect(action).toMatchObject({ code, reason: "the server did not answer", type: "wait" })
        waited += action.type === "wait" ? action.retryAt : 0
      }
      expect(waited).toBe(120_000)
      const sent = {
        attempts: UNREACHED_ATTEMPTS,
        code,
        id: "a",
        unreached: UNREACHED_ATTEMPTS - 1,
      }
      const action = onRefusal(sent, { code, message: "x" }, "dispatcher", 0)
      expect(action).toMatchObject({ code, type: "fail" })
      expect(action.type === "fail" ? action.reason : "").toContain("look at its terminal")
      expect(canRetry(code)).toBe(true)
    }
  })

  // A message that waited long on a draft or a busy cmux still gets the whole window when the dashboard restarts.
  test("no answer counts its own tries, whatever waited before it", () => {
    const sent = { attempts: 8, code: "INPUT_NOT_EMPTY", id: "a", unreached: 0 }
    const action = onRefusal(sent, { code: "NETWORK_ERROR", message: "x" }, "dispatcher", 0)
    expect(action).toMatchObject({ attempts: 8, retryAt: 2000, type: "wait", unreached: 1 })
    const other = onRefusal(
      { attempts: 9, code: "NETWORK_ERROR", id: "a", unreached: 1 },
      { code: "CMUX_FAILED", message: "x" },
      "dispatcher",
      0,
    )
    expect(other).toMatchObject({ type: "wait", unreached: 0 })
  })

  // after a roll restarted the dashboard (13 Oct, stopped 04:37:46Z, back 04:37:58Z), "re #i185: nws, chill" failed red on a draft that was not its own (no earlier try had reached a server), and the owner had to press Retry by hand, which the outbox should do itself. deliver() refuses a draft before typing anything, so waiting it out is safe.
  test("a draft found after no answer waits quietly for the input to clear, still known to be maybe landed", () => {
    const draft = { code: "INPUT_NOT_EMPTY", message: "holds a draft" }
    const sent = { attempts: 3, code: "NETWORK_ERROR", id: "a", unreached: 3 }
    const action = onRefusal(sent, draft, "dispatcher", 0)
    expect(action).toMatchObject({
      code: "INPUT_NOT_EMPTY",
      reason: "waiting for dispatcher's input to clear",
      type: "wait",
      unreached: 0,
    })
    const unreached = message("a", {
      code: "NETWORK_ERROR",
      state: "sending",
      unanswered: true,
      unreached: 3,
    })
    const [waiting] = outboxReducer([unreached], action)
    expect(waiting).toMatchObject({ state: "queued", unanswered: true, unreached: 0 })
  })

  // A restart while it waits on the draft gets its own whole window, so the red failure a fix removed cannot come back that way.
  test("a restart after a draft wait gets the whole window again", () => {
    let m = message("a", { state: "queued" })
    let action: OutboxAction | undefined
    for (const code of [
      "NETWORK_ERROR",
      "NETWORK_ERROR",
      "NETWORK_ERROR",
      "INPUT_NOT_EMPTY",
      "NETWORK_ERROR",
    ]) {
      const [sending] = outboxReducer([m], { id: "a", type: "sending" })
      action = onRefusal(sending!, { code, message: "x" }, "dispatcher", 0)
      m = outboxReducer([sending!], action)[0]!
    }
    expect(action).toMatchObject({ retryAt: 2000, type: "wait", unreached: 1 })
    expect(m).toMatchObject({ state: "queued", unanswered: true, unreached: 1 })
  })

  test("a draft that never clears fails only after every try, in the API's own words", () => {
    const draft = { code: "INPUT_NOT_EMPTY", message: "holds a draft" }
    const spent = { attempts: MAX_ATTEMPTS, code: "INPUT_NOT_EMPTY", id: "a", unreached: 0 }
    expect(onRefusal(spent, draft, "dispatcher", 0)).toMatchObject({
      code: "INPUT_NOT_EMPTY",
      reason: "holds a draft",
      type: "fail",
    })
  })

  test("any wait or failure after no answer keeps the message known to be maybe landed", () => {
    const unknown = {
      attempts: 1,
      code: "NETWORK_ERROR",
      id: "a",
      reason: "x",
      retryAt: 0,
      type: "wait" as const,
      unreached: 1,
    }
    const [waiting] = outboxReducer([message("a", { state: "sending" })], unknown)
    expect(waiting).toMatchObject({ unanswered: true })
    const picker = { ...unknown, code: "ON_PICKER", unreached: 0 }
    const [onPicker] = outboxReducer([{ ...waiting!, state: "sending" }], picker)
    expect(onPicker).toMatchObject({ unanswered: true, unreached: 0 })
    const [answeredOnly] = outboxReducer([message("b", { state: "sending" })], {
      ...picker,
      id: "b",
    })
    expect(answeredOnly).toMatchObject({ unanswered: false })
  })

  test("a refusal for what the message says fails, offering Edit alone", () => {
    for (const code of ["COMMAND", "EMPTY", "TOO_LONG", "AMBIGUOUS", "FORBIDDEN"]) {
      const action = onRefusal(
        { attempts: 1, code: null, id: "a", unreached: 0 },
        { code, message: "no" },
        "x",
        0,
      )
      expect(action).toMatchObject({ type: "fail" })
      expect(canRetry(code)).toBe(false)
    }
    expect(canRetry(null)).toBe(false)
  })

  test("the backoff doubles from 2s and stops growing at 30s", () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000])
  })

  test("a wait names its reason, and its count stays out of the status", () => {
    expect(waitReason("ON_PICKER", "dispatcher")).toBe("dispatcher is on a prompt")
    expect(waitReason("SOMETHING_NEW", "dispatcher")).toBe("SOMETHING_NEW")
    const waited = message("a", {
      attempts: 2,
      code: "ON_PICKER",
      reason: "Playground is on a prompt",
    })
    expect(statusLine(waited, { busy: false, label: "x", limited: false, next: true })).toBe(
      "Queued: Alpha is on a prompt",
    )
    expect(statusLine(waited, { busy: false, label: "x", limited: true, next: true })).toBe(
      "Queued: Alpha is at its usage limit",
    )
    expect(retryNote(message("b"), false)).toBeNull()
  })

  // A retry says why after its dot, or shows no dot.
  test.each([
    ["CMUX_FAILED", false, "retry 3 · the terminal did not answer"],
    ["INPUT_NOT_EMPTY", false, "retry 3 · waiting for Alpha's input to clear"],
    ["NETWORK_ERROR", false, "retry 3 · the server did not answer"],
    ["NOT_FOUND", false, "retry 3 · Alpha is not live"],
    ["ON_PICKER", false, "retry 3 · Alpha is on a prompt"],
    ["ON_PICKER", true, "retry 3 · Alpha is at its usage limit"],
    ["TOO_MANY_REQUESTS", false, "retry 3 · too many messages this minute"],
    ["UNKNOWN_ERROR", false, "retry 3 · the server did not answer"],
    ["SOMETHING_NEW", false, "retry 3"],
    [null, false, null],
  ] as const)("a retry on %s (usage limit %p) reads %s", (code, limited, note) => {
    const waited = message("a", { attempts: 3, code, reason: code ?? "x" })
    expect(retryNote(waited, limited)).toBe(note)
  })
})

describe("delivery", () => {
  const typed = message("a", {
    sessionId: "s-1",
    state: "typed",
    text: "hi\tthere\r\nsecond  ",
    typedAt: T0,
  })
  const held = "hi    there\nsecond"

  // The API types the normalized text, so the match normalizes the same way.
  test("comparable is the API's normalize", () => {
    for (const [input, output] of NORMALIZE_CASES) expect(comparable(input)).toBe(output)
  })

  test("a person's entry with the normalized text, after it was typed, is its delivery", () => {
    const entry = human("e1", "2026-10-06T00:00:03.000Z", held)
    expect(findDelivery(typed, [entry], new Set())?.id).toBe("e1")
    // typedAt is read after the Enter and the row's commit, so the entry can come just before it, an earlier try that got no answer or not
    const marked = { ...typed, typedAt: "2026-10-06T00:00:10.000Z", unanswered: true }
    const before = human("e1", "2026-10-06T00:00:09.950Z", held)
    expect(findDelivery(marked, [before], new Set())?.id).toBe("e1")
  })

  // the API puts the thread's marker before the words, so the transcript holds it first
  test("a thread's message matches its entry past the marker, and a message with no thread does not", () => {
    const entry = human("e1", "2026-10-06T00:00:03.000Z", `[thread:k7mq] ${held}`)
    expect(findDelivery({ ...typed, threadId: "k7mq" }, [entry], new Set())?.id).toBe("e1")
    expect(findDelivery({ ...typed, newThread: true }, [entry], new Set())?.id).toBe("e1")
    expect(findDelivery(typed, [entry], new Set())).toBeNull()
    const clipped = human("e2", "2026-10-06T00:00:03.000Z", `[thread:k7mq] ${"x".repeat(3985)}…`)
    const long = { ...typed, text: "x".repeat(5000), threadId: "k7mq" }
    expect(findDelivery(long, [clipped], new Set())?.id).toBe("e2")
  })

  test("an entry already claimed, from long before, or another kind is not", () => {
    expect(findDelivery(typed, [human("e1", T0, held)], new Set(["e1"]))).toBeNull()
    const early = human("e2", "2026-10-05T23:59:00.000Z", held)
    expect(findDelivery(typed, [early], new Set())).toBeNull()
    const assistant = { ...human("e3", T0, held), kind: "assistant" as const }
    expect(findDelivery(typed, [assistant], new Set())).toBeNull()
  })

  test("a long message matches the transcript's clipped copy", () => {
    const clipped = `${"x".repeat(3999)}…`
    expect(sameText("x".repeat(5000), clipped)).toBe(true)
    expect(sameText(`y${"x".repeat(5000)}`, clipped)).toBe(false)
    expect(sameText("x".repeat(10), `${"x".repeat(9)}…`)).toBe(false)
  })

  test("the same text sent twice claims its entries in order", () => {
    const first = message("a", { sessionId: "s-1", state: "typed", text: "go", typedAt: T0 })
    const second = message("b", { sessionId: "s-1", state: "typed", text: "go", typedAt: T0 })
    const later = "2026-10-06T00:00:01.000Z"
    const entries = [human("e1", T0, "go"), human("e2", later, "go")]
    expect(matchDeliveries([first, second], entries, SESSION)).toEqual([
      { at: T0, entryId: "e1", id: "a" },
      { at: later, entryId: "e2", id: "b" },
    ])
  })

  // The loaded entries are the selected session's alone: a message another session took is never matched against them, however alike the text.
  test("only messages the shown session took are matched against its entries", () => {
    const entries = [human("e1", T0, held)]
    expect(matchDeliveries([typed], entries, { id: "s-2", name: "dispatcher" })).toEqual([])
    expect(matchDeliveries([typed], entries, null)).toEqual([])
    expect(matchDeliveries([{ ...typed, sessionId: null }], entries, SESSION)).toEqual([])
  })

  test("a message with files is delivered by an entry with its words and the same files, files alone included", () => {
    const png = { id: "p.png", kind: "image" as const, name: "a.png", previewUrl: null, size: 1 }
    const pdf = { id: "d.pdf", kind: "pdf" as const, name: "b.pdf", previewUrl: null, size: 2 }
    const sent = (text: string, attachments = [png, pdf]) =>
      message("a", { attachments, sessionId: "s-1", state: "typed", text, typedAt: T0 })
    const entry = (text: string, ids: string[]) => ({
      ...human("e1", T0, text),
      attachments: ids.map((id) => ({
        id,
        kind: id.endsWith(".png") ? ("image" as const) : ("pdf" as const),
      })),
    })
    expect(findDelivery(sent("look"), [entry("look", ["p.png", "d.pdf"])], new Set())?.id).toBe(
      "e1",
    )
    expect(findDelivery(sent(""), [entry("", ["p.png", "d.pdf"])], new Set())?.id).toBe("e1")
    expect(findDelivery(sent("look"), [entry("look", ["p.png"])], new Set())).toBeNull()
    expect(findDelivery(sent("look"), [human("e1", T0, "look")], new Set())).toBeNull()
    expect(findDelivery(sent("look", []), [entry("look", ["p.png"])], new Set())).toBeNull()
  })

  // herdr pastes the message, and Claude Code takes each image path in as an image, drops blank lines and splits a line at " /", so the entry holds his words as that paste left them
  test("a message with images herdr pasted is delivered by its entry as Claude Code took it in, and never by another's", () => {
    const png = { id: "p.png", kind: "image" as const, name: "a.png", previewUrl: null, size: 1 }
    const pdf = { id: "d.pdf", kind: "pdf" as const, name: "b.pdf", previewUrl: null, size: 2 }
    const txt = { id: "t.txt", kind: "text" as const, name: "c.txt", previewUrl: null, size: 3 }
    const sent = (text: string, attachments = [png, pdf, txt]) =>
      message("a", { attachments, sessionId: "s-1", state: "typed", text, typedAt: T0 })
    const words = "Three files.\n\nSecond paragraph, see /docs/a.md."
    const held = "Three files.\nSecond paragraph, see\n/docs/a.md."
    const entry = (text: string, files: NonNullable<Entry["attachments"]>) => ({
      ...human("e1", T0, text),
      attachments: files,
    })
    const named = [png, pdf, txt].map(({ id, kind }) => ({ id, kind }))
    const unnamed = [{ id: null, kind: "image" as const }, ...named.slice(1)]
    expect(findDelivery(sent(words), [entry(held, named)], new Set())?.id).toBe("e1")
    // the image's source line can come in a later read than the message
    expect(findDelivery(sent(words), [entry(held, unnamed)], new Set())?.id).toBe("e1")
    // another message's words or files, or part of his, are not his
    expect(findDelivery(sent(words), [entry("Three files.", named)], new Set())).toBeNull()
    expect(findDelivery(sent(words), [entry("Three files.\nSecond", named)], new Set())).toBeNull()
    const otherPdf = [unnamed[0]!, { id: "x.pdf", kind: "pdf" as const }, named[2]!]
    expect(findDelivery(sent(words), [entry(held, otherPdf)], new Set())).toBeNull()
    expect(findDelivery(sent(words), [entry(held, named.slice(1))], new Set())).toBeNull()
    const pdfFirst = [named[1]!, { id: null, kind: "image" as const }, named[2]!]
    expect(findDelivery(sent(words), [entry(held, pdfFirst)], new Set())).toBeNull()
    // an image whose id is unknown stands only for an image he sent
    expect(findDelivery(sent(words, [pdf]), [entry(held, [unnamed[0]!])], new Set())).toBeNull()
    // with no image, nothing was taken in, so the words held are the words sent
    expect(
      findDelivery(sent(words, [pdf, txt]), [entry(held, named.slice(1))], new Set()),
    ).toBeNull()
    expect(
      findDelivery(sent(words, [pdf, txt]), [entry(words, named.slice(1))], new Set())?.id,
    ).toBe("e1")
  })

  // herdr pastes a long message whole, and Claude Code records it wrapped in <pasted_content> tags
  test("a long message herdr pasted is delivered by its entry as the transcript records it", () => {
    const words = "Rameen  [3:53 PM]\n@Soren can we\n\n[3:54 PM]Are the evals progressing."
    const sent = message("a", { sessionId: "s-1", state: "typed", text: words, typedAt: T0 })
    const line = (content: string) =>
      JSON.stringify({
        message: { content, role: "user" },
        origin: { kind: "human" },
        timestamp: T0,
        type: "user",
        uuid: "e1",
      })
    const wrapped = `\n\n<pasted_content id="79a0">\n${words}\n</pasted_content id="79a0">\n`
    expect(findDelivery(sent, parseLines(line(wrapped)), new Set())?.id).toBe("e1")
    expect(findDelivery(sent, parseLines(line(words)), new Set())?.id).toBe("e1")
    const part = `\n\n<pasted_content id="79a0">\nRameen\n</pasted_content id="79a0">\n`
    expect(findDelivery(sent, parseLines(line(part)), new Set())).toBeNull()
  })

  // Claude Code writes a message typed mid-turn when the turn ends, stamped at its Enter, and typedAt can come more than 5s after that Enter on a loaded machine (herdr's prompt answering, the box settling, the row committing)
  test("a message typed mid-turn is delivered by its queued entry, however late typedAt came", () => {
    const sent = message("m", {
      at: "2026-10-06T00:00:01.000Z",
      sessionId: "s-1",
      state: "typed",
      text: "also check the fixture?",
      typedAt: "2026-10-06T00:00:12.000Z",
    })
    const queued = JSON.stringify({
      attachment: {
        commandMode: "prompt",
        origin: { kind: "human" },
        prompt: "also check the fixture?",
        type: "queued_command",
      },
      timestamp: "2026-10-06T00:00:04.000Z",
      type: "attachment",
      uuid: "q1",
    })
    expect(matchDeliveries([sent], parseLines(queued), SESSION)).toEqual([
      { at: "2026-10-06T00:00:04.000Z", entryId: "q1", id: "m" },
    ])
  })

  test("an entry claimed earlier stays claimed", () => {
    const done = message("z", { entryId: "e1", sessionId: "s-1", state: "delivered" })
    expect(matchDeliveries([done, typed], [human("e1", T0, held)], SESSION)).toEqual([])
  })

  // A request that went unanswered may still have been typed: once the session's transcript holds the text, the bubble says delivered instead of inviting a second send.
  test("an unanswered message the transcript holds is delivered after all", () => {
    const unanswered = message("u", { code: "NETWORK_ERROR", state: "failed", text: "go" })
    const entry = human("e1", "2026-10-06T00:00:02.000Z", "go")
    const found = matchDeliveries([unanswered], [entry], SESSION)
    expect(found).toEqual([{ at: entry.at, entryId: "e1", id: "u" }])
    const [delivered] = outboxReducer([unanswered], { ...found[0]!, type: "delivered" })
    expect(delivered).toMatchObject({ entryId: "e1", state: "delivered" })
    const elsewhere = { id: "s-9", name: "builder" }
    expect(matchDeliveries([unanswered], [entry], elsewhere)).toEqual([])
    const refused = { ...unanswered, code: "COMMAND" }
    expect(matchDeliveries([refused], [entry], SESSION)).toEqual([])
    // a marked one takes no slack before it was written, after a reload as before it
    const marked = { ...unanswered, at: "2026-10-06T00:00:10.000Z", unanswered: true }
    const at = (when: string) => human("e1", when, "go")
    expect(matchDeliveries([marked], [at("2026-10-06T00:00:06.000Z")], SESSION)).toEqual([])
    expect(matchDeliveries([marked], [at("2026-10-06T00:00:10.000Z")], SESSION)).toHaveLength(1)
  })

  // a send whose request got no answer may have landed whole before the server stopped, so while it still waits to be sent again the transcript is read for it, and it is never typed twice.
  test("a message still waiting after no answer is delivered once the transcript holds it", () => {
    const waiting = message("w", {
      code: "INPUT_NOT_EMPTY",
      state: "queued",
      text: "go",
      unanswered: true,
    })
    const entry = human("e1", "2026-10-06T00:00:02.000Z", "go")
    const found = matchDeliveries([waiting], [entry], SESSION)
    expect(found).toEqual([{ at: entry.at, entryId: "e1", id: "w" }])
    const [delivered] = outboxReducer([waiting], { ...found[0]!, type: "delivered" })
    expect(delivered).toMatchObject({ entryId: "e1", state: "delivered" })
    const answered = { ...waiting, unanswered: false }
    expect(matchDeliveries([answered], [entry], SESSION)).toEqual([])
    // no slack before it was written: after a reload, an earlier send of the same text whose own record was not kept wrote that entry
    const later = { ...waiting, at: "2026-10-06T00:00:10.000Z" }
    const at = (when: string) => human("e1", when, "go")
    expect(matchDeliveries([later], [at("2026-10-06T00:00:09.999Z")], SESSION)).toEqual([])
    expect(matchDeliveries([later], [at("2026-10-06T00:00:10.000Z")], SESSION)).toHaveLength(1)
  })

  // a 30-line paste reached the session whole while its bubble read failed, so a person who trusted it would send it twice.
  test("a message cut off while typing is delivered once the transcript holds it whole, files and all, and never on part of it", () => {
    const png = { id: "p.png", kind: "image" as const, name: "a.png", previewUrl: null, size: 1 }
    const cut = message("i", {
      attachments: [png],
      code: "INTERRUPTED",
      state: "failed",
      text: "one\ntwo",
    })
    const entry = (id: string, text: string, files = [png]) => ({
      ...human(id, "2026-10-06T00:00:02.000Z", text),
      attachments: files.map((file) => ({ id: file.id, kind: file.kind })),
    })
    expect(matchDeliveries([cut], [entry("e1", "one\ntwo")], SESSION)).toEqual([
      { at: "2026-10-06T00:00:02.000Z", entryId: "e1", id: "i" },
    ])
    expect(matchDeliveries([cut], [entry("e1", "one")], SESSION)).toEqual([])
    expect(matchDeliveries([cut], [entry("e1", "one\ntwo", [])], SESSION)).toEqual([])
    // no slack before it was written, unlike an unanswered one: the entry comes after the send or not at all
    const at = (when: string) => ({ ...entry("e1", "one\ntwo"), at: when })
    const sent = message("i", { ...cut, at: "2026-10-06T00:00:10.000Z" })
    expect(matchDeliveries([sent], [at("2026-10-06T00:00:09.999Z")], SESSION)).toEqual([])
    expect(matchDeliveries([sent], [at("2026-10-06T00:00:10.000Z")], SESSION)).toHaveLength(1)
    // the transcript clips a long entry, and a long message cut off part way, then sent from its terminal, clips to the same words: only a whole match counts
    const long = { ...cut, attachments: [], text: "x".repeat(5000) }
    expect(matchDeliveries([long], [entry("e1", `${"x".repeat(3999)}…`, [])], SESSION)).toEqual([])
  })

  // An older send that went unanswered and never landed must not take the entry of a later send of the same text.
  test("a typed message claims its entry before an unanswered one can", () => {
    const older = message("c", { code: "NETWORK_ERROR", state: "failed", text: "ok" })
    const later = message("d", {
      sessionId: "s-1",
      state: "typed",
      text: "ok",
      typedAt: "2026-10-06T00:01:00.000Z",
    })
    const entry = human("e1", "2026-10-06T00:01:01.000Z", "ok")
    expect(matchDeliveries([older, later], [entry], SESSION)).toEqual([
      { at: entry.at, entryId: "e1", id: "d" },
    ])
  })
})

describe("statusLine", () => {
  const opts = { busy: false, label: "dispatcher", next: true }

  test("each state says where the message is", () => {
    expect(statusLine(message("a", { state: "sending" }), opts)).toBe("Sending…")
    const typed = message("a", { state: "typed" })
    expect(statusLine(typed, { ...opts, busy: true })).toBe("Queued")
    expect(statusLine(typed, opts)).toBe("Sent, waiting for dispatcher")
    const failed = message("a", { reason: "too long", state: "failed" })
    expect(statusLine(failed, opts)).toBe("Failed: too long")
  })

  // The time heads the message, so the footer says only where it is; when it arrived is the footer's hover.
  test("a delivered message says so with no time", () => {
    const delivered = message("a", { deliveredAt: "2026-10-06T19:37:04.000Z", state: "delivered" })
    expect(statusLine(delivered, opts)).toBe("Delivered")
  })
})

// A loader, then one tick, then two, in one fixed slot so nothing shifts.
test("statusMark draws each state as one mark: a spinner on its way, a tick once typed, two once delivered", () => {
  expect(statusMark("queued")).toBe("sending")
  expect(statusMark("sending")).toBe("sending")
  expect(statusMark("typed")).toBe("sent")
  expect(statusMark("delivered")).toBe("delivered")
  expect(statusMark("failed")).toBe("failed")
})

// A message ending in one backslash never submits: Claude Code reads a trailing \ before Enter as a line continuation, so the text sat in the session's input and its bubble waited as Queued. The composer drops it before the send. The end is judged trimmed, since the API's own normalize trims the ends before typing (a review's round 1).
describe("submittable", () => {
  test("drops one trailing backslash, the one Enter would take as a line continuation", () => {
    expect(submittable("show 4667 link\\")).toBe("show 4667 link")
    expect(submittable("show 4667 link")).toBe("show 4667 link")
    expect(submittable("ends in two\\\\")).toBe("ends in two\\")
    expect(submittable("")).toBe("")
    expect(submittable("line one\nline two\\")).toBe("line one\nline two")
  })

  test("drops it past the spaces and the new line the typing would trim away", () => {
    expect(submittable("show link\\ ")).toBe("show link")
    expect(submittable("show link\\\n")).toBe("show link")
    expect(submittable("show link")).toBe("show link")
  })

  // The composer refuses on comparable(words), the words as the typing will hold them: a drop that only a further trim would bring back to a backslash (x\ \ types as x\) is refused, not sent (a review's round 2).
  test("the refusal's judge still sees a backslash the typing would keep", () => {
    expect(comparable(submittable("x\\ \\"))).toMatch(/\\$/)
    expect(comparable(submittable("x\\ \\\n"))).toMatch(/\\$/)
    expect(comparable(submittable("show link"))).not.toMatch(/\\$/)
  })
})

test("waiting lists a session's messages still on their way", () => {
  const messages = [
    message("a", { state: "delivered" }),
    message("b", { state: "typed" }),
    message("c"),
    message("d", { state: "failed" }),
    message("e", { to: "builder" }),
  ]
  expect(waiting(messages, "dispatcher").map((m) => m.id)).toEqual(["b", "c"])
  // an Undo's marker shows no bubble, so the composer does not count it
  expect(waiting([message("u", { text: UNSENT_MARKER })], "dispatcher")).toEqual([])
})

describe("typedHeld", () => {
  const typed = Date.parse(T0)
  test("a typed state under the hold keeps Dismiss back", () => {
    expect(typedHeld(T0, typed + 500)).toBe(false)
  })
  test("the hold's end and after show it", () => {
    expect(typedHeld(T0, typed + TYPED_HOLD_MS)).toBe(true)
    expect(typedHeld(T0, typed + TYPED_HOLD_MS + 1)).toBe(true)
  })
  test("an unknown typedAt holds nothing back", () => {
    expect(typedHeld(null, typed)).toBe(true)
  })
})

// The ticks survive a reload: a reload keeps only unsent records, so a message the transcript holds is delivered on its own word.
describe("deliveredAt", () => {
  test("his message the transcript holds reads delivered at its transcript time once a reload has dropped its record", () => {
    expect(deliveredAt({ at: T0, peer: false, sent: null })).toBe(T0)
  })
  test("the outbox's own time wins while the tab still holds the record", () => {
    const sent = message("a", { deliveredAt: "2026-10-06T19:37:04.000Z", state: "delivered" })
    expect(deliveredAt({ at: T0, peer: false, sent })).toBe("2026-10-06T19:37:04.000Z")
  })
  test("another session's message is never his to tick", () => {
    expect(deliveredAt({ at: T0, peer: true, sent: null })).toBeNull()
  })
})

describe("undo", () => {
  const delivered = message("a", { deliveredAt: T0, state: "delivered" })
  const at = (ms: number) => Date.parse(T0) + ms

  test("his newest message offers Undo for two minutes after it arrived, and then nothing", () => {
    const base = { marker: null, newest: true, sent: delivered, unsent: false, waiting: false }
    expect(undoState({ ...base, now: at(UNDO_MS - 1) })).toEqual({ kind: "undo" })
    expect(undoState({ ...base, now: at(UNDO_MS) })).toBeNull()
    expect(undoState({ ...base, newest: false, now: at(0) })).toBeNull()
    expect(undoState({ ...base, now: at(0), sent: message("q") })).toBeNull()
    expect(undoState({ ...base, now: at(0), sent: null })).toBeNull()
  })

  test("an undo on its way reads Unsending, a failed one says so, and the transcript's word is Unsent", () => {
    const base = { newest: true, now: at(0), sent: delivered, unsent: false, waiting: false }
    for (const state of ["queued", "sending", "typed", "delivered"] as const) {
      const marker = message("u", { state })
      expect(undoState({ ...base, marker })).toEqual({ kind: "unsending", marker })
    }
    const failed = message("u", { code: "ON_PICKER", reason: "on a picker", state: "failed" })
    expect(undoState({ ...base, marker: failed })).toEqual({
      kind: "failed",
      marker: failed,
      retry: true,
    })
    // a retry now would land after the message waiting behind it, and take that one back instead
    expect(undoState({ ...base, marker: failed, waiting: true })).toEqual({
      kind: "failed",
      marker: failed,
      retry: false,
    })
    const refused = message("u", { code: "TOO_LONG", reason: "too long", state: "failed" })
    expect(undoState({ ...base, marker: refused })).toMatchObject({ retry: false })
    expect(undoState({ ...base, marker: null, now: at(UNDO_MS * 10), unsent: true })).toEqual({
      kind: "unsent",
    })
  })

  test("no Undo while another message to the session waits, since the marker would land after it and take it back instead", () => {
    const base = { marker: null, newest: true, now: at(0), sent: delivered, unsent: false }
    expect(undoState({ ...base, waiting: true })).toBeNull()
    expect(undoState({ ...base, waiting: false })).toEqual({ kind: "undo" })
  })

  test("every message of his not yet in the transcript counts as waiting, a failed one included, since its fate may be unknown; Undo's own markers do not", () => {
    expect(othersWaiting([message("d", { state: "delivered" })])).toBe(false)
    for (const state of ["queued", "sending", "typed", "failed"] as const) {
      expect(othersWaiting([message("b", { state })])).toBe(true)
    }
    expect(othersWaiting([message("u", { state: "queued", text: UNSENT_MARKER })])).toBe(false)
  })

  test("a message's undo is the newest marker sent for it: after it arrived and before the next of his arrived, never his own words", () => {
    const a = message("a", { deliveredAt: T0, state: "delivered" })
    const old = message("u1", { at: "2026-10-05T23:59:00.000Z", text: UNSENT_MARKER })
    const first = message("u2", { at: "2026-10-06T00:00:10.000Z", text: UNSENT_MARKER })
    const second = message("u3", { at: "2026-10-06T00:00:20.000Z", text: UNSENT_MARKER })
    // sent after the marker, so the marker stays A's whatever C does
    const c = message("c", { at: "2026-10-06T00:00:30.000Z", text: "ignore that" })
    expect(undoOf([a, old, first, second, c], a)?.id).toBe("u3")
    expect(undoOf([a, old, c], a)).toBeNull()
    // C delivered, then an undo for C: that marker is C's, not A's
    const cDelivered = {
      ...c,
      deliveredAt: "2026-10-06T00:00:40.000Z",
      state: "delivered" as const,
    }
    const forC = message("u4", { at: "2026-10-06T00:00:50.000Z", text: UNSENT_MARKER })
    expect(undoOf([a, first, cDelivered, forC], a)?.id).toBe("u2")
    expect(undoOf([a, first, cDelivered, forC], cDelivered)?.id).toBe("u4")
  })

  test("an undo on its way stays on the message it was sent for after a newer message is sent, so it can be unsent", () => {
    const marker = message("u", { state: "queued", text: UNSENT_MARKER })
    const base = { newest: false, now: at(0), sent: delivered, unsent: false, waiting: true }
    expect(undoState({ ...base, marker })).toEqual({ kind: "unsending", marker })
    const failed = { ...marker, code: "ON_PICKER", state: "failed" as const }
    expect(undoState({ ...base, marker: failed })).toEqual({
      kind: "failed",
      marker: failed,
      retry: false,
    })
    // C has landed and nothing waits, but a retry would land after C and take C back instead
    expect(undoState({ ...base, marker: failed, waiting: false })).toEqual({
      kind: "failed",
      marker: failed,
      retry: false,
    })
  })
})

describe("resumable", () => {
  test("a kept message comes back queued to go at once, its counts kept and its file's dead preview dropped", () => {
    const kept = message("a", {
      attachments: [{ id: "f.png", kind: "image", name: "f.png", previewUrl: "blob:x", size: 5 }],
      attempts: 3,
      code: "NETWORK_ERROR",
      reason: "the server did not answer",
      retryAt: 99,
      state: "sending",
      unanswered: true,
      unreached: 3,
    })
    expect(resumable(JSON.parse(JSON.stringify([kept])))).toEqual([
      {
        ...kept,
        attachments: [{ id: "f.png", kind: "image", name: "f.png", previewUrl: null, size: 5 }],
        retryAt: null,
        state: "queued",
      },
    ])
  })

  test("a message sent from a thread's view resumes filed under its thread", () => {
    const kept = message("t", { threadId: "k7mq" })
    expect(resumable(JSON.parse(JSON.stringify([kept])))[0]?.threadId).toBe("k7mq")
    expect(resumable([message("u")])[0]).not.toHaveProperty("threadId")
  })

  test("anything not shaped as a message is dropped, and an older record's missing counts read as none", () => {
    const { unreached: _, ...older } = message("b")
    const badFile = { ...message("c"), attachments: [{ id: "x", kind: "zip", name: "x", size: 1 }] }
    expect(resumable(null)).toEqual([])
    expect(
      resumable([null, 1, { id: "d" }, badFile, older]).map((m) => [m.id, m.unreached]),
    ).toEqual([["b", 0]])
  })

  // The fix ships on a roll, a restart that reloads the page, so a record the build before it saved, with no mark, still resumes known to be maybe landed when its tries went unanswered.
  test("an older record with unanswered tries resumes marked as maybe landed", () => {
    const { unanswered: _, ...older } = message("e", { code: "NETWORK_ERROR", unreached: 3 })
    const { unanswered: __, ...answered } = message("f", { code: "ON_PICKER" })
    const { unanswered: ___, ...outOnFirstTry } = message("g", { state: "sending" })
    expect(resumable([older, answered, outOnFirstTry]).map((m) => [m.id, m.unanswered])).toEqual([
      ["e", true],
      ["f", false],
      ["g", true],
    ])
  })
})

describe("sentSince", () => {
  test("is true once a message joins the outbox, and not for messages already seen or one leaving it", () => {
    const seen = new Set(["a", "b"])
    expect(sentSince(seen, [{ id: "a" }, { id: "b" }, { id: "c" }])).toBe(true)
    expect(sentSince(seen, [{ id: "a" }, { id: "b" }])).toBe(false)
    expect(sentSince(seen, [{ id: "a" }])).toBe(false)
    expect(sentSince(new Set(), [])).toBe(false)
  })
})
