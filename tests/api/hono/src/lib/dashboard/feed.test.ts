import { describe, expect, test } from "bun:test"

import type { FeedReply } from "../../../../../../api/hono/src/lib/dashboard/cmux"
import {
  answerFeed,
  answerSummary,
  canApprove,
  replyFor,
  type AnswerDeps,
  type FeedAnswer,
} from "../../../../../../api/hono/src/lib/dashboard/feed"
import type { KeyStep } from "../../../../../../api/hono/src/lib/dashboard/herdr"
import { feedBySession, type Live } from "../../../../../../api/hono/src/lib/dashboard/workers"
import {
  PERMISSION_ID,
  permissionItem,
  PLAN_ID,
  planItem,
  QUESTION_ID,
  questionItem,
  TWO_QUESTION_ID,
  twoQuestionItem,
} from "./feed-fixtures"

const actor = { email: "owner@local.host", id: "u-1" }
const owner = { role: "owner" }

// A live board of sessions s-1 (dispatcher) and s-2 (builder) and a Feed a reply clears, unless `stuck` keeps the item waiting as cmux would for an id it does not know.
function fakes(
  items: Record<string, unknown>[],
  options: { approvals?: boolean; stuck?: boolean } = {},
) {
  let pending = [...items]
  const replies: FeedReply[] = []
  const recorded: string[] = []
  const live = (): Live => {
    const feed = feedBySession({ items: pending })
    return {
      surfaces: new Map(),
      transcripts: new Map(),
      workers: [
        { feed: feed.get("s-1") ?? [], name: "dispatcher", sessionId: "s-1" },
        { feed: feed.get("s-2") ?? [], name: "builder", sessionId: "s-2" },
      ] as unknown as Live["workers"],
    }
  }
  const deps: AnswerDeps = {
    approvals: options.approvals ?? false,
    listLive: async () => live(),
    now: () => new Date("2026-10-06T03:00:00.000Z"),
    readFeed: async () => ({ items: pending }),
    record: async (event, replying) => {
      await replying()
      recorded.push(event.summary)
    },
    reply: async (reply) => {
      replies.push(reply)
      if (!options.stuck) pending = pending.filter((i) => i.request_id !== reply.requestId)
    },
    settle: { attempts: 3, delayMs: 1 },
  }
  return { deps, recorded, replies }
}

const ask = (answer: FeedAnswer, requestId = QUESTION_ID, sessionId = "s-1", approver = owner) => ({
  actor,
  answer,
  approver,
  requestId,
  sessionId,
})

const red: FeedAnswer = { answers: [{ choices: ["Red"], text: null }], kind: "question" }
const deny: FeedAnswer = { kind: "permission", mode: "deny" }
const once: FeedAnswer = { kind: "permission", mode: "once" }

