import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import type { InboxItem } from "../../../../../api/hono/src/lib/dashboard/inbox"
import {
  ACKS_STAMPED_FROM as API_ACKS_STAMPED_FROM,
  GO_CHOICES as API_GO_CHOICES,
  PLACED_TYPES as API_PLACED_TYPES,
  RETRY_CODES as API_RETRY_CODES,
  savesDraft as API_savesDraft,
} from "../../../../../api/hono/src/lib/dashboard/inbox"
import {
  ACKS_STAMPED_FROM,
  canDraft,
  cardKey,
  changedAt,
  dismissable,
  DONE_AFTER_MS,
  focusAfterTake,
  GO_CHOICES,
  inboxLight,
  inboxPosters,
  inboxSummary,
  inboxTarget,
  inboxView,
  inboxWaitOf,
  inboxWaiting,
  itemState,
  kindWord,
  MOVED_PAUSE_MS,
  movedRows,
  movedStep,
  needsYou,
  newLabel,
  outcomeLine,
  pickedAt,
  pinnedView,
  PLACED_TYPES,
  resultLink,
  RETRY_CODES,
  retryable,
  reopenable,
  reopenKey,
  schedulable,
  scheduleChoices,
  sendFailed,
  sendWhy,
  updatedSince,
  upfrontLink,
} from "../../../../../web/next/src/lib/inbox"
import { statusIcon } from "../../../../../web/next/src/lib/status-icons"

// Remix's icons resolve from the web app's own packages, which this directory cannot see.
const web = join(import.meta.dir, "../../../../../web/next")
const {
  RiCheckboxBlankCircleLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiSearchEyeLine,
} = (await import(Bun.resolveSync("@remixicon/react", web))) as Record<string, unknown>

const item = (over: Partial<InboxItem> & Pick<InboxItem, "kind">): InboxItem =>
  ({
    answer: null,
    createdAt: "2026-10-07T10:00:00.000Z",
    delivery: null,
    from: "ops",
    id: `id-${over.ref ?? 1}`,
    preview:
      over.kind === "update"
        ? { outcome: "merged" }
        : over.kind === "draft"
          ? { text: "hi", to: "@Merritt" }
          : { sha: "3f9a2c1", prs: [{ number: 270, title: "x" }], type: "ship" },
    readAt: null,
    ref: 1,
    status: over.kind === "update" ? "done" : "open",
    title: "Ship canary 3f9a2c1 to main?",
    updatedAt: "2026-10-07T10:00:00.000Z",
    version: 0,
    ...over,
  }) as InboxItem

const items = [
  item({ kind: "decision", ref: 41 }),
  item({ from: "dispatcher", kind: "draft", ref: 40 }),
  item({ kind: "update", ref: 44 }),
  item({ kind: "update", readAt: "2026-10-07T11:00:00.000Z", ref: 31 }),
  item({ answer: { at: "x", choice: "approve" }, kind: "decision", ref: 12, status: "approved" }),
]

describe("the inbox's counts", () => {
  test("what needs you: open decisions and drafts, and unread updates", () => {
    expect(items.filter(needsYou).map((i) => i.ref)).toEqual([41, 40, 44])
    expect(inboxWaiting(items)).toEqual(["id-41", "id-40", "id-44"])
    expect(inboxSummary(items)).toBe("1 needs you · 1 draft · 1 unread")
    expect(inboxSummary([items[3]!, items[4]!])).toBeNull()
  })

  test("the kind as the meta line words it", () => {
    expect(items.map(kindWord)).toEqual(["Ship", "Slack draft", "Merged", "Merged", "Ship"])
    expect(kindWord(item({ kind: "decision", preview: { text: "x", type: "ask" } } as never))).toBe(
      "Ask",
    )
  })

  test("a go taken by the session that stood in for an ended poster names that session", () => {
    const taken = {
      ...items[4]!,
      delivery: { at: "x", status: "delivered", to: "dispatcher", via: "session" },
    } as InboxItem
    expect(outcomeLine(taken)).toBe("You approved it · Being carried out by Alpha…")
    expect(
      outcomeLine({
        ...taken,
        answer: { ackedAt: "y", at: "x", choice: "approve", noLink: "a budget has no page" },
      } as InboxItem),
    ).toBe("You approved it · Delivered to Alpha · No link: a budget has no page")
    expect(
      outcomeLine({
        ...items[4]!,
        delivery: { at: "x", status: "delivered", to: "ops", via: "session" },
      }),
    ).toBe("You approved it · Being carried out by Ops…")
  })

  test("an answered item says what he chose and whether it reached its poster", () => {
    expect(outcomeLine(items[0]!)).toBeNull()
    // a go reads as being carried out until its poster closes it with a link or why there is none
    expect(outcomeLine({ ...items[4]!, delivery: { status: "pending" } })).toBe(
      "You approved it · Being carried out by Ops…",
    )
    expect(
      outcomeLine({ ...items[4]!, delivery: { at: "x", status: "delivered", via: "session" } }),
    ).toBe("You approved it · Being carried out by Ops…")
    expect(
      outcomeLine({
        ...items[4]!,
        answer: { ackedAt: "y", at: "x", choice: "approve", noLink: "a budget has no page" },
        delivery: { at: "x", status: "delivered", via: "cli" },
      } as InboxItem),
    ).toBe("You approved it · Read by Ops · No link: a budget has no page")
    // an approved Slack message is sent, as a draft is
    expect(
      outcomeLine({
        ...items[4]!,
        preview: {
          link: "https://app.slack.com/client/T0/C0",
          text: "hi",
          to: "@Merritt",
          type: "slack",
        },
      } as InboxItem),
    ).toBe("You approved it · Sending in Slack…")
    // a deny is carried out by reading it
    expect(
      outcomeLine({
        ...items[4]!,
        answer: { at: "x", choice: "deny" },
        delivery: { at: "x", status: "delivered", via: "cli" },
        status: "denied",
      } as InboxItem),
    ).toBe("You denied it · Read by Ops")
    // a clear sets it aside for later, read by its poster as a deny is, and is never carried out
    expect(
      outcomeLine({
        ...items[4]!,
        answer: { at: "x", choice: "clear" },
        delivery: { at: "x", status: "delivered", via: "cli" },
        status: "cleared",
      } as InboxItem),
    ).toBe("You set it aside for later · Read by Ops")
    expect(
      outcomeLine({
        ...items[4]!,
        delivery: { code: "ON_PICKER", reason: "busy", status: "failed" },
      }),
    ).toBe("You approved it · Send failed: busy")
  })
})

describe("a session waiting on an item it posted", () => {
  test("waits on its oldest open decision or draft, never an update or an answered one", () => {
    expect(inboxWaitOf(items, "ops")).toEqual({ id: "id-41", ref: 41 })
    expect(inboxWaitOf(items, "dispatcher")).toEqual({ id: "id-40", ref: 40 })
    expect(inboxWaitOf(items, "builder")).toBeNull()
    expect(inboxPosters(items)).toEqual(new Set(["ops", "dispatcher"]))
  })
})

describe("a link to an item", () => {
  test("names an item the inbox holds, so the view opens its Inbox tab", () => {
    expect(inboxTarget("needs-you-id-41", items)).toBe(true)
    expect(inboxTarget("needs-you-feed-abc", items)).toBe(false)
    expect(inboxTarget("id-41", items)).toBe(false)
  })
})

