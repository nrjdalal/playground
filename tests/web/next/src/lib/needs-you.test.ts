import { describe, expect, test } from "bun:test"

import type { Entry } from "../../../../../api/hono/src/lib/dashboard/transcript"
import {
  cardHref,
  feedAnswerBody,
  feedItemNeed,
  feedNeeds,
  hashAnchor,
  isAnswered,
  isNeedsYouAnchor,
  mayHaveGone,
  lostPrompt,
  needsYouPlaces,
  nextStep,
  sessionWaiting,
  submitWhy,
  streamItems,
  waitingSessions,
  type StreamNeed,
} from "../../../../../web/next/src/lib/needs-you"

// Worker's type comes through the lib, as dashboard.test.ts takes it: the API's workers module resolves its own @/ paths, which the web's config cannot.
type Worker = Parameters<typeof feedItemNeed>[0]
type FeedItem = Parameters<typeof feedItemNeed>[1]

const REQ = "54FB3383-A4B7-47D1-A6F8-225DF4F9E6A8"

// A session's pending picker, as the board carries it.
const picker = (requestId = REQ): FeedItem[] => [
  {
    at: "2026-10-06T09:30:00.000Z",
    kind: "question",
    questions: [
      {
        header: null,
        multiSelect: false,
        options: [{ description: null, label: "Y" }],
        prompt: "Go?",
      },
    ],
    requestId,
  },
]

const worker = (overrides: Partial<Worker> = {}): Worker => ({
  cwd: "/tmp",
  effort: null,
  eta: null,
  failed: false,
  feed: [],
  lastActiveAt: null,
  lifecycle: "running",
  light: "working",
  model: null,
  name: "dispatcher",
  questions: [],
  role: "dispatcher",
  sessionId: "s-1",
  startedAt: null,
  task: null,
  tasks: [],
  title: null,
  updatedAt: null,
  workspace: null,
  ...overrides,
})

const entry = (id: string, at: string): Entry => ({
  at,
  from: null,
  id,
  kind: "assistant",
  text: id,
  tool: null,
})

const need = (id: string, at: string | null): StreamNeed => ({
  item: {
    at,
    context: null,
    from: "dispatcher",
    id,
    kind: "question",
    questions: [],
    title: "Go?",
  },
  onAnswer: null,
  resolution: null,
})