describe("answerFeed", () => {
  test("a picker's answer goes as its selections, is recorded, and lands once the prompt leaves the Feed", async () => {
    const { deps, recorded, replies } = fakes([questionItem("s-1")])
    expect(await answerFeed(ask(red), deps)).toEqual({ at: "2026-10-06T03:00:00.000Z", ok: true })
    expect(replies).toEqual([{ kind: "question", requestId: QUESTION_ID, selections: ["Red"] }])
    expect(recorded).toEqual(["Answered dispatcher's picker (1 question)"])
  })

  test("the person's own words stand in for a choice", async () => {
    const { deps, replies } = fakes([questionItem("s-1")])
    const words: FeedAnswer = {
      answers: [{ choices: [], text: "  green, please\t" }],
      kind: "question",
    }
    expect((await answerFeed(ask(words), deps)).ok).toBe(true)
    expect(replies[0]).toMatchObject({ selections: ["green, please"] })
  })

  test("only the owner may answer, before cmux is read", async () => {
    const { deps, replies } = fakes([questionItem("s-1")])
    let read = false
    deps.listLive = async () => {
      read = true
      return { surfaces: new Map(), transcripts: new Map(), workers: [] }
    }
    const admin = await answerFeed(ask(red, QUESTION_ID, "s-1", { role: "admin" }), deps)
    expect(admin).toMatchObject({ code: "FORBIDDEN" })
    expect(read).toBe(false)
    expect(replies).toEqual([])
  })

  // cmux answers delivered:true even for an id it does not know, so only the Feed read before the reply says the prompt waits on that session.
  test("a prompt that waits on another live session, or a session that is not live, gets no reply", async () => {
    const { deps, replies } = fakes([questionItem("s-1"), permissionItem("s-2")])
    expect(await answerFeed(ask(red, QUESTION_ID, "s-2"), deps)).toMatchObject({
      code: "NOT_PENDING",
    })
    expect(await answerFeed(ask(red, PLAN_ID), deps)).toMatchObject({ code: "NOT_PENDING" })
    expect(await answerFeed(ask(red, QUESTION_ID, "s-9"), deps)).toMatchObject({
      code: "NOT_FOUND",
    })
    expect(replies).toEqual([])
  })

  // The Feed's own item decides whether approvals are needed, so an answer that calls itself a question cannot reach a permission.
  test("a question-kind answer aimed at a permission is refused while approvals are off", async () => {
    const { deps, replies } = fakes([permissionItem("s-1")])
    expect(await answerFeed(ask(red, PERMISSION_ID), deps)).toMatchObject({ code: "DISABLED" })
    expect(replies).toEqual([])
  })

  test("permission and plan answers are refused while approvals are off", async () => {
    const { deps, replies } = fakes([permissionItem("s-1"), planItem("s-1")])
    expect(await answerFeed(ask(deny, PERMISSION_ID), deps)).toMatchObject({ code: "DISABLED" })
    const back: FeedAnswer = { feedback: null, kind: "plan", mode: "deny" }
    expect(await answerFeed(ask(back, PLAN_ID), deps)).toMatchObject({ code: "DISABLED" })
    expect(replies).toEqual([])
  })

  test("with approvals on, a permission is denied or allowed once, and a plan approved or sent back with its note", async () => {
    const approve = fakes([permissionItem("s-1"), planItem("s-1")], { approvals: true })
    expect((await answerFeed(ask(once, PERMISSION_ID), approve.deps)).ok).toBe(true)
    const start: FeedAnswer = { feedback: null, kind: "plan", mode: "manual" }
    expect((await answerFeed(ask(start, PLAN_ID), approve.deps)).ok).toBe(true)
    expect(approve.replies).toEqual([
      { kind: "permission", mode: "once", requestId: PERMISSION_ID },
      { feedback: null, kind: "plan", mode: "manual", requestId: PLAN_ID },
    ])
    expect(approve.recorded).toEqual([
      "Allowed dispatcher to run Bash once",
      "Approved dispatcher's plan",
    ])
    const refuse = fakes([permissionItem("s-1"), planItem("s-1")], { approvals: true })
    expect((await answerFeed(ask(deny, PERMISSION_ID), refuse.deps)).ok).toBe(true)
    const back: FeedAnswer = { feedback: "use a branch", kind: "plan", mode: "deny" }
    expect((await answerFeed(ask(back, PLAN_ID), refuse.deps)).ok).toBe(true)
    expect(refuse.recorded).toEqual([
      "Denied dispatcher's request to run Bash",
      "Sent back dispatcher's plan with a note of 12 characters",
    ])
  })

  test("a reply cmux takes while the prompt still waits is NOT_TAKEN", async () => {
    const { deps, replies } = fakes([questionItem("s-1")], { stuck: true })
    expect(await answerFeed(ask(red), deps)).toMatchObject({ code: "NOT_TAKEN", ok: false })
    expect(replies).toHaveLength(1)
  })

  test("a reply whose landing cannot be read is UNCONFIRMED, never a bare error", async () => {
    const { deps, replies } = fakes([questionItem("s-1")])
    deps.readFeed = async () => {
      throw new Error("cmux rpc failed")
    }
    expect(await answerFeed(ask(red), deps)).toMatchObject({ code: "UNCONFIRMED", ok: false })
    expect(replies).toHaveLength(1)
  })

  test("cmux unreadable before the reply is CMUX_FAILED, and nothing is sent", async () => {
    const { deps, replies } = fakes([questionItem("s-1")])
    deps.listLive = async () => {
      throw new Error("cmux sessions failed")
    }
    expect(await answerFeed(ask(red), deps)).toMatchObject({ code: "CMUX_FAILED" })
    expect(replies).toEqual([])
  })

  test("a reply cmux refuses leaves no activity row, and says whether it may have landed", async () => {
    const refusedOutright = fakes([questionItem("s-1")])
    refusedOutright.deps.reply = async () => {
      throw new Error("socket closed")
    }
    const failed = await answerFeed(ask(red), refusedOutright.deps)
    expect(failed).toMatchObject({ code: "CMUX_FAILED", ok: false })
    expect(failed.ok ? "" : failed.reason).toContain("may not have gone through: socket closed")
    expect(refusedOutright.recorded).toEqual([])
    // A reply cmux timed out on can still land: the prompt gone from the Feed says it may have.
    const timedOut = fakes([questionItem("s-1")])
    timedOut.deps.reply = async () => {
      timedOut.deps.readFeed = async () => ({ items: [] })
      throw new Error("timed out")
    }
    expect(await answerFeed(ask(red), timedOut.deps)).toMatchObject({ code: "UNCONFIRMED" })
  })

  test("a record that cannot be written throws, and nothing is answered", async () => {
    const { deps, replies } = fakes([questionItem("s-1")])
    deps.record = async () => {
      throw new Error("database down")
    }
    await expect(answerFeed(ask(red), deps)).rejects.toThrow("database down")
    expect(replies).toEqual([])
  })

  test("one prompt is answered once at a time, and is free again after a throw or a refusal", async () => {
    const { deps, replies } = fakes([questionItem("s-1")], { stuck: true })
    const [first, second] = await Promise.all([
      answerFeed(ask(red), deps),
      answerFeed(ask(red), deps),
    ])
    expect(first).toMatchObject({ code: "NOT_TAKEN" })
    expect(second).toMatchObject({ code: "BUSY" })
    expect((await answerFeed(ask(red), deps)).ok).toBe(false)
    expect(replies).toHaveLength(2)
    const record = deps.record
    deps.record = async () => {
      throw new Error("database down")
    }
    await expect(answerFeed(ask(red), deps)).rejects.toThrow("database down")
    deps.record = record
    expect(await answerFeed(ask(red), deps)).not.toMatchObject({ code: "BUSY" })
  })
})