describe("a probe's items", () => {
  test("wait on its spawner, never Merritt: no Waiting on you and no rank among the waiting", () => {
    const probeItems = [item({ from: "probe-history", kind: "decision", ref: 50 })]
    expect(inboxWaitOf(probeItems, "probe-history")).toBeNull()
    expect(inboxPosters(probeItems)).toEqual(new Set())
  })
})

describe("inboxView", () => {
  const NOW = Date.parse("2026-10-07T12:00:00.000Z")
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const answered = (ref: number, at: string) =>
    item({ answer: { at, choice: "approve" }, kind: "decision", ref, status: "approved" })
  const read = (ref: number, at: string) => item({ kind: "update", readAt: at, ref })

  test("an answered or read item stays in the list for ten minutes, then leaves it for Done", () => {
    const list = [
      item({ kind: "decision", ref: 41 }),
      answered(12, ago(DONE_AFTER_MS - 1000)),
      answered(11, ago(DONE_AFTER_MS)),
      read(31, ago(60_000)),
      read(30, ago(DONE_AFTER_MS + 60_000)),
    ]
    const { done, shown } = inboxView(list, NOW)
    expect(shown.map((i) => i.ref)).toEqual([41, 12, 31])
    expect(done.map((i) => i.ref)).toEqual([11, 30])
  })

  test("Done lists the newest settled first, and an open item or an unread update never leaves", () => {
    const list = [
      answered(5, ago(3 * 60 * 60_000)),
      read(6, ago(20 * 60_000)),
      answered(7, ago(60 * 60_000)),
      item({ kind: "update", ref: 8, updatedAt: ago(9 * 60 * 60_000) }),
      item({ kind: "draft", ref: 9, createdAt: ago(9 * 60 * 60_000) }),
    ]
    const { done, shown } = inboxView(list, NOW)
    expect(done.map((i) => i.ref)).toEqual([6, 7, 5])
    expect(shown.map((i) => i.ref)).toEqual([8, 9])
  })

  test("a set-aside item goes to Archived at once, newest first, never to the list or Done", () => {
    const cleared = (ref: number) =>
      item({
        answer: { at: ago(60_000), choice: "clear" },
        kind: "decision",
        ref,
        status: "cleared",
      })
    const { archived, done, shown } = inboxView(
      [
        cleared(3),
        item({ kind: "decision", ref: 50 }),
        cleared(7),
        answered(11, ago(DONE_AFTER_MS * 3)),
      ],
      NOW,
    )
    expect(archived.map((i) => i.ref)).toEqual([7, 3])
    expect(shown.map((i) => i.ref)).toEqual([50])
    expect(done.map((i) => i.ref)).toEqual([11])
  })

  test("a set-aside item he dismissed leaves Archived for Done", () => {
    const dismissed = item({
      answer: { at: ago(120_000), choice: "clear", dismissedAt: ago(60_000) },
      kind: "decision",
      ref: 4,
      status: "cleared",
    })
    const { archived, done } = inboxView([dismissed], NOW)
    expect(archived).toEqual([])
    expect(done.map((i) => i.ref)).toEqual([4])
  })

  // a reviewer: a set-aside whose send failed went to the shut shelf while the API still counted it
  test("a set-aside whose send failed stays in the list and its count, offering Retry, until it reaches its poster or he dismisses it", () => {
    const failedClear = item({
      answer: { at: ago(120_000), choice: "clear" },
      delivery: { code: "ON_PICKER", reason: "waiting on a picker", status: "failed" },
      kind: "decision",
      ref: 5,
      status: "cleared",
    })
    expect(sendFailed(failedClear)).toBe(true)
    const { archived, shown } = inboxView([failedClear], NOW)
    expect(archived).toEqual([])
    expect(shown.map((i) => i.ref)).toEqual([5])
  })

  test("a new item arriving goes above Done, in the list", () => {
    const { done, shown } = inboxView(
      [answered(11, ago(DONE_AFTER_MS * 3)), item({ kind: "decision", ref: 50 })],
      NOW,
    )
    expect(shown.map((i) => i.ref)).toEqual([50])
    expect(done.map((i) => i.ref)).toEqual([11])
  })
})

describe("Dismiss", () => {
  const NOW = Date.parse("2026-10-07T12:00:00.000Z")
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const answered = (ref: number, dismissed?: string) =>
    item({
      answer: {
        at: ago(60_000),
        choice: "approve",
        ...(dismissed ? { dismissedAt: dismissed } : {}),
      },
      kind: "decision",
      ref,
      status: "approved",
    })

  test("a dismissed item goes to Done at once, newest dismissed first, without waiting ten minutes", () => {
    const { done, shown } = inboxView(
      [answered(23), answered(22, ago(120_000)), answered(21, ago(30_000))],
      NOW,
    )
    expect(done.map((i) => i.ref)).toEqual([21, 22])
    expect(shown.map((i) => i.ref)).toEqual([23])
  })

  test("is offered on an answered decision or draft and on any update still in the list, never on an open decision or draft", () => {
    expect(dismissable(answered(1))).toBe(true)
    expect(dismissable(answered(1, ago(1)))).toBe(false)
    expect(dismissable(item({ kind: "decision" }))).toBe(false)
    expect(dismissable(item({ kind: "draft" }))).toBe(false)
    expect(dismissable(item({ kind: "update" }))).toBe(true)
    expect(dismissable(item({ kind: "update", readAt: ago(1) }))).toBe(true)
    expect(
      dismissable(item({ answer: { dismissedAt: ago(1) }, kind: "update", readAt: ago(1) })),
    ).toBe(false)
  })

  // An item answered from chat can still be dismissed.
  test("is offered on a decision or draft he replied to in chat, still open, until it is dismissed", () => {
    const replied = { at: ago(60_000), choice: "replied" as const }
    expect(dismissable(item({ answer: replied, kind: "decision" }))).toBe(true)
    expect(dismissable(item({ answer: replied, kind: "draft" }))).toBe(true)
    expect(
      dismissable(item({ answer: { ...replied, dismissedAt: ago(1) }, kind: "decision" })),
    ).toBe(false)
  })

  test("a replied item he dismissed goes to Done at once, its poster not done with it yet", () => {
    const dismissed = item({
      answer: { at: ago(60_000), choice: "replied", dismissedAt: ago(1_000) },
      kind: "decision",
      ref: 31,
    })
    const waiting = item({
      answer: { at: ago(60_000), choice: "replied" },
      kind: "decision",
      ref: 32,
    })
    const { done, shown } = inboxView([dismissed, waiting], NOW)
    expect(done.map((i) => i.ref)).toEqual([31])
    expect(shown.map((i) => i.ref)).toEqual([32])
  })

  test("a dismissed update goes to Done at once, with no outcome or link of an answer", () => {
    const update = item({
      answer: { dismissedAt: ago(1_000) },
      kind: "update",
      readAt: ago(1_000),
      ref: 9,
    })
    expect(inboxView([update], NOW).done.map((i) => i.ref)).toEqual([9])
    expect(outcomeLine(update)).toBeNull()
    expect(resultLink(update)).toBeNull()
  })

  // Mark as read keeps the message as it is and drops the double tick.
  test("an open ask marked read stays in the list as it is, still waiting on an answer, however long ago", () => {
    const seen = item({ kind: "decision", readAt: ago(DONE_AFTER_MS * 6), ref: 8 })
    expect(inboxView([seen], NOW).shown).toEqual([seen])
    expect(needsYou(seen)).toBe(true)
    expect(outcomeLine(seen)).toBeNull()
  })
})

