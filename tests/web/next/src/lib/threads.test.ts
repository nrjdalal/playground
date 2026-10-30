import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"

import {
  holdsForThreads,
  isPlainClick,
  pageAfterEmpty,
  patchThread,
  pendingIn,
  renamePatch,
  renameSchema,
  runAction,
  threadActions,
  threadHref,
  threadPager,
  threadSections,
} from "../../../../../web/next/src/lib/threads"

type Page = Parameters<typeof threadPager>[0]
type Thread = Page["threads"][number]
type Entry = Parameters<typeof threadSections>[0][number]
type Message = Parameters<typeof pendingIn>[1][number]

const entry = (id: string, at: string, fields: Partial<Entry> = {}): Entry => ({
  at,
  from: null,
  id,
  kind: "human",
  text: `Message ${id}`,
  tool: null,
  ...fields,
})

const message = (fields: Partial<Message>): Message => ({
  at: "2026-10-23T10:00:00.000Z",
  attachments: [],
  attempts: 0,
  code: null,
  deliveredAt: null,
  entryId: null,
  id: "m-1",
  reason: null,
  retryAt: null,
  sawPicker: false,
  sessionId: null,
  state: "queued",
  text: "Ship the pricing page\nwith the new copy",
  threadId: "k7mq",
  to: "dispatcher",
  typedAt: null,
  unanswered: false,
  unreached: 0,
  ...fields,
})

const thread = (id: string, fields: Partial<Thread> = {}): Thread => ({
  archivedAt: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  firstMessageId: null,
  id,
  lastReadAt: null,
  pinnedAt: null,
  title: `Thread ${id}`,
  unread: 0,
  updatedAt: "2026-10-22T10:00:00.000Z",
  ...fields,
})

const page = (fields: Partial<Page>): Page => ({
  threads: [],
  hasNextPage: false,
  page: 1,
  total: 0,
  ...fields,
})

describe("threadPager", () => {
  test("has no pager at five threads or fewer", () => {
    expect(threadPager(page({ total: 5 }))).toBeNull()
    expect(threadPager(page({ total: 0 }))).toBeNull()
  })

  test("pages past five, with each arrow live only where a page lies that way", () => {
    expect(threadPager(page({ hasNextPage: true, page: 1, total: 7 }))).toEqual({
      hasNext: true,
      hasPrevious: false,
      page: 1,
      pages: 2,
    })
    expect(threadPager(page({ page: 2, total: 7 }))).toEqual({
      hasNext: false,
      hasPrevious: true,
      page: 2,
      pages: 2,
    })
  })
})

describe("pageAfterEmpty", () => {
  test("steps back to the last page when this one emptied past the first", () => {
    expect(pageAfterEmpty(page({ page: 2, total: 5 }))).toBe(1)
    expect(pageAfterEmpty(page({ page: 3, total: 7 }))).toBe(2)
  })

  test("stays on a page with rows, and on the first", () => {
    expect(pageAfterEmpty(page({ page: 2, threads: [thread("k7mq")], total: 6 }))).toBeNull()
    expect(pageAfterEmpty(page({ page: 1, total: 0 }))).toBeNull()
  })
})

describe("threadHref", () => {
  test("opens the thread's own view, at a URL a new tab can open", () => {
    expect(threadHref(thread("k7mq"))).toBe("/dashboard/threads/k7mq")
    expect(threadHref(thread("k7 mq"))).toBe("/dashboard/threads/k7%20mq")
  })
})