describe("replyFor", () => {
  const item = feedBySession({ items: [questionItem("s-1")] }).get("s-1")![0]!
  const multi = feedBySession({
    items: [
      {
        ...questionItem("s-1"),
        questions: [{ ...questionItem("s-1").questions[0], multi_select: true }],
      },
    ],
  }).get("s-1")![0]!
  const answers = (choices: string[], text: string | null): FeedAnswer => ({
    answers: [{ choices, text }],
    kind: "question",
  })

  test("an answer that does not fit the picker is INVALID", () => {
    expect(replyFor(item, answers(["Green"], null))).toMatchObject({ code: "INVALID" })
    expect(replyFor(item, answers([""], null))).toMatchObject({ code: "INVALID" })
    expect(replyFor(item, answers(["Red", "Blue"], null))).toMatchObject({ code: "INVALID" })
    expect(replyFor(item, answers(["Red"], "and words"))).toMatchObject({ code: "INVALID" })
    expect(replyFor(item, answers([], "  "))).toMatchObject({ code: "INVALID" })
    expect(replyFor(item, { answers: [], kind: "question" })).toMatchObject({ code: "INVALID" })
    expect(replyFor(item, deny)).toMatchObject({ code: "INVALID" })
  })

  test("a multi-select's choices go once each, in the picker's order, joined as the Feed reads them", () => {
    expect(replyFor(multi, answers(["Blue", "Red", "Red"], null))).toEqual({
      kind: "question",
      requestId: QUESTION_ID,
      selections: ["Red, Blue"],
    })
  })

  // A permission is allowed only when the card could show all of what the tool would do; it can always be denied.
  test("a permission cut short, or with nothing to show, cannot be allowed from here", () => {
    const long = feedBySession({
      items: [
        {
          ...permissionItem("s-1"),
          tool_input: JSON.stringify({ content: "y".repeat(7000), file_path: "/x" }),
        },
      ],
    }).get("s-1")![0]!
    expect(replyFor(long, once)).toMatchObject({ code: "INVALID" })
    expect(replyFor(long, deny)).toMatchObject({ kind: "permission", mode: "deny" })
    const blank = feedBySession({
      items: [{ ...permissionItem("s-1"), tool_input: undefined }],
    }).get("s-1")![0]!
    expect(replyFor(blank, once)).toMatchObject({ code: "INVALID" })
    expect(replyFor(blank, deny)).toMatchObject({ mode: "deny" })
  })

  // A plan is approved only when the card could show all of it.
  test("a plan cut short, or empty, cannot be started from here", () => {
    const start: FeedAnswer = { feedback: null, kind: "plan", mode: "manual" }
    const clipped = feedBySession({
      items: [{ ...planItem("s-1"), plan: JSON.stringify({ plan: "z".repeat(9000) }) }],
    }).get("s-1")![0]!
    expect(replyFor(clipped, start)).toMatchObject({ code: "INVALID" })
    const empty = feedBySession({ items: [{ ...planItem("s-1"), plan: "" }] }).get("s-1")![0]!
    expect(replyFor(empty, start)).toMatchObject({ code: "INVALID" })
    expect(replyFor(clipped, { feedback: null, kind: "plan", mode: "deny" })).toMatchObject({
      kind: "plan",
      mode: "deny",
    })
  })
})