describe("a settled item", () => {
  const settled = item({
    answer: {
      at: "2026-10-07T11:00:00.000Z",
      by: "dispatcher",
      choice: "settled",
      note: "Shipped by hand",
    },
    kind: "decision",
    ref: 4,
    status: "done",
  })

  test("reads Answered by its poster with the note, offers no answer, and can be dismissed", () => {
    expect(outcomeLine(settled)).toBe("Answered by Alpha · Shipped by hand")
    expect(
      outcomeLine({
        ...settled,
        answer: { at: "x", by: "builder", choice: "settled" },
        kind: "decision",
      } as InboxItem),
    ).toBe("Answered by Builder")
    expect(needsYou(settled)).toBe(false)
    expect(dismissable(settled)).toBe(true)
  })
})

describe("an item he replied to in chat", () => {
  const replied = item({
    answer: { at: "2026-10-07T11:30:00.000Z", choice: "replied" },
    kind: "decision",
    ref: 42,
  })
  const acked = item({
    answer: {
      at: "2026-10-07T11:30:00.000Z",
      ackedAt: "2026-10-07T12:30:00.000Z",
      choice: "replied",
      link: "https://github.com/acme/archive/pull/270",
    },
    kind: "decision",
    ref: 42,
  })

  test("a reply takes it off the count, the summary and the waiting, but it stays in the list, where Dismiss clears it", () => {
    expect(needsYou(replied)).toBe(false)
    const list = [...items, replied]
    expect(inboxSummary(list)).toBe(inboxSummary(items))
    expect(inboxWaiting(list)).toEqual(inboxWaiting(items))
    expect(inboxWaitOf(list, "ops")).toEqual(inboxWaitOf(items, "ops"))
    expect(inboxPosters(list)).toEqual(inboxPosters(items))
    expect(dismissable(replied)).toBe(true)
  })

  // The row above reads a poster that holds another open item, which hides the replied exclusion; this one reads a poster with nothing else open.
  test("a poster with nothing else open is nowhere for a replied item: no waiting item, out of the posters", () => {
    const solo = item({
      answer: { at: "2026-10-07T11:30:00.000Z", choice: "replied" },
      from: "worker-wrath",
      kind: "decision",
      ref: 77,
    })
    expect(inboxWaitOf([solo], "worker-wrath")).toBeNull()
    expect(inboxPosters([solo]).has("worker-wrath")).toBe(false)
    // one still-open item of the same poster's holds the waiting and the posters, and the replied one never does
    const open = item({ from: "worker-wrath", kind: "decision", ref: 78 })
    expect(inboxWaitOf([open], "worker-wrath")).toEqual({ id: open.id, ref: 78 })
    expect(inboxPosters([open]).has("worker-wrath")).toBe(true)
    expect(inboxWaitOf([solo, open], "worker-wrath")).toEqual({ id: open.id, ref: 78 })
    expect(inboxPosters([solo, open]).has("worker-wrath")).toBe(true)
  })

  test("a reply the poster read by cli stays open until its ack, while a deny read that way closes", () => {
    const cliRead = item({
      answer: { at: "2026-10-13T11:30:00.000Z", choice: "replied" },
      delivery: { at: "x", status: "delivered", via: "cli" },
      kind: "decision",
      ref: 42,
    })
    expect(itemState(cliRead)).toBe("sending")
    const denied = item({
      answer: { at: "2026-10-13T11:30:00.000Z", choice: "deny" },
      delivery: { at: "x", status: "delivered", via: "cli" },
      kind: "decision",
      ref: 43,
      status: "denied",
    })
    expect(itemState(denied)).toBe("closed")
  })

  test("reads being worked on by its poster with the working light, then done once the poster closed it", () => {
    expect(itemState(replied)).toBe("sending")
    expect(outcomeLine(replied)).toBe("You replied · Ops is on it…")
    // his words lead once recorded, so the action in progress shows
    expect(
      outcomeLine(item({ ...replied, answer: { ...replied.answer, said: "tomorrow" } as never })),
    ).toBe('You replied "tomorrow" · Ops is on it…')
    expect(inboxLight(replied)).toBe("working")
    expect(itemState(acked)).toBe("done")
    expect(outcomeLine(acked)).toBe("You replied")
    expect(inboxLight(acked)).toBe("done")
    // the poster's close links where it landed
    expect(resultLink(acked)).toEqual({
      href: "https://github.com/acme/archive/pull/270",
      label: "acme/archive#270",
    })
  })

  test("sits on In progress while its poster works, and moves to Done only once it is closed", () => {
    // ten minutes after the reply it is still being worked on, on its own shelf out of the list, In progress above Snoozed and below the Inbox
    // under five minutes after the reply it stays in the list, so he sees it taken
    expect(
      inboxView([replied], Date.parse("2026-10-07T11:34:59.000Z")).shown.map((i) => i.ref),
    ).toEqual([42])
    const working = inboxView([replied], Date.parse("2026-10-07T11:40:00.000Z"))
    expect(working.progress.map((i) => i.ref)).toEqual([42])
    expect(working.shown).toEqual([])
    expect(inboxView([replied], Date.parse("2026-10-07T11:40:00.000Z")).done).toEqual([])
    // the close settles it, Done ten minutes after
    expect(
      inboxView([acked], Date.parse("2026-10-07T12:39:00.000Z")).shown.map((i) => i.ref),
    ).toEqual([42])
    expect(
      inboxView([acked], Date.parse("2026-10-07T12:40:00.000Z")).done.map((i) => i.ref),
    ).toEqual([42])
  })
})

describe("resultLink", () => {
  const APP =
    "https://app.slack.com/client/T0000000000/C0MADEUP01/thread/C0MADEUP01-1700000000.000100"
  const sent = (link?: string, linkLabel?: string) =>
    item({
      answer: {
        at: "x",
        choice: "send",
        ...(link ? { link } : {}),
        ...(linkLabel ? { linkLabel } : {}),
      },
      kind: "draft",
      status: "sent",
    })

  test("names the link by what was carried out: the poster's label first", () => {
    expect(
      resultLink(sent("https://linear.app/acme/issue/DUNE-2186/x", "Filed DUNE-2186")),
    ).toEqual({
      href: "https://linear.app/acme/issue/DUNE-2186/x",
      label: "Filed DUNE-2186",
    })
  })

  test("else draws the name from the link: Open thread for Slack, a Linear ID, owner/repo#N, or the site", () => {
    // Slack links take the app client form, https://app.slack.com/client
    // the words a draft's own link uses, such as open thread
    expect(resultLink(sent(APP))).toEqual({ href: APP, label: "Open thread" })
    // a label the poster gave still wins, as for any link, so the documented Slack ack passes none
    expect(resultLink(sent(APP, "Replied to Merritt"))?.label).toBe("Replied to Merritt")
    expect(resultLink(sent("https://app.slack.com/client/T0000000000/C0MADEUP01"))?.label).toBe(
      "Open thread",
    )
    expect(
      resultLink(sent("https://linear.app/acme/issue/dune-2186/export-times-out"))?.label,
    ).toBe("DUNE-2186")
    expect(resultLink(sent("https://github.com/acme/gke-deployments/pull/1083"))?.label).toBe(
      "acme/gke-deployments#1083",
    )
    expect(resultLink(sent("https://github.com/acme/app/issues/4186"))?.label).toBe("acme/app#4186")
    expect(resultLink(sent("https://example.com/x"))?.label).toBe("example.com")
  })

  test("is null without a link or for one that is not https", () => {
    expect(resultLink(sent())).toBeNull()
    expect(resultLink(sent("http://app.slack.com/client/T0000000000/C0MADEUP01"))).toBeNull()
    expect(resultLink(sent("javascript:alert(1)"))).toBeNull()
  })
})