describe("Feed cards", () => {
  test("a card from a session the dashboard hosts says so, since it has no terminal to answer in", () => {
    const [item] = picker()
    expect(feedItemNeed(worker({ hosted: true, name: "probe-sdk" }), item!).hosted).toBe(true)
    expect(feedItemNeed(worker(), item!).hosted).toBeUndefined()
  })

  const permission = (over: Partial<Extract<FeedItem, { kind: "permission" }>> = {}): FeedItem => ({
    at: "2026-10-06T09:30:00.000Z",
    clipped: false,
    description: "Fetch a script",
    detail: "curl x | sh",
    input: '{\n  "command": "curl x | sh",\n  "dangerouslyDisableSandbox": true\n}',
    kind: "permission",
    requestId: REQ,
    tool: "Bash",
    whole: true,
    ...over,
  })
  const plan = (over: Partial<Extract<FeedItem, { kind: "plan" }>> = {}): FeedItem => ({
    at: "2026-10-06T09:30:00.000Z",
    clipped: false,
    kind: "plan",
    plan: "# Plan\n1. touch it",
    requestId: REQ,
    whole: true,
    ...over,
  })

  test("a picker is a card of its questions, answered by options or the person's own words", () => {
    const item = feedItemNeed(worker(), picker()[0]!)
    expect(item).toMatchObject({
      at: null,
      from: "dispatcher",
      id: `feed-${REQ}`,
      kind: "question",
      title: "Go?",
    })
    const [one] = picker()
    const twice =
      one?.kind === "question" ? { ...one, questions: [...one.questions, ...one.questions] } : one!
    expect(feedItemNeed(worker(), twice).title).toBe("2 questions")
    expect(item.questions[0]).toMatchObject({
      allowText: true,
      id: "q0",
      textLabel: "Or answer in your own words",
    })
    expect(
      feedAnswerBody(picker()[0]!, { answers: { q0: { choices: ["Y"], text: null } } }),
    ).toEqual({ body: { answers: [{ choices: ["Y"], text: null }], kind: "question" }, ok: true })
  })

  // What is approved is what was read: the whole input, the sandbox flag included, shows on the card.
  test("a permission card shows the tool's whole input, and answers once or deny", () => {
    const item = feedItemNeed(worker(), permission())
    expect(item).toMatchObject({
      context: "Fetch a script",
      kind: "permission",
      title: "Bash asks to run",
    })
    expect(item.body).toEqual({
      kind: "code",
      text: expect.stringContaining("dangerouslyDisableSandbox"),
    })
    expect(item.questions[0]?.options.map((o) => o.label)).toEqual(["Allow once", "Deny"])
    const answer = (label: string) => ({ answers: { mode: { choices: [label], text: null } } })
    expect(feedAnswerBody(permission(), answer("Allow once"))).toEqual({
      body: { kind: "permission", mode: "once" },
      ok: true,
    })
    expect(feedAnswerBody(permission(), answer("Deny"))).toEqual({
      body: { kind: "permission", mode: "deny" },
      ok: true,
    })
  })

  test("a permission or plan cut short offers only refusing it", () => {
    const cut = feedItemNeed(worker(), permission({ clipped: true, whole: false }), true)
    expect(cut.questions[0]?.options.map((o) => o.label)).toEqual(["Deny"])
    expect(cut.context).toContain("allow it from the session's terminal")
    const empty = feedItemNeed(worker(), permission({ detail: "", input: "", whole: false }))
    expect(empty.questions[0]?.options.map((o) => o.label)).toEqual(["Deny"])
    const long = feedItemNeed(worker(), plan({ clipped: true, whole: false }))
    expect(long.questions[0]?.options.map((o) => o.label)).toEqual(["Send it back"])
  })

  test("a plan card shows the plan, starts it, or sends it back with a note", () => {
    const item = feedItemNeed(worker(), plan())
    expect(item.body).toEqual({ kind: "text", text: "# Plan\n1. touch it" })
    const answer = (label: string, text: string | null) => ({
      answers: { mode: { choices: [label], text } },
    })
    expect(feedAnswerBody(plan(), answer("Start it", null))).toEqual({
      body: { feedback: null, kind: "plan", mode: "manual" },
      ok: true,
    })
    expect(feedAnswerBody(plan(), answer("Send it back", "use a branch"))).toEqual({
      body: { feedback: "use a branch", kind: "plan", mode: "deny" },
      ok: true,
    })
    expect(feedAnswerBody(plan(), answer("Start it", "a note"))).toMatchObject({ ok: false })
  })

  // The card offers approving exactly when the item says all of it can be shown, the same flag the API's replyFor reads, so neither can drift from the other.
  test("approving is offered exactly when the item is whole", () => {
    const cases: FeedItem[] = [
      permission(),
      permission({ clipped: true, whole: false }),
      permission({ detail: "", input: "", whole: false }),
      plan(),
      plan({ clipped: true, whole: false }),
      plan({ plan: "", whole: false }),
    ]
    for (const feedItem of cases) {
      const labels = feedItemNeed(worker(), feedItem, true).questions[0]?.options.map(
        (o) => o.label,
      )
      const approve = feedItem.kind === "permission" ? "Allow once" : "Start it"
      expect(labels?.includes(approve)).toBe(feedItem.kind !== "question" && feedItem.whole)
    }
  })

  test("a card that cannot be approved here says where to answer it, by whether approvals are on", () => {
    const cut = permission({ clipped: true, whole: false })
    expect(feedItemNeed(worker(), cut, true).context).toContain("or deny it here")
    expect(feedItemNeed(worker(), cut, false).context).toBe(
      "Not all of it can be shown here: answer it in the session's terminal.",
    )
  })

  // Only after a refusal that may have let the answer through does the card ask to send again deliberately.
  test("an answer may have gone only after cmux or herdr took it and could not show it land", () => {
    for (const code of ["CMUX_FAILED", "INTERRUPTED", "NOT_TAKEN", "UNCONFIRMED"])
      expect(mayHaveGone(code)).toBe(true)
    for (const code of ["INVALID", "DISABLED", "NOT_PENDING", "BUSY", undefined]) {
      expect(mayHaveGone(code)).toBe(false)
    }
  })

  test("a picker's choice and its own words are one or the other", () => {
    expect(
      feedAnswerBody(picker()[0]!, { answers: { q0: { choices: ["Y"], text: "and words" } } }),
    ).toEqual({ ok: false, reason: "Pick an option or write your own answer, not both." })
    expect(feedItemNeed(worker(), picker()[0]!).questions[0]?.textInstead).toBe(true)
  })

  // Approving another session's action waits on a login only the owner can use: until approvals are on, those cards are read-only.
  test("a picker can be answered here, a permission or plan only while approvals are on", () => {
    const busy = worker({
      feed: [picker()[0]!, permission({ requestId: "B" }), plan({ requestId: "C" })],
    })
    const off = feedNeeds(busy, false)
    expect(off.map((need) => [need.item.kind, need.onAnswer !== null])).toEqual([
      ["question", true],
      ["permission", false],
      ["plan", false],
    ])
    expect(feedNeeds(busy, true).every((need) => need.onAnswer !== null)).toBe(true)
  })

  // a herdr session's picker is answered here by keys; its permission or plan stays read-only, answered in its terminal, whatever approvals say
  test("a herdr session's picker takes Submit, and its permission is answered in its terminal alone", () => {
    const busy = worker({
      feed: [picker()[0]!, permission({ requestId: "B", whole: false })],
      herdr: true,
    })
    for (const approvals of [true, false]) {
      expect(
        feedNeeds(busy, approvals).map((need) => [need.item.herdr, need.onAnswer !== null]),
      ).toEqual([
        [true, true],
        [true, false],
      ])
    }
    expect(feedNeeds(busy, true)[1]?.item.context).toBe("Not all of it can be shown here.")
    expect(feedItemNeed(worker(), picker()[0]!).herdr).toBeUndefined()
  })
})