describe("the activity row", () => {
  const plan = feedBySession({ items: [planItem("s-1")] }).get("s-1")![0]!
  const permission = feedBySession({ items: [permissionItem("s-1")] }).get("s-1")![0]!

  test("names what was answered, never with what words or command", () => {
    const note = answerSummary("dispatcher", plan, {
      feedback: "the secret is hunter2",
      kind: "plan",
      mode: "deny",
    })
    expect(note).toBe("Sent back dispatcher's plan with a note of 21 characters")
    const allowed = answerSummary("dispatcher", permission, once)
    expect(allowed).toBe("Allowed dispatcher to run Bash once")
    expect(allowed).not.toContain("touch")
  })

  test("a tool with no trusted name reads as a tool", () => {
    const unnamed = { ...permission, tool: "" }
    expect(answerSummary("dispatcher", unnamed, deny)).toBe(
      "Denied dispatcher's request to run a tool",
    )
  })
})

test("only the owner may answer, until a login only Merritt can use narrows it", () => {
  expect(canApprove({ role: "owner" })).toBe(true)
  expect(canApprove({ role: "admin" })).toBe(false)
  expect(canApprove({ banned: true, role: "owner" })).toBe(false)
})

// a herdr session's prompt, answered by keys into its pane: the screens it shows before and after them.
const PICKER = "Pick a color?\n\n❯ 1. Red\n  2. Blue\n  3. Type something.\n  4. Chat about this"
const EXTRAS =
  "Add anything else?\n❯ 1. [ ] Foam\n  2. [ ] Shot\n  3. [ ] No sugar\n  4. [ ] Type something\n  5. Submit"
const REVIEW =
  "Review your answers\nReady to submit your answers?\n❯ 1. Submit answers\n  2. Cancel"
const PERMISSION = [
  " Bash command",
  "   touch /tmp/scratch/denied-marker",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and don't ask again",
  "   3. No, and tell Claude what to do differently (esc)",
].join("\n")
const DONE = "● Red it is.\n\n> "

// A board whose s-1 runs in herdr at herdr:probes:w1:p1, and a pane whose screens `next` gives, one a read (the last kept); each Enter or number key moves it on, as Claude Code does.
function herdrFakes(items: Record<string, unknown>[], screens: string[], approvals = false) {
  const { deps, recorded, replies } = fakes(items, { approvals })
  const board = deps.listLive
  deps.listLive = async () => {
    const live = await board()
    return {
      ...live,
      workers: live.workers.map((w) =>
        w.sessionId === "s-1" ? { ...w, herdr: true as const, surface: "herdr:probes:w1:p1" } : w,
      ),
    }
  }
  const typed: KeyStep[][] = []
  const reads: string[] = []
  let at = 0
  deps.herdr = {
    read: async (surface) => {
      reads.push(surface)
      return screens[Math.min(at, screens.length - 1)] ?? ""
    },
    settle: { attempts: 3, delayMs: 1 },
    type: async (_, keys) => {
      typed.push(keys)
      if (keys.some((k) => "key" in k && k.key !== "down" && k.key !== "up" && k.key !== "space"))
        at++
    },
  }
  return { deps, reads, recorded, replies, typed }
}