describe("a draft's thread", () => {
  const draft = (link?: string) =>
    item({
      kind: "draft",
      preview: { text: "hi", to: "Cameron's thread", ...(link ? { link } : {}) },
    })
  const SLACK =
    "https://app.slack.com/client/T0000000000/C0MADEUP01/thread/C0MADEUP01-1700000000.000100"
  const LINEAR = "https://linear.app/acme/issue/DUNE-2186/export-times-out"

  test("its label comes from where its link points: a Linear comment, else a Slack draft", () => {
    expect(kindWord(draft(LINEAR))).toBe("Linear comment")
    expect(kindWord(draft(SLACK))).toBe("Slack draft")
    expect(kindWord(draft())).toBe("Slack draft")
  })

  test("its link opens the thread, https alone", () => {
    expect(upfrontLink(draft(SLACK))).toEqual({ href: SLACK, label: "Open thread" })
    expect(upfrontLink(draft(LINEAR))).toEqual({ href: LINEAR, label: "Open thread" })
    expect(upfrontLink(draft())).toBeNull()
    expect(upfrontLink(draft("http://linear.app/acme/issue/DUNE-1"))).toBeNull()
    expect(upfrontLink(draft("javascript:alert(1)"))).toBeNull()
  })

  test("a slack, ship or ticket decision shows where it lands upfront, or why it cannot yet", () => {
    // The link to where a reply goes comes first, not after the draft
    const decision = (preview: object) => item({ kind: "decision", preview } as never)
    const ship = { prs: [{ number: 1, title: "x" }], sha: "3f9a2c1", type: "ship" }
    const compare = "https://github.com/acme/app/compare/main...3f9a2c1"
    expect(upfrontLink(decision({ ...ship, link: compare }))).toEqual({
      href: compare,
      label: "acme/app compare",
    })
    expect(
      upfrontLink(decision({ link: SLACK, text: "hi", to: "@Merritt", type: "slack" })),
    ).toEqual({
      href: SLACK,
      label: "Open thread",
    })
    expect(
      upfrontLink(
        item({ kind: "draft", preview: { noLink: "a new DM", text: "hi", to: "@Merritt" } }),
      ),
    ).toEqual({ reason: "a new DM" })
    expect(upfrontLink(decision({ amount: "$4", type: "budget", why: "x" }))).toBeNull()
    expect(upfrontLink(item({ kind: "decision" }))).toBeNull()
  })

  test("the ack's link replaces the upfront one", () => {
    expect(
      upfrontLink(
        item({
          answer: { at: "x", choice: "send", link: LINEAR },
          kind: "draft",
          preview: { link: SLACK, text: "hi", to: "@Merritt" },
          status: "sent",
        }),
      ),
    ).toBeNull()
  })
})

describe("an answer that failed to send", () => {
  const NOW = Date.parse("2026-10-09T12:00:00.000Z")
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const failed = (ref: number, dismissed?: string) =>
    item({
      answer: {
        at: ago(DONE_AFTER_MS * 6),
        choice: "send",
        ...(dismissed ? { dismissedAt: dismissed } : {}),
      },
      delivery: { code: "CMUX_FAILED", reason: "no answer from cmux", status: "failed" },
      kind: "draft",
      ref,
      status: "sent",
    })

  test("stays in the list as needing you, past the ten minutes, saying the send failed", () => {
    const item = failed(76)
    expect(sendFailed(item)).toBe(true)
    expect(needsYou(item)).toBe(true)
    expect(inboxView([item], NOW)).toEqual({ archived: [], done: [], progress: [], shown: [item] })
    expect(outcomeLine(item)).toBe("You sent it · Send failed: no answer from cmux")
    expect(inboxSummary([item])).toBe("1 failed to send")
  })

  test("offers its own Dismiss", () => {
    expect(dismissable(failed(76))).toBe(true)
  })

  test("offers Retry only where nothing was typed, and reads as unconfirmed where typing may have begun", () => {
    expect(RETRY_CODES).toEqual(API_RETRY_CODES)
    expect(retryable(failed(76))).toBe(true)
    for (const code of ["INTERRUPTED", "ERROR"]) {
      const cut = {
        ...failed(77),
        delivery: { code, reason: "cut off", status: "failed" as const },
      }
      expect(sendFailed(cut), code).toBe(true)
      expect(retryable(cut), code).toBe(false)
      expect(outcomeLine(cut), code).toBe("You sent it · Send unconfirmed: cut off")
    }
    expect(retryable(failed(78, ago(1_000)))).toBe(false)
  })

  test("once he dismisses it, goes to Done and asks nothing more", () => {
    const item = failed(76, ago(1_000))
    expect(sendFailed(item)).toBe(false)
    expect(needsYou(item)).toBe(false)
    expect(inboxView([item], NOW).done.map((i) => i.ref)).toEqual([76])
  })
})