describe("what waits in a session", () => {
  test("its picker, and in the dispatcher's, what needs you in the inbox first", () => {
    const picking = worker({ feed: picker() })
    expect(sessionWaiting(picking, ["i-early", "i-late"])).toEqual([
      "i-early",
      "i-late",
      `feed-${REQ}`,
    ])
    expect(sessionWaiting(worker({ name: "worker-greed", role: "worker" }), ["i-early"])).toEqual(
      [],
    )
  })

  test("a probe's picker waits on its spawner, not Merritt; a probe that is the test dispatcher keeps it", () => {
    const probe = worker({ feed: picker(), name: "probe-history", role: "other" })
    expect(sessionWaiting(probe)).toEqual([])
    expect(waitingSessions([probe]).size).toBe(0)
    const dispatcher = worker({ feed: picker(), name: "probe-history", role: "dispatcher" })
    expect(sessionWaiting(dispatcher, ["i-1"])).toEqual(["i-1", `feed-${REQ}`])
  })

  // #i520: the Inbox is the primary dispatcher's alone, so the second holds only its own prompts
  test("the inbox waits in the primary dispatcher alone, once the API names it", () => {
    const second = worker({ feed: picker(), name: "dispatcher-2", role: "dispatcher" })
    expect(sessionWaiting(second, ["i-1"], "dispatcher")).toEqual([`feed-${REQ}`])
    expect(sessionWaiting(worker({ feed: picker() }), ["i-1"], "dispatcher")).toEqual([
      "i-1",
      `feed-${REQ}`,
    ])
  })
})

describe("waitingSessions", () => {
  test("the live sessions stopped at a picker", () => {
    const workers = [
      worker({ name: "worker-greed", role: "worker", sessionId: "s-greed" }),
      worker({ name: "worker-lust", feed: picker(), role: "worker", sessionId: "s-lust" }),
    ]
    expect(waitingSessions(workers)).toEqual(new Set(["s-lust"]))
    // one waiting on an inbox item it posted ranks with them
    expect(waitingSessions(workers, new Set(["worker-greed"]))).toEqual(
      new Set(["s-greed", "s-lust"]),
    )
    expect(waitingSessions(null)).toEqual(new Set())
  })
})