describe("threadSections", () => {
  const first = entry("a", "2026-10-23T09:00:00.000Z")
  const read = entry("b", "2026-10-23T09:10:00.000Z", { from: "k3m9px-worker", kind: "peer" })
  const fresh = entry("c", "2026-10-23T09:30:00.000Z", { from: "p4wq-worker", kind: "peer" })

  test("what was asked first, then what came after the last read, then the rest", () => {
    expect(threadSections([first, read, fresh], "2026-10-23T09:20:00.000Z")).toEqual({
      asked: first,
      history: [read],
      latest: [],
      unread: [fresh],
    })
  })

  test("a thread never read has every message after the first unread", () => {
    expect(threadSections([first, read, fresh], null)).toEqual({
      asked: first,
      history: [],
      latest: [],
      unread: [read, fresh],
    })
  })

  test("a message stamped at the read itself is read", () => {
    expect(threadSections([first, read], read.at).unread).toEqual([])
  })

  // a reviewer: a reply sent from the thread came back under Unread, as if someone else had written it
  test("your own messages are never unread, so a reply you sent sits in the history", () => {
    const reply = entry("d", "2026-10-23T09:40:00.000Z")
    expect(threadSections([first, read, fresh, reply], "2026-10-23T09:20:00.000Z")).toEqual({
      asked: first,
      history: [read, reply],
      latest: [],
      unread: [fresh],
    })
    expect(threadSections([first, reply], null).unread).toEqual([])
  })

  test("a thread that opens with someone else's message has no You asked, and that message reads as the rest do", () => {
    expect(threadSections([read, fresh], "2026-10-23T09:20:00.000Z")).toEqual({
      asked: null,
      history: [read],
      latest: [],
      unread: [fresh],
    })
  })

  // a tester: a reply sent from the view was filed into the folded history, out of sight
  test("what lands after the view opened shows in its own section, yours and others' in order", () => {
    const reply = entry("d", "2026-10-23T09:40:00.000Z")
    const answer = entry("e", "2026-10-23T09:41:00.000Z", { from: "p4wq-worker", kind: "peer" })
    expect(
      threadSections(
        [first, read, fresh, reply, answer],
        "2026-10-23T09:20:00.000Z",
        Date.parse("2026-10-23T09:35:00.000Z"),
      ),
    ).toEqual({ asked: first, history: [read], latest: [reply, answer], unread: [fresh] })
  })

  test("an empty thread has nothing in any section", () => {
    expect(threadSections([], null)).toEqual({ asked: null, history: [], latest: [], unread: [] })
  })
})

describe("pendingIn (a thread view's messages on their way)", () => {
  const now = Date.parse("2026-10-23T10:00:30.000Z")

  test("shows this thread's queued, sending and failed messages, and no other thread's or the full chat's", () => {
    const messages = [
      message({ id: "q" }),
      message({ id: "s", state: "sending" }),
      message({ id: "f", state: "failed" }),
      message({ id: "other", threadId: "r7pz" }),
      message({ id: "chat", threadId: undefined }),
    ]
    expect(pendingIn([], messages, "k7mq", now).map((m) => m.id)).toEqual(["q", "s", "f"])
  })

  test("a typed message shows until the thread holds it", () => {
    const typed = message({ state: "typed", typedAt: "2026-10-23T10:00:01.000Z" })
    expect(pendingIn([], [typed], "k7mq", now)).toEqual([typed])
    const filed = entry("e", "2026-10-23T10:00:02.000Z", { text: typed.text })
    expect(pendingIn([filed], [typed], "k7mq", now)).toEqual([])
  })

  // a reviewer: a message of files alone has no words, so any recent message of yours stood in for it
  test("a message of files alone shows until an entry with its files is filed, never one of other words", () => {
    const file = { id: "3f0e7a52-1c4b-4d2a-9e6f-0000000000a2.png", kind: "image" as const }
    const typed = message({
      attachments: [{ ...file, name: "shot.png", previewUrl: null, size: 10 }],
      state: "typed",
      text: "",
      typedAt: "2026-10-23T10:00:01.000Z",
    })
    const other = entry("e", "2026-10-23T10:00:02.000Z", { text: "Something else" })
    expect(pendingIn([other], [typed], "k7mq", now)).toEqual([typed])
    const filed = entry("f", "2026-10-23T10:00:02.000Z", { attachments: [file], text: "" })
    expect(pendingIn([other, filed], [typed], "k7mq", now)).toEqual([])
  })

  test("an older message with the same words does not stand in for it", () => {
    const typed = message({ state: "typed", typedAt: "2026-10-23T10:00:01.000Z" })
    const older = entry("e", "2026-10-23T09:50:00.000Z", { text: typed.text })
    expect(pendingIn([older], [typed], "k7mq", now)).toEqual([typed])
  })

  test("a typed message stops showing once filing it has had its time, and a delivered one never shows", () => {
    const typed = message({ state: "typed", typedAt: "2026-10-23T09:58:00.000Z" })
    expect(pendingIn([], [typed], "k7mq", now)).toEqual([])
    expect(pendingIn([], [message({ state: "delivered" })], "k7mq", now)).toEqual([])
  })
})