describe("a sent draft before its poster acks it", () => {
  const sent = (over: Partial<InboxItem>) =>
    item({
      answer: { at: "x", choice: "send" },
      kind: "draft",
      status: "sent",
      ...over,
    } as Partial<InboxItem> & Pick<InboxItem, "kind">)

  test("reads as still sending, even once typed into the session (Merritt, on #i115 reading Delivered before Slack had it)", () => {
    const typed = { at: "x", status: "delivered", via: "session" } as const
    expect(outcomeLine(sent({ delivery: typed }))).toBe("You sent it · Sending in Slack…")
    expect(outcomeLine(sent({ delivery: { status: "pending" } }))).toBe(
      "You sent it · Sending in Slack…",
    )
    expect(
      outcomeLine(
        sent({
          delivery: typed,
          preview: { link: "https://linear.app/acme/issue/DUNE-1/x", text: "hi", to: "Cam" },
        }),
      ),
    ).toBe("You sent it · Sending to Linear…")
  })

  test("reads as it did once acked, its link opening the thread", () => {
    const link =
      "https://app.slack.com/client/T0000000000/C0MADEUP01/thread/C0MADEUP01-1700000000.000100"
    const acked = sent({
      answer: { ackedAt: "y", at: "x", choice: "send", link },
      delivery: { at: "x", status: "delivered", via: "session" },
    })
    expect(outcomeLine(acked)).toBe("You sent it · Delivered to Ops")
    expect(resultLink(acked)).toEqual({ href: link, label: "Open thread" })
    // read through bun run ask, which closed a go only before acks were stamped
    expect(outcomeLine(sent({ delivery: { at: "x", status: "delivered", via: "cli" } }))).toBe(
      "You sent it · Sending in Slack…",
    )
    expect(
      outcomeLine(
        sent({
          answer: { at: "2026-10-11T10:00:00.000Z", choice: "send" },
          delivery: { at: "x", status: "delivered", via: "cli" },
        }),
      ),
    ).toBe("You sent it · Read by Ops")
    // typed into its session before then, which the API's stale read no longer chases
    expect(
      outcomeLine(
        sent({
          answer: { at: "2026-10-11T10:00:00.000Z", choice: "send" },
          delivery: { at: "x", status: "delivered", via: "session" },
        }),
      ),
    ).toBe("You sent it · Delivered to Ops")
    expect(ACKS_STAMPED_FROM).toBe(API_ACKS_STAMPED_FROM.toISOString())
    // the web restates which answers are gos and which decisions name a place; the API's decide
    expect(GO_CHOICES).toEqual(API_GO_CHOICES)
    expect(PLACED_TYPES).toEqual(API_PLACED_TYPES)
    // acked with a link before acks were stamped
    expect(
      outcomeLine(
        sent({
          answer: { at: "x", choice: "send", link },
          delivery: { at: "x", status: "delivered", via: "session" },
        }),
      ),
    ).toBe("You sent it · Delivered to Ops")
  })
})

describe("a draft saved in Slack", () => {
  const SLACK = "https://app.slack.com/client/T0000000000/D0MADEUP11"
  const LINEAR = "https://linear.app/acme/issue/DUNE-1/x"
  const drafted = (over: Partial<InboxItem> = {}) =>
    item({
      answer: { at: "x", choice: "draft" },
      kind: "draft",
      preview: { link: SLACK, text: "hi", to: "Merritt DM" },
      status: "drafted",
      ...over,
    } as Partial<InboxItem> & Pick<InboxItem, "kind">)

  test("is offered on a Slack draft alone, as the API decides it", () => {
    const previews = [
      { link: SLACK, text: "hi", to: "Merritt DM" },
      { noLink: "a new DM", text: "hi", to: "Merritt DM" },
      { link: LINEAR, text: "hi", to: "DUNE-1" },
    ]
    const shown = previews.map((preview) => canDraft(item({ kind: "draft", preview })))
    expect(shown).toEqual([true, true, false])
    expect(shown).toEqual(previews.map(API_savesDraft))
    expect(canDraft(item({ kind: "decision" }))).toBe(false)
    expect(canDraft(item({ kind: "update" }))).toBe(false)
    expect(canDraft(drafted())).toBe(false)
  })

  test("reads as being saved until its poster acks it, then as done", () => {
    const typed = { at: "x", status: "delivered", via: "session" } as const
    expect(outcomeLine(drafted({ delivery: typed }))).toBe(
      "You saved it as a draft · Saving a Slack draft…",
    )
    expect(itemState(drafted({ delivery: typed }))).toBe("sending")
    expect(outcomeLine(drafted({ answer: { at: "x", choice: "draft", editedText: "hey" } }))).toBe(
      "You saved it as a draft with changes · Saving a Slack draft…",
    )
    const acked = drafted({
      answer: { ackedAt: "y", at: "x", choice: "draft", link: SLACK },
      delivery: typed,
    })
    expect(itemState(acked)).toBe("done")
    expect(outcomeLine(acked)).toBe("You saved it as a draft · Delivered to Ops")
  })

  test("reads as not saved, gray, when Slack refused it and its poster closed it with why", () => {
    const refused = drafted({
      answer: {
        ackedAt: "y",
        at: "x",
        choice: "draft",
        noLink: "Merritt DM already holds a draft",
      },
      delivery: { at: "x", status: "delivered", via: "session" },
    })
    expect(itemState(refused)).toBe("closed")
    expect(inboxLight(refused)).toBe("idle")
    expect(outcomeLine(refused)).toBe("Draft not saved: Merritt DM already holds a draft")
    // a go with no page, such as a budget, still reads as carried out
    const budget = item({
      answer: { ackedAt: "y", at: "x", choice: "approve", noLink: "a budget has no page" },
      kind: "decision",
      status: "approved",
    })
    expect(itemState(budget)).toBe("done")
  })
})

describe("the order the owner sees: an update keeps its place and shows a new-update mark", () => {
  const a = item({ kind: "decision", ref: 1 })
  const b = item({ kind: "decision", ref: 2 })
  const c = item({ kind: "update", ref: 3 })
  const d = item({ kind: "update", ref: 4 })
  const refs = (list: InboxItem[]) => list.map((i) => i.ref)

  test("the first read shows every item in the API's order, holding none", () => {
    const view = pinnedView([c, a, b], null)
    expect(refs(view.rows)).toEqual([3, 1, 2])
    expect(view.held).toEqual([])
  })

  test("an item keeps its place when the API moves it", () => {
    expect(refs(pinnedView([b, c, a], ["id-3", "id-1", "id-2"]).rows)).toEqual([3, 1, 2])
  })

  test("an item that arrived since waits behind the pill, newest first, and pushes nothing", () => {
    const view = pinnedView([d, a, c, b], ["id-1", "id-2"])
    expect(refs(view.rows)).toEqual([1, 2])
    expect(refs(view.held)).toEqual([4, 3])
  })

  test("an item that left the list drops out and the rest keep their order", () => {
    expect(refs(pinnedView([b, c], ["id-3", "id-1", "id-2"]).rows)).toEqual([3, 2])
  })

  test("with nothing left in view, what arrived shows at once, since nothing can move under him", () => {
    const view = pinnedView([c, d], ["id-1"])
    expect(refs(view.rows)).toEqual([4, 3])
    expect(view.held).toEqual([])
  })

  test("the pill counts what waits", () => {
    expect(newLabel(1)).toBe("1 new update")
    expect(newLabel(3)).toBe("3 new updates")
  })
})

describe("movedRows", () => {
  test("names the rows whose place changed or that are new, so their buttons pause", () => {
    // id-1 went to Done: id-2 and id-3 slid up under the cursor
    expect(movedRows(["id-1", "id-2", "id-3"], ["id-2", "id-3"])).toEqual(["id-2", "id-3"])
    // two taken from the pill: they appear on top and every row below slides down
    expect(movedRows(["id-1", "id-2"], ["id-4", "id-3", "id-1", "id-2"])).toEqual([
      "id-4",
      "id-3",
      "id-1",
      "id-2",
    ])
  })

  test("names none when nothing moved, the last row leaving included, or on the first read", () => {
    expect(movedRows(["id-1", "id-2"], ["id-1", "id-2"])).toEqual([])
    expect(movedRows(["id-1", "id-2"], ["id-1"])).toEqual([])
    expect(movedRows(null, ["id-1", "id-2"])).toEqual([])
  })

  test("pauses for 1 second", () => {
    expect(MOVED_PAUSE_MS).toBe(1_000)
  })
})