describe("streamItems", () => {
  const ids = (needs: StreamNeed[], entries: Entry[]) =>
    streamItems(entries, needs).map((item) =>
      item.kind === "entry" ? item.entry.id : `need:${item.need.item.id}`,
    )

  test("slots each card where it was asked, a picker (asked now) last", () => {
    const entries = [
      entry("e1", "2026-10-06T09:00:00.000Z"),
      entry("e2", "2026-10-06T09:10:00.000Z"),
      entry("e3", "2026-10-06T09:20:00.000Z"),
    ]
    const needs = [
      need("picker", null),
      need("b", "2026-10-06T09:15:00.000Z"),
      need("a", "2026-10-06T09:05:00.000Z"),
    ]
    expect(ids(needs, entries)).toEqual(["e1", "need:a", "e2", "need:b", "e3", "need:picker"])
  })

  test("puts a card asked before the oldest step first, and one after the latest at the end", () => {
    const entries = [entry("e1", "2026-10-06T09:00:00.000Z")]
    expect(
      ids(
        [need("old", "2026-10-06T08:00:00.000Z"), need("new", "2026-10-06T10:00:00.000Z")],
        entries,
      ),
    ).toEqual(["need:old", "e1", "need:new"])
  })

  test("drops an answered card older than the oldest step shown, and shows none before any step has", () => {
    const answeredNeed = (id: string, at: string): StreamNeed => ({
      ...need(id, at),
      resolution: {
        choices: ["Merge"],
        state: "done",
        summary: "Delivered to dispatcher",
        text: null,
      },
    })
    const needs = [
      answeredNeed("old", "2026-09-01T09:00:00.000Z"),
      answeredNeed("recent", "2026-10-06T09:05:00.000Z"),
      need("open-old", "2026-09-01T09:00:00.000Z"),
    ]
    const entries = [
      entry("e1", "2026-10-06T09:00:00.000Z"),
      entry("e2", "2026-10-06T09:10:00.000Z"),
    ]
    expect(ids(needs, entries)).toEqual(["need:open-old", "e1", "need:recent", "e2"])
    expect(ids(needs, [])).toEqual(["need:open-old"])
  })

  test("collapses a card in place when it is answered after the oldest step, though asked before it", () => {
    const leading = need("lead", "2026-10-06T08:00:00.000Z")
    const entries = [
      entry("e1", "2026-10-06T09:00:00.000Z"),
      entry("e2", "2026-10-06T09:10:00.000Z"),
    ]
    expect(ids([leading], entries)).toEqual(["need:lead", "e1", "e2"])
    const answeredNow: StreamNeed = {
      ...leading,
      resolution: {
        at: "2026-10-06T09:12:00.000Z",
        choices: ["Merge"],
        state: "failed",
        summary: "Not delivered",
        text: null,
      },
    }
    expect(ids([answeredNow], entries)).toEqual(["need:lead", "e1", "e2"])
    expect(
      ids(
        [
          {
            ...answeredNow,
            resolution: { ...answeredNow.resolution!, at: "2026-10-06T08:30:00.000Z" },
          },
        ],
        entries,
      ),
    ).toEqual(["e1", "e2"])
  })

  test("never lets a step with no time pull cards in front of it", () => {
    const entries = [entry("blank", ""), entry("e1", "2026-10-06T09:00:00.000Z")]
    expect(ids([need("late", "2026-10-06T10:00:00.000Z")], entries)).toEqual([
      "blank",
      "e1",
      "need:late",
    ])
  })

  test("places a card asked at the same moment as a step before it, and needs no steps at all", () => {
    expect(
      ids([need("same", "2026-10-06T09:00:00.000Z")], [entry("e1", "2026-10-06T09:00:00.000Z")]),
    ).toEqual(["need:same", "e1"])
    expect(ids([need("only", "2026-10-06T09:00:00.000Z"), need("now", null)], [])).toEqual([
      "need:only",
      "need:now",
    ])
  })
})