describe("threadActions", () => {
  test("an unread, unpinned thread offers Mark as read and Pin", () => {
    expect(threadActions(thread("k7mq", { unread: 3 }))).toEqual([
      { label: "Mark as read", patch: { read: true } },
      { label: "Rename", patch: null },
      { label: "Pin", patch: { pinned: true } },
      { label: "Archive", patch: { archived: true } },
    ])
  })

  test("a read, pinned thread offers Mark as unread and Unpin", () => {
    expect(
      threadActions(thread("k7mq", { pinnedAt: "2026-10-22T11:00:00.000Z" })).map((a) => a.label),
    ).toEqual(["Mark as unread", "Rename", "Unpin", "Archive"])
    expect(threadActions(thread("k7mq"))[0]?.patch).toEqual({ read: false })
  })
})

describe("isPlainClick", () => {
  const click = { altKey: false, button: 0, ctrlKey: false, metaKey: false, shiftKey: false }

  test("the main button with no modifier opens here", () => {
    expect(isPlainClick(click)).toBe(true)
  })

  test("a modifier or another button opens elsewhere", () => {
    for (const key of ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const)
      expect(isPlainClick({ ...click, [key]: true })).toBe(false)
    expect(isPlainClick({ ...click, button: 1 })).toBe(false)
  })
})

describe("runAction (a row menu's item)", () => {
  test("each item but Rename sends its change, and Rename asks for the title", () => {
    const sent: [string, unknown][] = []
    const subject = thread("k7mq", { unread: 1 })
    for (const action of threadActions(subject))
      runAction(subject, action, {
        patch: (_, patch) => sent.push([action.label, patch]),
        rename: () => sent.push([action.label, "asks"]),
      })
    expect(sent).toEqual([
      ["Mark as read", { read: true }],
      ["Rename", "asks"],
      ["Pin", { pinned: true }],
      ["Archive", { archived: true }],
    ])
  })
})

describe("renamePatch", () => {
  test("sends the new title, trimmed", () => {
    expect(renamePatch(thread("k7mq"), "  Merge lock  ")).toEqual({ title: "Merge lock" })
  })

  test("sends nothing for a blank or unchanged title", () => {
    expect(renamePatch(thread("k7mq"), "   ")).toBeNull()
    expect(renamePatch(thread("k7mq"), " Thread k7mq ")).toBeNull()
  })
})

describe("renameSchema", () => {
  test("takes a title of 1 to 200 characters once trimmed", () => {
    expect(renameSchema.safeParse({ title: "  Merge lock  " }).success).toBe(true)
    expect(renameSchema.safeParse({ title: "x".repeat(200) }).success).toBe(true)
  })

  test("refuses a blank title and one past 200, with its reason", () => {
    expect(renameSchema.safeParse({ title: "   " }).error?.issues[0]?.message).toBe(
      "Give the thread a title",
    )
    expect(renameSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false)
  })
})

describe("holdsForThreads", () => {
  test("holds the nav for the first read alone", () => {
    expect(holdsForThreads({ failureCount: 0, isPending: true })).toBe(true)
  })

  test("a failed read, retrying or given up, holds nothing, and neither does a read done", () => {
    expect(holdsForThreads({ failureCount: 1, isPending: true })).toBe(false)
    expect(holdsForThreads({ failureCount: 4, isPending: false })).toBe(false)
    expect(holdsForThreads({ failureCount: 0, isPending: false })).toBe(false)
  })
})

describe("patchThread", () => {
  const calls: { body: unknown; method: string; url: string }[] = []
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init)
    calls.push({ body: await request.json(), method: request.method, url: request.url })
    return Response.json({ data: thread("k7mq") })
  }) as typeof fetch)
  afterAll(() => spy.mockRestore())
  afterEach(() => {
    calls.length = 0
  })

  test.each([
    ["Mark as read", { read: true }],
    ["Mark as unread", { read: false }],
    ["Rename", { title: "Ship notes" }],
    ["Pin", { pinned: true }],
    ["Unpin", { pinned: false }],
    ["Archive", { archived: true }],
  ] as const)("%s sends its change to PATCH /api/v1/threads/:id", async (_, patch) => {
    await patchThread("k7mq", patch)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe("PATCH")
    expect(new URL(calls[0]!.url).pathname).toBe("/api/v1/threads/k7mq")
    expect(calls[0]?.body).toEqual(patch)
  })

  test("throws the API's message when the change is refused", async () => {
    spy.mockImplementationOnce((async () =>
      Response.json(
        { error: { code: "NOT_FOUND", message: "No such thread" } },
        { status: 404 },
      )) as unknown as typeof fetch)
    await expect(patchThread("k7mq", { pinned: true })).rejects.toThrow("No such thread")
  })
})