describe("an item changed after it was posted shows when it was updated", () => {
  const posted = "2026-10-12T10:00:00.000Z"
  const answered = {
    answer: { at: "2026-10-12T10:20:00.000Z", choice: "approve" as const },
    createdAt: posted,
    kind: "decision" as const,
    status: "approved" as const,
    updatedAt: "2026-10-12T10:20:00.000Z",
  }

  test("reads its change time, while one unchanged since it was posted reads none", () => {
    expect(changedAt(item(answered))).toBe("2026-10-12T10:20:00.000Z")
    expect(changedAt(item({ createdAt: posted, kind: "decision", updatedAt: posted }))).toBeNull()
  })

  test("reads an update's change time only for its poster's edit, not his read, Dismiss or a resolve", () => {
    const at = "2026-10-12T11:00:00.000Z"
    const update = { createdAt: posted, kind: "update" as const, updatedAt: at }
    // edited, unread or after his read
    expect(changedAt(item(update))).toBe(at)
    expect(changedAt(item({ ...update, readAt: "2026-10-12T10:30:00.000Z" }))).toBe(at)
    // his read stamps both times at once
    expect(changedAt(item({ ...update, readAt: at }))).toBeNull()
    expect(changedAt(item({ ...update, answer: { dismissedAt: at }, readAt: at }))).toBeNull()
    expect(
      changedAt(
        item({
          ...update,
          answer: { at, by: "builder", choice: "resolved" },
          readAt: "2026-10-12T10:30:00.000Z",
        }),
      ),
    ).toBeNull()
  })

  test("reads Updated when it changed after the last look and before this one began", () => {
    const changed = item(answered)
    expect(updatedSince(changed, "2026-10-12T10:10:00.000Z", "2026-10-12T10:30:00.000Z")).toBe(true)
    // seen at the last look
    expect(updatedSince(changed, "2026-10-12T10:20:00.000Z", "2026-10-12T10:30:00.000Z")).toBe(
      false,
    )
    // changed as he looks: it shows in place, not as Updated
    expect(updatedSince(changed, "2026-10-12T10:10:00.000Z", "2026-10-12T10:15:00.000Z")).toBe(
      false,
    )
    // before any look, every change is new
    expect(updatedSince(changed, null, "2026-10-12T10:30:00.000Z")).toBe(true)
    expect(
      updatedSince(item({ createdAt: posted, kind: "decision", updatedAt: posted }), null, posted),
    ).toBe(false)
  })
})

describe("itemState", () => {
  const go = (fields: Partial<InboxItem>) =>
    item({
      answer: { at: "2026-10-12T10:20:00.000Z", choice: "approve" },
      kind: "decision",
      status: "approved",
      ...fields,
    } as Partial<InboxItem> & Pick<InboxItem, "kind">)

  test("open while it needs him, an unread update included", () => {
    expect(itemState(item({ kind: "decision" }))).toBe("open")
    expect(itemState(item({ kind: "update" }))).toBe("open")
  })

  test("a go is sending until its poster closes it, then done", () => {
    expect(itemState(go({ delivery: { status: "pending" } }))).toBe("sending")
    expect(
      itemState(
        go({
          answer: {
            at: "2026-10-12T10:20:00.000Z",
            choice: "approve",
            link: "https://github.com/acme/archive/pull/270",
          },
          delivery: { at: "2026-10-12T10:20:01.000Z", status: "delivered", via: "session" },
        }),
      ),
    ).toBe("done")
  })

  test("failed when the answer did not reach its poster", () => {
    expect(
      itemState(go({ delivery: { code: "NOT_FOUND", reason: "gone", status: "failed" } })),
    ).toBe("failed")
  })

  test("a failure he dismissed asks nothing of him and is being carried out by no one, so it reads closed, and done once its poster closes it anyway", () => {
    const failed = { code: "NOT_FOUND", reason: "gone", status: "failed" } as const
    const dismissed = {
      at: "2026-10-12T10:20:00.000Z",
      choice: "approve",
      dismissedAt: "2026-10-12T10:25:00.000Z",
    } as const
    expect(itemState(go({ answer: dismissed, delivery: failed }))).toBe("closed")
    expect(
      itemState(
        go({
          answer: { ...dismissed, link: "https://github.com/acme/archive/pull/270" },
          delivery: failed,
        }),
      ),
    ).toBe("done")
  })

  test("closed once denied, discarded, settled by its poster, or an update read", () => {
    expect(
      itemState(
        go({ answer: { at: "2026-10-12T10:20:00.000Z", choice: "deny" }, status: "denied" }),
      ),
    ).toBe("closed")
    expect(
      itemState(
        go({
          answer: { at: "2026-10-12T10:20:00.000Z", by: "ops", choice: "settled" },
          status: "done",
        } as Partial<InboxItem>),
      ),
    ).toBe("closed")
    expect(itemState(item({ kind: "update", readAt: "2026-10-12T11:00:00.000Z" }))).toBe("closed")
  })
})

describe("inboxLight: the Inbox takes status colours as the sidebar does", () => {
  const answered = (fields: Partial<InboxItem>) =>
    item({
      answer: { at: "2026-10-12T10:20:00.000Z", choice: "approve" },
      kind: "decision",
      status: "approved",
      ...fields,
    } as Partial<InboxItem> & Pick<InboxItem, "kind">)

  test("draws the sidebar's light for the state that means the same", () => {
    expect(inboxLight(item({ kind: "decision" }))).toBe("waiting")
    expect(inboxLight(item({ kind: "draft" }))).toBe("waiting")
    expect(inboxLight(answered({ delivery: { status: "pending" } }))).toBe("working")
    expect(
      inboxLight(
        answered({
          answer: {
            at: "2026-10-12T10:20:00.000Z",
            choice: "approve",
            link: "https://github.com/acme/archive/pull/270",
          },
        }),
      ),
    ).toBe("done")
    expect(
      inboxLight(answered({ delivery: { code: "NOT_FOUND", reason: "gone", status: "failed" } })),
    ).toBe("failing")
    expect(
      inboxLight(answered({ answer: { at: "2026-10-12T10:20:00.000Z", choice: "deny" } })),
    ).toBe("idle")
    expect(inboxLight(item({ kind: "update", readAt: "2026-10-12T11:00:00.000Z" }))).toBe("idle")
  })

  test("an unread update keeps its dot rather than a light", () => {
    expect(inboxLight(item({ kind: "update" }))).toBeNull()
  })

  test("reads its icon and colour from the sidebar's own table: the orange eye, the blue spinner, the green check, the red error, the gray circle", () => {
    const spec = (light: ReturnType<typeof inboxLight>) => {
      const { Icon, spins, tone } = statusIcon(light!)
      return { Icon: Icon as unknown, spins, tone }
    }
    expect(spec("waiting")).toEqual({ Icon: RiSearchEyeLine, spins: false, tone: "caution" })
    expect(spec("working")).toEqual({ Icon: RiLoader4Line, spins: true, tone: "info" })
    expect(spec("done")).toEqual({ Icon: RiCheckboxCircleLine, spins: false, tone: "success" })
    expect(spec("failing")).toEqual({ Icon: RiErrorWarningLine, spins: false, tone: "destructive" })
    expect(spec("idle")).toEqual({
      Icon: RiCheckboxBlankCircleLine,
      spins: false,
      tone: "inactive",
    })
  })
})