describe("hashAnchor", () => {
  test("the hash without its #, decoded", () => {
    expect(hashAnchor("#needs-you-abc")).toBe("needs-you-abc")
    expect(hashAnchor("#needs-you-a%20b")).toBe("needs-you-a b")
    expect(hashAnchor("")).toBe("")
  })

  test("a malformed escape reads as written rather than throwing", () => {
    expect(hashAnchor("#needs-you-%E0%A4%A")).toBe("needs-you-%E0%A4%A")
  })
})

describe("isNeedsYouAnchor", () => {
  test("names a card by its prefix, and a message's uuid is no card", () => {
    expect(isNeedsYouAnchor("needs-you-i54")).toBe(true)
    expect(isNeedsYouAnchor("6f1c2a9e-0b7d-4c1e-9a43-2f5d8e7b1c30")).toBe(false)
    expect(isNeedsYouAnchor("")).toBe(false)
  })
})

describe("cardHref", () => {
  const workers = [
    worker(),
    worker({ name: "worker-greed", feed: picker(), role: "worker", sessionId: "s-2" }),
  ]

  test("follows a bare /dashboard anchor to the session whose view holds the card", () => {
    expect(cardHref(`needs-you-feed-${REQ}`, [], workers)).toBe(
      `/dashboard?worker=s-2#needs-you-feed-${REQ}`,
    )
    expect(cardHref("needs-you-i-1", ["i-1"], workers)).toBe("/dashboard?worker=s-1#needs-you-i-1")
  })

  test("none for another hash, an unknown card, or a board still connecting", () => {
    expect(cardHref("", [], workers)).toBeNull()
    expect(cardHref("top", [], workers)).toBeNull()
    expect(cardHref("needs-you-gone", ["i-1"], workers)).toBeNull()
    expect(cardHref("needs-you-i-1", ["i-1"], null)).toBeNull()
  })
})

describe("needsYouPlaces", () => {
  // A worker waits on its dispatcher, never on the owner.
  test("lists the dispatcher, with its count and first card; a worker at a prompt waits on it, not here", () => {
    const workers = [
      worker(),
      worker({ name: "worker-greed", feed: picker(), role: "worker", sessionId: "s-2" }),
      worker({ name: "worker-lust", role: "worker", sessionId: "s-3" }),
    ]
    expect(needsYouPlaces(["i-early", "i-late"], workers)).toEqual([
      {
        count: 2,
        first: "i-early",
        href: "/dashboard?worker=s-1#needs-you-i-early",
        key: "session:s-1",
        label: "Alpha",
        name: "dispatcher",
        sessionId: "s-1",
      },
    ])
    expect(needsYouPlaces([], workers)).toEqual([])
  })

  // #i520: each dispatcher's prompts wait on you, the Inbox on the first's alone, each place named as its chat names it
  test("the second dispatcher's prompts get a place of their own, named by its label", () => {
    const second = worker({
      effort: "high",
      feed: picker(),
      model: "glm-5.3-flash",
      name: "dispatcher-2",
      sessionId: "s-glm",
    })
    expect(needsYouPlaces(["i-1"], [second, worker()], "dispatcher")).toEqual([
      expect.objectContaining({ count: 1, label: "Bravo", name: "dispatcher-2" }),
      expect.objectContaining({ count: 1, first: "i-1", label: "Alpha", name: "dispatcher" }),
    ])
  })

  test("names no session while the board is still connecting", () => {
    expect(needsYouPlaces(["i-1"], null)).toEqual([])
  })

  test("the Inbox stays on the primary dispatcher's place, though the second leads the board", () => {
    const workers = [worker({ name: "dispatcher-2", sessionId: "s-glm" }), worker()]
    expect(needsYouPlaces(["i-1"], workers, "dispatcher").map((place) => place.sessionId)).toEqual([
      "s-1",
    ])
    expect(cardHref("needs-you-i-1", ["i-1"], workers, "dispatcher")).toBe(
      "/dashboard?worker=s-1#needs-you-i-1",
    )
  })
})