describe("answerFeed for a herdr session", () => {
  test("a picker's answer goes as keys into its pane, is recorded, and lands once the prompt leaves it", async () => {
    const { deps, reads, recorded, replies, typed } = herdrFakes(
      [questionItem("s-1")],
      [PICKER, DONE],
    )
    const blue: FeedAnswer = { answers: [{ choices: ["Blue"], text: null }], kind: "question" }
    expect(await answerFeed(ask(blue), deps)).toEqual({ at: "2026-10-06T03:00:00.000Z", ok: true })
    expect(typed).toEqual([[{ key: "down" }, { key: "enter" }]])
    expect(reads[0]).toBe("herdr:probes:w1:p1")
    expect(recorded).toEqual(["Answered dispatcher's picker (1 question)"])
    expect(replies).toEqual([])
  })

  test("each question of a picker in turn, then its Submit", async () => {
    const { deps, typed } = herdrFakes([twoQuestionItem("s-1")], [PICKER, EXTRAS, REVIEW, DONE])
    const both: FeedAnswer = {
      answers: [
        { choices: ["Red"], text: null },
        { choices: ["Shot"], text: null },
      ],
      kind: "question",
    }
    expect(await answerFeed(ask(both, TWO_QUESTION_ID), deps)).toMatchObject({ ok: true })
    expect(typed).toEqual([
      [{ key: "enter" }],
      [
        { key: "down" },
        { key: "space" },
        { key: "down" },
        { key: "down" },
        { key: "down" },
        { key: "enter" },
      ],
      [{ key: "1" }],
    ])
  })

  test("a pane that no longer shows the prompt gets no key and no record", async () => {
    const { deps, recorded, typed } = herdrFakes(
      [questionItem("s-1")],
      [PICKER.replace("Pick a color?", "Pick a size?")],
    )
    expect(await answerFeed(ask(red), deps)).toMatchObject({ code: "NOT_PENDING", ok: false })
    expect(typed).toEqual([])
    expect(recorded).toEqual([])
  })

  test("own words whose Enter did not land read INTERRUPTED, though the words now show in the last row", async () => {
    const typedIn = PICKER.replace("3. Type something.", "3. teal please")
    const { deps } = herdrFakes([questionItem("s-1")], [PICKER, typedIn])
    const teal: FeedAnswer = { answers: [{ choices: [], text: "teal please" }], kind: "question" }
    expect(await answerFeed(ask(teal), deps)).toMatchObject({ code: "INTERRUPTED", ok: false })
  })

  test("keys that leave the prompt on screen read INTERRUPTED, with the attempt recorded", async () => {
    const { deps, recorded, typed } = herdrFakes([questionItem("s-1")], [PICKER])
    deps.herdr = { ...deps.herdr!, type: async (_, keys) => void typed.push(keys) }
    expect(await answerFeed(ask(red), deps)).toMatchObject({ code: "INTERRUPTED", ok: false })
    expect(typed).toEqual([[{ key: "enter" }]])
    expect(recorded).toEqual(["Answered dispatcher's picker (1 question)"])
  })

  test("a pane that cannot be read before the keys types nothing; after them, the answer is unconfirmed", async () => {
    const before = herdrFakes([questionItem("s-1")], [PICKER])
    before.deps.herdr = {
      ...before.deps.herdr!,
      read: async () => {
        throw new Error("scrolled")
      },
    }
    expect(await answerFeed(ask(red), before.deps)).toMatchObject({ code: "CMUX_FAILED" })
    expect(before.typed).toEqual([])
    const after = herdrFakes([questionItem("s-1")], [PICKER])
    let reads = 0
    after.deps.herdr = {
      ...after.deps.herdr!,
      read: async () => {
        if (reads++ > 0) throw new Error("gone")
        return PICKER
      },
    }
    expect(await answerFeed(ask(red), after.deps)).toMatchObject({ code: "UNCONFIRMED" })
  })

  test("a permission or a plan is answered in its terminal alone: nothing is read, typed or recorded, whatever approvals say", async () => {
    const plan: FeedAnswer = { feedback: null, kind: "plan", mode: "manual" }
    const on = herdrFakes([permissionItem("s-1"), planItem("s-1")], [PERMISSION, DONE], true)
    expect(await answerFeed(ask(deny, PERMISSION_ID), on.deps)).toMatchObject({
      code: "TERMINAL_ONLY",
      ok: false,
    })
    expect(await answerFeed(ask(plan, PLAN_ID), on.deps)).toMatchObject({ code: "TERMINAL_ONLY" })
    const off = herdrFakes([permissionItem("s-1"), planItem("s-1")], [PERMISSION, DONE])
    expect(await answerFeed(ask(once, PERMISSION_ID), off.deps)).toMatchObject({ code: "DISABLED" })
    expect(await answerFeed(ask(plan, PLAN_ID), off.deps)).toMatchObject({ code: "DISABLED" })
    for (const { reads, recorded, typed } of [on, off]) {
      expect(reads).toEqual([])
      expect(typed).toEqual([])
      expect(recorded).toEqual([])
    }
  })
})