describe("movedStep", () => {
  test("a cold load pauses nothing: the rows that arrive with the first read did not move under him", () => {
    const loading = movedStep(null, null)
    expect(loading).toEqual({ before: null, moved: [] })
    expect(movedStep(loading.before, ["id-1", "id-2"])).toEqual({
      before: ["id-1", "id-2"],
      moved: [],
    })
  })

  test("after that, a row whose place changed is named", () => {
    expect(movedStep(["id-1", "id-2"], ["id-2"])).toEqual({ before: ["id-2"], moved: ["id-2"] })
  })
})

describe("a take by the keyboard", () => {
  const pill = { contains: (node: unknown) => node === "pill" || node === "pill's icon" }

  test("hands focus to the first card while the pill holds it, so it never drops to the page", () => {
    expect(focusAfterTake(pill, "pill", "first card")).toBe("first card")
    expect(focusAfterTake(pill, "pill's icon", "first card")).toBe("first card")
  })

  test("moves no focus when the pill does not hold it or is gone", () => {
    expect(focusAfterTake(pill, "a card's Approve", "first card")).toBeNull()
    expect(focusAfterTake(null, "pill", "first card")).toBeNull()
    expect(focusAfterTake(pill, "pill", null)).toBeNull()
  })
})

describe("Schedule (put an ask away until a time, then it asks again)", () => {
  const sleeping = item({
    answer: { snoozedUntil: "2026-10-08T12:00:00.000Z" } as never,
    kind: "decision",
  })
  const failedSend = item({
    answer: { at: "2026-10-09T06:00:00.000Z", choice: "send" },
    delivery: { code: "CMUX_FAILED", reason: "no answer from cmux", status: "failed" },
    kind: "draft",
    ref: 76,
    status: "sent",
  })

  test("an open decision or draft with no answer yet is schedulable", () => {
    expect(schedulable(item({ kind: "decision" }))).toBe(true)
    expect(schedulable(item({ kind: "draft" }))).toBe(true)
  })

  test("an answered, failed or dismissed one is not: its answer, or Retry, is already given", () => {
    expect(
      schedulable(
        item({ answer: { at: "x", choice: "approve" }, kind: "decision", status: "approved" }),
      ),
    ).toBe(false)
    expect(schedulable(failedSend)).toBe(false)
  })

  test("a chat reply its poster is not done with is, since he can open its card again and put it away; one its poster closed is not", () => {
    expect(schedulable(item({ answer: { at: "x", choice: "replied" }, kind: "decision" }))).toBe(
      true,
    )
    expect(
      schedulable(item({ answer: { ackedAt: "y", at: "x", choice: "replied" }, kind: "draft" })),
    ).toBe(false)
  })

  test("an update is never, and one still sleeping is, so it can be put away again", () => {
    expect(schedulable(item({ kind: "update" }))).toBe(false)
    expect(schedulable(sleeping)).toBe(true)
  })

  test("a sleeping item in a stale read asks nothing in its outcome line, its actions still on the card", () => {
    expect(outcomeLine(sleeping)).toBeNull()
    expect(needsYou(sleeping)).toBe(true)
  })

  test("another zone moves Schedule's fixed times to its wall clock, its daylight saving change included", () => {
    // 10:00Z on Sunday the 18th is 11:00 in Lisbon (UTC+1), whose clocks go back to UTC on the 25th
    expect(
      scheduleChoices(new Date("2026-10-18T10:00:00.000Z"), "Europe/Lisbon").map(
        ({ at, label, when }) => [label, at, when],
      ),
    ).toEqual([
      ["In 30 minutes", "2026-10-18T10:30:00.000Z", "Sun 18 Oct, 11:30"],
      ["In 1 hour", "2026-10-18T11:00:00.000Z", "Sun 18 Oct, 12:00"],
      ["In 3 hours", "2026-10-18T13:00:00.000Z", "Sun 18 Oct, 14:00"],
      ["This evening 18:00", "2026-10-18T17:00:00.000Z", "Sun 18 Oct, 18:00"],
      ["Tomorrow 09:00", "2026-10-19T08:00:00.000Z", "Mon 19 Oct, 09:00"],
      ["Next Sun 09:00", "2026-10-25T09:00:00.000Z", "Sun 25 Oct, 09:00"],
    ])
  })

  test("Schedule's fixed times, in the owner's zone, each naming its day, soonest first, with none past and none twice", () => {
    const at = (now: string) =>
      scheduleChoices(new Date(now), "Asia/Kolkata").map(({ at, label, when }) => [label, at, when])
    // 10:00Z on Saturday the 17th is 15:30 IST, so this evening's 18:00 is still ahead
    expect(at("2026-10-17T10:00:00.000Z")).toEqual([
      ["In 30 minutes", "2026-10-17T10:30:00.000Z", "Sat 17 Oct, 16:00"],
      ["In 1 hour", "2026-10-17T11:00:00.000Z", "Sat 17 Oct, 16:30"],
      ["This evening 18:00", "2026-10-17T12:30:00.000Z", "Sat 17 Oct, 18:00"],
      ["In 3 hours", "2026-10-17T13:00:00.000Z", "Sat 17 Oct, 18:30"],
      ["Tomorrow 09:00", "2026-10-18T03:30:00.000Z", "Sun 18 Oct, 09:00"],
      ["Monday 09:00", "2026-10-19T03:30:00.000Z", "Mon 19 Oct, 09:00"],
      ["Next Sat 09:00", "2026-10-24T03:30:00.000Z", "Sat 24 Oct, 09:00"],
    ])
    // 14:00Z is 19:30 IST: this evening's 18:00 has passed, so it is left out
    expect(at("2026-10-17T14:00:00.000Z").map(([label]) => label)).toEqual([
      "In 30 minutes",
      "In 1 hour",
      "In 3 hours",
      "Tomorrow 09:00",
      "Monday 09:00",
      "Next Sat 09:00",
    ])
    // 02:00Z on Sunday is 07:30 IST, before its 09:00, so the morning choice is today's
    expect(at("2026-10-18T02:00:00.000Z").map(([label, iso]) => `${label} ${iso}`)).toEqual([
      "In 30 minutes 2026-10-18T02:30:00.000Z",
      "In 1 hour 2026-10-18T03:00:00.000Z",
      "Today 09:00 2026-10-18T03:30:00.000Z",
      "In 3 hours 2026-10-18T05:00:00.000Z",
      "This evening 18:00 2026-10-18T12:30:00.000Z",
      "Monday 09:00 2026-10-19T03:30:00.000Z",
      "Next Sun 09:00 2026-10-25T03:30:00.000Z",
    ])
    // 06:00Z on Sunday is 11:30 IST: tomorrow's 09:00 is Monday's, so Monday 09:00 is left out as the same moment
    expect(at("2026-10-18T06:00:00.000Z").map(([label]) => label)).toEqual([
      "In 30 minutes",
      "In 1 hour",
      "In 3 hours",
      "This evening 18:00",
      "Tomorrow 09:00",
      "Next Sun 09:00",
    ])
    // 09:30Z is 15:00 IST: in 3 hours is this evening's 18:00, which keeps its name
    expect(at("2026-10-17T09:30:00.000Z").map(([label]) => label)).toEqual([
      "In 30 minutes",
      "In 1 hour",
      "This evening 18:00",
      "Tomorrow 09:00",
      "Monday 09:00",
      "Next Sat 09:00",
    ])
    // 20:30Z on Sunday is 02:00 IST on Monday: Today 09:00 is this Monday's, so the coming Monday is a week out, the same moment as Next Mon, which keeps that name
    expect(at("2026-10-18T20:30:00.000Z").map(([label, iso]) => `${label} ${iso}`)).toEqual([
      "In 30 minutes 2026-10-18T21:00:00.000Z",
      "In 1 hour 2026-10-18T21:30:00.000Z",
      "In 3 hours 2026-10-18T23:30:00.000Z",
      "Today 09:00 2026-10-19T03:30:00.000Z",
      "This evening 18:00 2026-10-19T12:30:00.000Z",
      "Next Mon 09:00 2026-10-26T03:30:00.000Z",
    ])
    // now with seconds: "In 30 minutes" from 08:30:00.4 IST and "In 3 hours" from 15:00:00.25 IST show the same minute as a named time, which keeps it
    expect(at("2026-10-18T03:00:00.400Z").map(([label]) => label)).toEqual([
      "Today 09:00",
      "In 1 hour",
      "In 3 hours",
      "This evening 18:00",
      "Monday 09:00",
      "Next Sun 09:00",
    ])
    expect(at("2026-10-17T09:30:00.250Z").map(([label]) => label)).toEqual([
      "In 30 minutes",
      "In 1 hour",
      "This evening 18:00",
      "Tomorrow 09:00",
      "Monday 09:00",
      "Next Sat 09:00",
    ])
  })
})