// Questionnaire's own checks count only its own controls, so the card steps by its own answers, where a note alone counts.
describe("nextStep", () => {
  const none = { choices: [], text: "" }
  const choice = { choices: ["Red"], text: "" }
  const note = { choices: [], text: "a square one" }

  test("a question is answered by a choice or by words, a note alone included, and not by blanks", () => {
    expect(isAnswered(choice)).toBe(true)
    expect(isAnswered(note)).toBe(true)
    expect(isAnswered({ choices: [], text: "   " })).toBe(false)
    expect(isAnswered(undefined)).toBe(false)
  })

  test("a lone question answered by a note alone can be sent", () => {
    expect(nextStep([note], 0)).toBe("submit")
    expect(nextStep([none], 0)).toBeNull()
  })

  test("an answered question moves on, and the last sends only once every question is answered", () => {
    expect(nextStep([note, none], 0)).toBe("next")
    expect(nextStep([none, choice], 0)).toBeNull()
    expect(nextStep([none, choice], 1)).toBeNull()
    expect(nextStep([choice, note], 1)).toBe("submit")
  })
})

describe("submitWhy", () => {
  const picker = { header: null, id: "q", multiSelect: false, prompt: "Which?" }
  const options = [{ description: null, id: "Red", label: "Red", recommended: false }]
  const pickOnly = { ...picker, allowText: false, options }
  const pickOrWords = { ...picker, allowText: true, options }
  const wordsOnly = { ...picker, allowText: true, options: [] }
  const none = { choices: [], text: "" }

  test("says to pick an option while a question with options and no words box is unanswered", () => {
    expect(submitWhy([pickOnly], [none])).toBe("Pick an option first")
  })

  test("names both ways while a question takes an option or words", () => {
    expect(submitWhy([pickOrWords], [none])).toBe("Pick an option or write your answer first")
  })

  test("says to write an answer while a question with no options is unanswered", () => {
    expect(submitWhy([wordsOnly], [none])).toBe("Write your answer first")
  })

  test("names the first unanswered question's need, and nothing once every one is answered", () => {
    expect(submitWhy([wordsOnly, pickOnly], [{ choices: [], text: "x" }, none])).toBe(
      "Pick an option first",
    )
    expect(submitWhy([pickOnly, wordsOnly], [{ choices: ["Red"], text: "" }, none])).toBe(
      "Write your answer first",
    )
    expect(submitWhy([pickOrWords], [{ choices: [], text: "a note" }])).toBeNull()
    expect(submitWhy([pickOnly], [{ choices: ["Red"], text: "" }])).toBeNull()
  })
})

describe("lostPrompt", () => {
  test("a worker at a prompt the Feed no longer holds is stuck, a plain notice", () => {
    expect(
      lostPrompt(worker({ lifecycle: "needsInput", name: "worker-greed", role: "worker" })),
    ).toEqual({ onYou: false, title: "Greed · Stuck" })
  })

  test("Playground at such a prompt waits on you, in red", () => {
    expect(
      lostPrompt(worker({ effort: "high", lifecycle: "needsInput", model: "claude-opus-5-5" })),
    ).toEqual({ onYou: true, title: "Alpha · Waiting on you" })
  })

  // a dispatcher reads Alpha or Bravo, never its session name
  test("a dispatcher's notice names it by its label, as its chat does, the second one's too", () => {
    const second = worker({
      effort: "high",
      lifecycle: "needsInput",
      model: "glm-5.3-flash",
      name: "dispatcher-2",
    })
    expect(lostPrompt(second, "dispatcher")?.title).toBe("Bravo · Waiting on you")
    expect(lostPrompt(worker({ lifecycle: "needsInput" }), "dispatcher")?.title).toBe(
      "Alpha · Waiting on you",
    )
  })

  test("none while its prompt is in the Feed, or it waits on nothing", () => {
    expect(lostPrompt(worker({ feed: picker(), lifecycle: "needsInput" }))).toBeNull()
    expect(lostPrompt(worker({ lifecycle: "running" }))).toBeNull()
  })
})