describe("Pick a time's moment", () => {
  // local times throughout, since the Calendar's day and the time field are in this browser's time zone
  const now = new Date(2026, 9, 18, 14, 30)
  const today = new Date(2026, 9, 18)

  test("a day and a time name that moment on that day", () => {
    expect(pickedAt(new Date(2026, 9, 20), "09:00", now)).toEqual(new Date(2026, 9, 20, 9, 0))
  })

  test("today names a time still ahead, and nothing at or before now", () => {
    expect(pickedAt(today, "15:00", now)).toEqual(new Date(2026, 9, 18, 15, 0))
    expect(pickedAt(today, "14:30", now)).toBeNull()
    expect(pickedAt(today, "09:00", now)).toBeNull()
  })

  test("a past day, no day, or a time the field left empty, half typed or out of range names nothing, so Set stays off", () => {
    expect(pickedAt(new Date(2026, 9, 17), "23:59", now)).toBeNull()
    expect(pickedAt(undefined, "09:00", now)).toBeNull()
    expect(pickedAt(new Date(2026, 9, 20), "", now)).toBeNull()
    expect(pickedAt(new Date(2026, 9, 20), "9:", now)).toBeNull()
    expect(pickedAt(new Date(2026, 9, 20), "24:00", now)).toBeNull()
    expect(pickedAt(new Date(2026, 9, 20), "09:60", now)).toBeNull()
  })
})

describe("a labelled ask's Send before a pick", () => {
  test("says to pick a side while none is picked, and nothing once one is", () => {
    expect(sendWhy(null)).toBe("Pick Approve or Deny first")
    expect(sendWhy("approve")).toBeNull()
    expect(sendWhy("deny")).toBeNull()
  })
})

describe("a card's Cmd/Ctrl+Enter", () => {
  const enter = {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: "Enter",
    keyCode: 13,
    metaKey: true,
    repeat: false,
    shiftKey: false,
    target: "box" as const,
  }
  const card = {
    choosing: false,
    draftReady: false,
    picked: false,
  }

  test("leaves a labelled ask's pick to the Questionnaire", () => {
    expect(
      cardKey({ ...enter, target: "choice" }, { ...card, choosing: true, picked: true }),
    ).toBeNull()
  })

  test("holds the key on a labelled ask with no side picked, so nothing is sent and no error shows", () => {
    expect(cardKey({ ...enter, target: "choice" }, { ...card, choosing: true })).toBe("hold")
  })

  test("leaves a key pressed on a link or a button to the browser, so Cmd+Enter on Open thread opens it and sends nothing", () => {
    for (const shown of [{ ...card, draftReady: true }, { ...card, choosing: true }, card]) {
      expect(cardKey({ ...enter, target: "elsewhere" }, shown)).toBe("leave")
    }
  })

  test("presses a draft's Send while it would pass, and holds the key on any other card", () => {
    expect(cardKey(enter, { ...card, draftReady: true })).toBe("send")
    expect(cardKey(enter, card)).toBe("hold")
  })

  test("holds a repeat, so a held key sends once", () => {
    expect(cardKey({ ...enter, repeat: true }, { ...card, draftReady: true })).toBe("hold")
  })

  test("ignores Enter alone, Shift, Alt, any other key and a key that composes text", () => {
    for (const key of [
      { ...enter, metaKey: false },
      { ...enter, shiftKey: true },
      { ...enter, altKey: true },
      { ...enter, key: "a" },
      { ...enter, isComposing: true },
      { ...enter, keyCode: 229 },
    ]) {
      expect(cardKey(key, { ...card, draftReady: true })).toBeNull()
    }
  })
})

describe("a card a chat reply collapsed opens again", () => {
  const replied = { at: "2026-10-23T10:00:00.000Z", choice: "replied" as const }

  test("an open decision or draft whose answer is a chat reply its poster is not done with", () => {
    expect(reopenable(item({ answer: replied, kind: "decision" }))).toBe(true)
    expect(reopenable(item({ answer: replied, kind: "draft" }))).toBe(true)
  })

  test("not an open one with no answer, an answered one, a reply its poster closed, or an update", () => {
    expect(reopenable(item({ kind: "draft" }))).toBe(false)
    expect(
      reopenable(item({ answer: { at: "x", choice: "send" }, kind: "draft", status: "sent" })),
    ).toBe(false)
    expect(
      reopenable(
        item({ answer: { ...replied, ackedAt: "2026-10-23T10:05:00.000Z" }, kind: "draft" }),
      ),
    ).toBe(false)
    expect(reopenable(item({ kind: "update" }))).toBe(false)
  })

  const e = {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: "e",
    metaKey: false,
    repeat: false,
    shiftKey: false,
    target: "elsewhere" as const,
  }

  test("E alone opens or folds it, Caps Lock's included, on the card, a button or a choice", () => {
    expect(reopenKey(e)).toBe(true)
    expect(reopenKey({ ...e, key: "E" })).toBe(true)
    expect(reopenKey({ ...e, target: "choice" })).toBe(true)
  })

  test("never E typed in its box, with a modifier, held down or composing, nor another key", () => {
    expect(reopenKey({ ...e, target: "box" })).toBe(false)
    for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat", "isComposing"])
      expect(reopenKey({ ...e, [modifier]: true })).toBe(false)
    expect(reopenKey({ ...e, key: "E", shiftKey: true })).toBe(false)
    expect(reopenKey({ ...e, key: "Enter" })).toBe(false)
  })
})
