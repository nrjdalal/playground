import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  behind,
  behindLabel,
  carriesHand,
  CATCH_UP_S,
  chatShown,
  countKeys,
  countLabel,
  DEFAULT_MODE,
  dropsLead,
  endOf,
  glideState,
  glideTo,
  HAND_MS,
  HAND_RESUME_MS,
  handDown,
  handShift,
  handUp,
  heldRoom,
  jumpEnds,
  jumpKey,
  jumpTarget,
  KEY_SCROLL_FRAMES,
  keyMovedView,
  keyWay,
  labelDue,
  lineFor,
  LIVE_GLIDE_MS,
  LIVE_MAX_MS,
  LIVE_STILL_MS,
  liveHolds,
  liveStart,
  markSteps,
  MAX_BEHIND_S,
  MAX_SPEED_UP,
  MESSAGE_REST_MS,
  modeAfter,
  newCount,
  OPEN_FOLLOW_MS,
  opensAtEnd,
  ownEnd,
  PACE_MAX,
  PACE_RESET_MS,
  paceAfterScrollDown,
  paceNow,
  paceOf,
  pastSince,
  pulledUp,
  READS_NEAR,
  readsView,
  READING_WPM,
  ROW_WORDS,
  rowKey,
  secondsOf,
  SEEN_OBSERVER,
  sendAnchor,
  sendLeads,
  showsToLatest,
  spansOf,
  speedUp,
  startsScrollDown,
  stepTo,
  STREAM_ROW,
  STREAM_SCROLL,
  TO_LATEST_HOLD_MS,
  TO_LATEST_PAST,
  TOUCH_RESUME_MS,
  turnRoom,
  typingIn,
  viewShift,
  watchKeyScroll,
  scrollsInside,
  wheelsToEnd,
  wheelWay,
  wordsIn,
  type RowSpan,
} from "../../../../../../web/next/src/components/dashboard/chat-scroll"

// cn resolves from the web app's own packages, which this directory cannot see.
const { cn } = (await import(
  Bun.resolveSync("cn", join(import.meta.dir, "../../../../../../web/next"))
)) as {
  cn: (...classes: string[]) => string
}

const OPENED = "2026-10-07T10:00:00.000Z"

const record = (id: string, at: string, entryId: string | null = null) => ({ at, entryId, id })

describe("sendAnchor", () => {
  test("anchors the newest message sent since the view opened", () => {
    const records = [
      record("a", "2026-10-07T10:01:00.000Z", "e1"),
      record("b", "2026-10-07T10:02:00.000Z"),
    ]
    expect(sendAnchor(records, OPENED)).toBe("b")
  })

  test("keeps the anchor once the transcript holds the message, so the reply goes on filling below it", () => {
    const records = [record("b", "2026-10-07T10:02:00.000Z", "e2")]
    expect(sendAnchor(records, OPENED)).toBe("b")
  })

  test("anchors nothing sent before the view opened, so opening a session never jumps to an old message", () => {
    const records = [record("a", "2026-10-07T09:59:00.000Z", "e1")]
    expect(sendAnchor(records, OPENED)).toBeNull()
  })

  test("anchors nothing when nothing was sent", () => {
    expect(sendAnchor([], OPENED)).toBeNull()
  })

  test("reads a time it cannot parse as not sent from here", () => {
    expect(sendAnchor([record("a", "not a time")], OPENED)).toBeNull()
  })
})

describe("rowKey", () => {
  test("keys a delivered entry by the message that sent it, so its row keeps the same element", () => {
    expect(rowKey("e2", record("b", "2026-10-07T10:02:00.000Z", "e2"))).toBe("b")
  })

  test("keys any other entry by its own id", () => {
    expect(rowKey("e3", null)).toBe("e3")
  })
})

describe("handUp", () => {
  test("a scroll up just after his wheel, touch or key, leaving the end, is his", () => {
    expect(handUp(-120, 16, false, "up")).toBe(true)
    expect(handUp(-120, HAND_MS, false, "either")).toBe(true)
  })

  test("not one just after his wheel or key pointed down: rows dropped above the view lower its scroll position as he scrolls to the end", () => {
    expect(handUp(-26, 16, false, "down")).toBe(false)
  })

  test("not a scroll down, nor one up the browser made with no hand on the stream (a row shrinking at the end)", () => {
    expect(handUp(120, 16, false, "up")).toBe(false)
    expect(handUp(-0.4, 16, false, "up")).toBe(false)
    expect(handUp(-120, HAND_MS + 1, false, "up")).toBe(false)
  })

  test("nor the browser's clamp to a new, higher end just after his wheel reached it, which leaves the view at the end", () => {
    expect(handUp(-24, 16, true, "up")).toBe(false)
  })
})

describe("carriesHand", () => {
  test("a scroll his way inside HAND_MS carries his gesture on, so a smooth scroll longer than HAND_MS stays his to its end", () => {
    expect(carriesHand(80, 100, "down")).toBe(true)
    expect(carriesHand(-80, 100, "up")).toBe(true)
    expect(carriesHand(80, HAND_MS, "either")).toBe(true)
  })

  test("a scroll against his way, past HAND_MS, or of no distance does not", () => {
    expect(carriesHand(80, 100, "up")).toBe(false)
    expect(carriesHand(-80, 100, "down")).toBe(false)
    expect(carriesHand(80, HAND_MS + 1, "down")).toBe(false)
    expect(carriesHand(0.2, 100, "down")).toBe(false)
  })
})

describe("handWay", () => {
  test("a wheel points the way its delta does, and one of no distance (a press on the scrollbar) either way", () => {
    expect(wheelWay(120)).toBe("down")
    expect(wheelWay(-120)).toBe("up")
    expect(wheelWay(0)).toBe("either")
  })

  test("a scroll key points its own way, Space down and Shift+Space up", () => {
    for (const key of ["ArrowDown", "End", "PageDown"]) expect(keyWay(key, false)).toBe("down")
    for (const key of ["ArrowUp", "Home", "PageUp"]) expect(keyWay(key, false)).toBe("up")
    expect(keyWay(" ", false)).toBe("down")
    expect(keyWay(" ", true)).toBe("up")
    expect(keyWay("a", false)).toBe("either")
  })
})

describe("keyMovedView", () => {
  test("a scroll key after which the stream moved counts as his move, wherever focus sat (PageUp on a tool row's button scrolls it: 406 to 69)", () => {
    for (const key of ["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]) {
      expect(keyMovedView(key, 406, 69)).toBe(true)
    }
  })

  test("a scroll key that moved nothing does not: a Space in a card's text field, an arrow on its options (tester, round 1)", () => {
    for (const key of [" ", "ArrowDown", "ArrowUp"]) expect(keyMovedView(key, 406, 406)).toBe(false)
  })

  test("nor does any other key, even while the stream moves on its own", () => {
    for (const key of ["a", "Enter", "Tab", "Shift"]) expect(keyMovedView(key, 406, 69)).toBe(false)
  })
})

describe("endOf", () => {
  test("the view at the very end, to within a pixel, reads at the end", () => {
    expect(endOf({ clientHeight: 800, scrollHeight: 11_810, scrollTop: 11_010 })).toBe(true)
    expect(endOf({ clientHeight: 800, scrollHeight: 11_810, scrollTop: 11_009.2 })).toBe(true)
  })

  test("a view a step above the end does not, as when a long turn's oldest step dropped while a new one landed and the height held still", () => {
    expect(endOf({ clientHeight: 800, scrollHeight: 11_810, scrollTop: 10_930 })).toBe(false)
  })
})

describe("watchKeyScroll", () => {
  // the view's scrollTop on each frame after the key, as a smooth PageUp moves it, and the frames run by hand
  const run = (key: string, tops: number[]) => {
    const frames: (() => void)[] = []
    let frame = 0
    let calls = 0
    watchKeyScroll(
      key,
      () => tops[Math.min(frame, tops.length - 1)] ?? 0,
      () => (calls += 1),
      (next) => frames.push(next),
    )
    while (frames.length) {
      frame += 1
      frames.shift()?.()
    }
    return { calls, frames: frame }
  }

  test("a smooth PageUp that starts moving only on the third frame counts as his move (390px wide)", () => {
    expect(run("PageUp", [11228, 11228, 11228, 11176, 11106])).toEqual({ calls: 1, frames: 3 })
  })

  test("a key that never moves the view stops being watched after KEY_SCROLL_FRAMES", () => {
    expect(run(" ", [406])).toEqual({ calls: 0, frames: KEY_SCROLL_FRAMES })
  })

  test("a move that starts after those frames is not the key's", () => {
    const tops = [...Array(KEY_SCROLL_FRAMES + 1).fill(406), 69]
    expect(run("PageUp", tops).calls).toBe(0)
  })

  test("any other key is not watched", () => {
    expect(run("a", [406, 69])).toEqual({ calls: 0, frames: 0 })
  })
})

describe("the stream's scroller settings", () => {
  test("an anchor rests 12px below the top, langsdk's room above its reply, with none of the step before it peeking above (the stock 64px cut the previous reply's last lines mid-line)", () => {
    expect(STREAM_SCROLL.scrollMargin).toBe(12)
    expect(STREAM_SCROLL.scrollPreviousItemPeek).toBe(0)
  })

  test("the margin stays under the rows' 16px gap, so the step before an anchor ends above the top edge, out of view", () => {
    expect(STREAM_SCROLL.scrollMargin).toBeLessThan(16)
  })

  test("a row overrides the stock item's content-visibility guess, so the anchor and its spacer are placed by real heights", () => {
    const stock = "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]"
    const merged = cn(stock, STREAM_ROW).split(" ")
    expect(merged).not.toContain("[content-visibility:auto]")
    expect(merged).not.toContain("[contain-intrinsic-size:auto_10rem]")
    expect(merged).toContain("[content-visibility:visible]")
  })
})

describe("turnRoom", () => {
  const room = (lastBottom: number) =>
    turnRoom({ anchorTop: 1000, height: 800, lastBottom, margin: 12 })

  test("a short turn keeps the room the anchor needs to rest 12px below the top", () => {
    expect(room(1200)).toBe(588)
  })

  test("the room gives back exactly what the turn gains, so the stream's height holds still", () => {
    expect(room(1200) - room(1300)).toBe(100)
  })

  test("a turn past the screen keeps no room, so nothing scrolls past its last line", () => {
    expect(room(1788)).toBe(0)
    expect(room(2400)).toBe(0)
  })
})

describe("heldRoom", () => {
  test("keeps what the anchor needs while the view sits above the stream's end", () => {
    expect(heldRoom({ lastBottom: 1200, need: 300, viewBottom: 1300 })).toBe(300)
  })

  test("never ends the stream above the view's bottom edge, so an anchor change or freeing the view cannot pull the view up", () => {
    expect(heldRoom({ lastBottom: 1200, need: 212, viewBottom: 1500 })).toBe(300)
    expect(heldRoom({ lastBottom: 1200, need: 0, viewBottom: 1656 })).toBe(456)
  })

  test("shrinks only as the turn grows, to nothing once it fills the view", () => {
    expect(heldRoom({ lastBottom: 1300, need: 0, viewBottom: 1500 })).toBe(200)
    expect(heldRoom({ lastBottom: 1600, need: 0, viewBottom: 1500 })).toBe(0)
  })

  test("while the view follows the end it never grows, so a sub-pixel at the end cannot round it up a pixel at a time", () => {
    expect(heldRoom({ held: 0, lastBottom: 1200, need: 0, viewBottom: 1200.4 })).toBe(0)
    expect(heldRoom({ held: 2, lastBottom: 1200, need: 0, viewBottom: 1202.4 })).toBe(2)
    expect(heldRoom({ held: 200, lastBottom: 1300, need: 0, viewBottom: 1400 })).toBe(100)
  })
})

describe("handShift", () => {
  test("his scroll up moves the rows on screen with it, left for its scroll event", () => {
    expect(handShift(true, -200, 200)).toBe(true)
  })
  test("rows dropped above move the scroll position and hold the rows: the browser's own", () => {
    expect(handShift(true, -80, 0)).toBe(false)
  })
  test("with no hand moving, or no row to judge by, a move is the browser's", () => {
    expect(handShift(false, -200, 200)).toBe(false)
    expect(handShift(true, -200, null)).toBe(false)
  })
  test("a view that did not move holds nothing back", () => {
    expect(handShift(true, 0, 0)).toBe(false)
  })
})

describe("pulledUp", () => {
  const box = (scrollTop: number) => ({ clientHeight: 800, scrollHeight: 2000, scrollTop })

  test("a view cut back to the new end, above where it sat, was pulled up", () => {
    expect(pulledUp(box(1200), 1212, 12)).toBe(true)
  })

  test("his own scroll and a glide down were not", () => {
    expect(pulledUp(box(1200), 1200, 0)).toBe(false)
    expect(pulledUp(box(1200), 1100, -100)).toBe(false)
  })

  test("a view short of the end, the room under it held, lowered by the browser's scroll anchoring as a row below it shrank, was", () => {
    expect(pulledUp(box(900), 932, 32)).toBe(true)
  })

  test("the browser's scroll anchoring, rows dropped above leaving the rows in view where they sat, was not", () => {
    expect(pulledUp(box(1200), 1226, 0)).toBe(false)
  })

  test("a cut that moved the rows in view down was", () => {
    expect(pulledUp(box(1200), 1236, 36)).toBe(true)
  })

  test("a change that dropped the rows that were in view was not, since where the view sat no longer says where to put it back", () => {
    expect(pulledUp(box(1200), 5236, null)).toBe(false)
  })
})

describe("readsView", () => {
  test("Reading reads what sits in view on every scroll, so a pull at the end is put back", () => {
    expect(readsView("reading", { clientHeight: 600, scrollHeight: 5000, scrollTop: 1000 })).toBe(
      true,
    )
  })

  test("Watching reads it only near the end, where a row shrinking past the gap below pulls the view up", () => {
    expect(readsView("watching", { clientHeight: 600, scrollHeight: 5000, scrollTop: 4400 })).toBe(
      true,
    )
    expect(
      readsView("watching", {
        clientHeight: 600,
        scrollHeight: 5000,
        scrollTop: 4400 - READS_NEAR + 1,
      }),
    ).toBe(true)
    expect(
      readsView("watching", {
        clientHeight: 600,
        scrollHeight: 5000,
        scrollTop: 4400 - READS_NEAR,
      }),
    ).toBe(false)
    expect(readsView("watching", { clientHeight: 600, scrollHeight: 5000, scrollTop: 1000 })).toBe(
      false,
    )
  })
})

describe("opensAtEnd", () => {
  test("the chat follows its end while its first rows settle, so it opens at the end however late they grow", () => {
    expect(
      opensAtEnd({ handAt: Number.NEGATIVE_INFINITY, now: 500, openedAt: 0, sent: false }),
    ).toBe(true)
  })

  test("it lets go once the rows have had OPEN_FOLLOW_MS, at his first hand, or at his first send", () => {
    expect(
      opensAtEnd({
        handAt: Number.NEGATIVE_INFINITY,
        now: OPEN_FOLLOW_MS + 1,
        openedAt: 0,
        sent: false,
      }),
    ).toBe(false)
    expect(opensAtEnd({ handAt: 200, now: 500, openedAt: 0, sent: false })).toBe(false)
    expect(
      opensAtEnd({ handAt: Number.NEGATIVE_INFINITY, now: 500, openedAt: 0, sent: true }),
    ).toBe(false)
    expect(
      opensAtEnd({ handAt: Number.NEGATIVE_INFINITY, now: 500, openedAt: null, sent: false }),
    ).toBe(false)
  })
})

describe("scrollsInside", () => {
  const block = (overflowY: string, scrollTop: number, parentElement: unknown) => ({
    clientHeight: 200,
    overflowY,
    parentElement,
    scrollHeight: 600,
    scrollTop,
  })
  const box = { parentElement: null }
  const style = globalThis.getComputedStyle
  beforeAll(() => {
    globalThis.getComputedStyle = ((el: { overflowY: string }) => ({
      overflowY: el.overflowY,
    })) as never
  })
  afterAll(() => {
    globalThis.getComputedStyle = style
  })
  const inside = (target: unknown, deltaY: number) =>
    scrollsInside(target as Element, box as unknown as Element, deltaY)

  test("a wheel over a code block that can still scroll its way moves the block, not the view", () => {
    expect(
      inside(
        {
          overflowY: "visible",
          parentElement: block("auto", 100, box),
          scrollHeight: 0,
          clientHeight: 0,
          scrollTop: 0,
        },
        40,
      ),
    ).toBe(true)
    expect(inside(block("auto", 100, box), -40)).toBe(true)
  })

  test("a block at its end that way, one that cannot scroll, or the view itself leaves the wheel to the view", () => {
    expect(inside(block("auto", 400, box), 40)).toBe(false)
    expect(inside(block("auto", 0, box), -40)).toBe(false)
    expect(inside(block("visible", 100, box), 40)).toBe(false)
    expect(inside(box, 40)).toBe(false)
  })
})

describe("wheelsToEnd", () => {
  const box = (scrollTop: number) => ({ clientHeight: 648, scrollHeight: 11040, scrollTop })

  test("his wheel down that reaches the very end turns Reading to Watching, at the end already, where it fires no scroll, or within its reach", () => {
    expect(wheelsToEnd(box(10392), "reading", 40)).toBe(true)
    expect(wheelsToEnd(box(10192), "reading", 5000)).toBe(true)
    expect(wheelsToEnd(box(10352), "reading", 40)).toBe(true)
  })

  test("a wheel up, a wheel short of the end, or Watching already changes nothing", () => {
    expect(wheelsToEnd(box(10392), "reading", -40)).toBe(false)
    expect(wheelsToEnd(box(10192), "reading", 40)).toBe(false)
    expect(wheelsToEnd(box(10392), "watching", 40)).toBe(false)
  })

  test("his scroll to the end while the room held under a send shrinks turns Watching", () => {
    // his wheel down from 200px short of the end, then his scroll lands at the end, then the room under his send is cut by 300px, clamping the view below where it sat, then the scroll event reads it
    const view = box(10192)
    const before = view.scrollTop
    let mode: "reading" | "watching" = "reading"
    if (wheelsToEnd(view, mode, 5000)) mode = "watching"
    view.scrollTop = view.scrollHeight - view.clientHeight
    view.scrollHeight -= 300
    view.scrollTop = Math.min(view.scrollTop, view.scrollHeight - view.clientHeight)
    const delta = view.scrollTop - before
    if (mode === "reading" && endOf(view) && ownEnd(delta, "down")) mode = "watching"
    expect(delta).toBeLessThan(0)
    expect(mode).toBe("watching")
  })
})

describe("ownEnd", () => {
  test("an end reached scrolling down is his, by wheel, key or a drag of the scrollbar", () => {
    expect(ownEnd(120, "down")).toBe(true)
    expect(ownEnd(4, "either")).toBe(true)
  })

  test("not one reached just after his wheel or key pointed up: the view put back where it sat as a row at the end shrinks, or his send's glide running on", () => {
    expect(ownEnd(120, "up")).toBe(false)
  })

  test("an end the room brings him after his scroll up, or with no scroll at all, is not", () => {
    expect(ownEnd(-200, "down")).toBe(false)
    expect(ownEnd(0, "down")).toBe(false)
  })
})

describe("viewShift", () => {
  test("is how far what sat at the middle of the view moved down the screen", () => {
    expect(viewShift({ at: 300, row: 100 }, { at: 332, row: 132 })).toBe(32)
  })

  test("falls back to its row when that element has gone, as the status line does when a turn ends", () => {
    expect(viewShift({ at: 300, row: 100 }, { at: null, row: 132 })).toBe(32)
  })

  test("is unknown only once its row has gone too", () => {
    expect(viewShift({ at: 300, row: 100 }, { at: null, row: null })).toBeNull()
  })
})

describe("the chat's mode", () => {
  test("a chat with no mode stored starts Watching, the live tail he asked for", () => {
    expect(DEFAULT_MODE).toBe("watching")
  })

  test("his scroll up while Watching switches to Reading at once, so he can stop and read", () => {
    expect(modeAfter("watching", "up")).toBe("reading")
  })

  test("his own scroll to the very end while Reading goes back to Watching", () => {
    expect(modeAfter("reading", "end")).toBe("watching")
  })

  test("a click flips it either way", () => {
    expect(modeAfter("reading", "click")).toBe("watching")
    expect(modeAfter("watching", "click")).toBe("reading")
  })

  test("a jump to his previous message stops to read", () => {
    expect(modeAfter("watching", "jump-up")).toBe("reading")
    expect(modeAfter("reading", "jump-up")).toBe("reading")
  })
})

describe("a send in each mode", () => {
  test("a send made while Reading takes the top", () => {
    expect(sendLeads("m-1", { id: "m-1", leads: true })).toBe(true)
  })

  test("a send made while Watching lands at the bottom and takes nothing", () => {
    expect(sendLeads("m-1", { id: "m-1", leads: false })).toBe(false)
  })

  test("a newer send than the one recorded takes nothing until it is recorded, and no send takes nothing", () => {
    expect(sendLeads("m-2", { id: "m-1", leads: true })).toBe(false)
    expect(sendLeads(null, null)).toBe(false)
  })
})

describe("handDown", () => {
  test("a scroll down just after his wheel, touch or key is his", () => {
    expect(handDown(40, 100, "down")).toBe(true)
    expect(handDown(40, 100, "either")).toBe(true)
  })

  test("not one just after his wheel or key pointed up", () => {
    expect(handDown(40, 100, "up")).toBe(false)
  })

  test("a scroll down long after his hand is the glide's or the browser's", () => {
    expect(handDown(40, HAND_MS + 1, "down")).toBe(false)
  })

  test("a scroll up or none is not a scroll down", () => {
    expect(handDown(-40, 100, "down")).toBe(false)
    expect(handDown(0.2, 100, "down")).toBe(false)
  })
})

describe("paceOf: Watching at reading speed", () => {
  test("250 words a minute at 1x", () => {
    expect(READING_WPM).toBe(250)
    expect(secondsOf(250)).toBe(60)
    expect(secondsOf(250, 2)).toBe(30)
  })

  test("a closed tool row, thinking or subagent run reads as 3 words, under a second", () => {
    expect(ROW_WORDS).toBe(3)
    expect(secondsOf(ROW_WORDS)).toBeLessThan(1)
  })

  test("at reading speed the glide covers the pixels below in the seconds their words take to read", () => {
    const pace = paceOf({ pixels: 600, words: 50 })
    expect(pace.seconds).toBeCloseTo(12)
    expect(pace.pxPerS).toBeCloseTo(50)
    expect(pace.jump).toBe(false)
  })

  test("a faster learned pace covers them sooner", () => {
    expect(paceOf({ pace: 2, pixels: 600, words: 50 }).pxPerS).toBeCloseTo(100)
  })

  test("past 30s behind it speeds up smoothly, up to 4x at 2 minutes", () => {
    expect(speedUp(CATCH_UP_S)).toBe(1)
    expect(speedUp(CATCH_UP_S + 1)).toBeGreaterThan(1)
    expect(speedUp((CATCH_UP_S + MAX_BEHIND_S) / 2)).toBeCloseTo(2.5)
    expect(speedUp(MAX_BEHIND_S)).toBe(MAX_SPEED_UP)
    expect(speedUp(MAX_BEHIND_S * 3)).toBe(MAX_SPEED_UP)
  })

  test("past 2 minutes behind it jumps", () => {
    const words = ((MAX_BEHIND_S + 1) * READING_WPM) / 60
    expect(paceOf({ pixels: 5000, words }).jump).toBe(true)
    expect(paceOf({ pixels: 5000, words: (MAX_BEHIND_S * READING_WPM) / 60 }).jump).toBe(false)
  })

  test("pixels with no words under them (the room under the last row) pass at once, and nothing below is no move", () => {
    expect(paceOf({ pixels: 36, words: 0 }).pxPerS).toBe(Number.POSITIVE_INFINITY)
    expect(paceOf({ pixels: 0, words: 10 }).pxPerS).toBe(0)
  })

  test("words come from the row's text", () => {
    expect(wordsIn("  one two\nthree  ")).toBe(3)
    expect(wordsIn("")).toBe(0)
  })
})

const span = (key: string, top: number, height: number, words: number, rests = true): RowSpan => ({
  height,
  key,
  rests,
  top,
  words,
})

describe("behind and lineFor", () => {
  const rows = [span("a", 0, 100, 10), span("b", 116, 200, 40), span("c", 332, 100, 6, false)]

  test("what is below the view's bottom: its pixels to the last row's end, a cut row counting its share below", () => {
    expect(behind(rows, 216)).toEqual({ pixels: 216, words: 20 + 6 })
  })

  test("nothing below once the line passes the last row", () => {
    expect(behind(rows, 500)).toEqual({ pixels: 0, words: 0 })
    expect(behind([], 0)).toEqual({ pixels: 0, words: 0 })
  })

  test("the line with a number of words below it, for the jump to 30s behind", () => {
    expect(lineFor(rows, 6)).toBe(332)
    expect(lineFor(rows, 26)).toBe(216)
    expect(lineFor(rows, 1000)).toBe(0)
  })
})

describe("glideTo: a beat at each message", () => {
  const rows = [span("a", 0, 100, 10), span("tool", 116, 30, 3, false), span("b", 162, 100, 20)]

  test("the glide rests with a new message 12px below the top when it would carry it past", () => {
    expect(glideTo({ by: 200, from: 100, margin: 12, max: 1000, rows })).toEqual({
      restAt: "b",
      to: 150,
    })
  })

  test("a tool row is no rest", () => {
    expect(glideTo({ by: 20, from: 90, margin: 12, max: 1000, rows })).toEqual({
      restAt: null,
      to: 110,
    })
  })

  test("from a rest it goes on past the row it rested at", () => {
    expect(glideTo({ by: 10, from: 150, margin: 12, max: 1000, rows }).restAt).toBeNull()
  })

  test("it never goes past the end", () => {
    expect(glideTo({ by: 500, from: 900, margin: 12, max: 950, rows: [] }).to).toBe(950)
  })

  test("a turn that opens with tool rows rests at each of its reply's words, never at the turn's top", () => {
    const rows = spansOf(
      [{ height: 600, id: "turn", rests: [250, 480], top: 100 }],
      new Map([["turn", { rests: false, words: 60 }]]),
    )
    expect(glideTo({ by: 400, from: 0, margin: 12, max: 2000, rows })).toEqual({
      restAt: "turn@0",
      to: 238,
    })
    expect(glideTo({ by: 400, from: 238, margin: 12, max: 2000, rows })).toEqual({
      restAt: "turn@1",
      to: 468,
    })
  })

  test("a row that rests as a whole, his message or a card, rests at its own top alone", () => {
    const rows = spansOf(
      [{ height: 80, id: "his", rests: [110], top: 100 }],
      new Map([["his", { rests: true, words: 5 }]]),
    )
    expect(glideTo({ by: 400, from: 0, margin: 12, max: 2000, rows })).toEqual({
      restAt: "his",
      to: 88,
    })
    expect(glideTo({ by: 400, from: 88, margin: 12, max: 2000, rows }).restAt).toBeNull()
  })
})

describe("stepTo: reduced motion steps row by row", () => {
  const rows = [span("a", 0, 100, 10), span("b", 116, 200, 40)]

  test("the view shows the top of the last row the glide has reached, at the same pace", () => {
    expect(stepTo({ at: 50, margin: 12, max: 500, rows })).toBe(0)
    expect(stepTo({ at: 110, margin: 12, max: 500, rows })).toBe(104)
  })

  test("and the end once it gets there", () => {
    expect(stepTo({ at: 500, margin: 12, max: 500, rows })).toBe(500)
  })
})

describe("liveHolds", () => {
  // clicked at 10s, the view where the last frame left it
  const clicked = { liveAt: 10_000, movedAt: null, top: 400, wrote: 400 }

  test("nothing holds the glide without a jump to live", () => {
    expect(liveHolds({ ...clicked, liveAt: null, now: 10_100, top: 500 })).toEqual({
      holds: false,
      movedAt: null,
    })
  })

  test("a jump to live holds the glide for 600ms even while the view is still", () => {
    expect(LIVE_GLIDE_MS).toBe(600)
    expect(liveHolds({ ...clicked, now: 10_599 }).holds).toBe(true)
    expect(liveHolds({ ...clicked, now: 10_600 }).holds).toBe(false)
  })

  // the hook reads movement from these two alone: wired false, a smooth scroll still running past 600ms would end the hold, and the glide's write mid-way cancel it
  test("the view moved when its top sits more than 0.5px off where the last frame left it", () => {
    expect(liveHolds({ ...clicked, now: 10_700, top: 401 })).toEqual({
      holds: true,
      movedAt: 10_700,
    })
    expect(liveHolds({ ...clicked, now: 10_700, top: 400.5 })).toEqual({
      holds: false,
      movedAt: null,
    })
    expect(liveHolds({ ...clicked, now: 10_700, top: 401, wrote: null }).holds).toBe(false)
  })

  test("past 600ms a still frame mid-scroll keeps the hold, which ends once the view has been still 100ms", () => {
    // a smooth scroll from 1,200px behind ran 611 to 694ms (measured), and the glide's write mid-way cancelled it
    expect(LIVE_STILL_MS).toBe(100)
    expect(liveHolds({ ...clicked, movedAt: 10_650, now: 10_749 })).toEqual({
      holds: true,
      movedAt: 10_650,
    })
    expect(liveHolds({ ...clicked, movedAt: 10_650, now: 10_750 })).toEqual({
      holds: false,
      movedAt: null,
    })
  })

  test("it gives the view back to the glide after 2s however long the view keeps moving", () => {
    expect(LIVE_MAX_MS).toBe(2000)
    expect(liveHolds({ ...clicked, now: 11_999, top: 401 }).holds).toBe(true)
    expect(liveHolds({ ...clicked, now: 12_000, top: 401 }).holds).toBe(false)
  })
})

describe("liveStart", () => {
  test("a smooth jump to live holds from its click", () => {
    expect(liveStart({ now: 10_000, reduced: false, smooth: true })).toBe(10_000)
  })

  test("an instant one holds nothing, nor any under reduced motion, where the jump is instant", () => {
    expect(liveStart({ now: 10_000, reduced: false, smooth: false })).toBeNull()
    expect(liveStart({ now: 10_000, reduced: true, smooth: true })).toBeNull()
  })
})

describe("glideState", () => {
  const base = { downAt: null, now: 10_000, pressed: false, releasedAt: null, restUntil: null }

  test("it moves when nothing holds it", () => {
    expect(glideState(base)).toEqual({ state: "moving", until: null })
  })

  test("it rests 1.5s at a message", () => {
    expect(MESSAGE_REST_MS).toBe(1500)
    expect(glideState({ ...base, restUntil: 11_500 })).toEqual({ state: "resting", until: 11_500 })
    expect(glideState({ ...base, now: 11_500, restUntil: 11_500 }).state).toBe("moving")
  })

  test("it pauses while a pointer is down or text is selected, and goes on 1s after", () => {
    expect(TOUCH_RESUME_MS).toBe(1000)
    expect(glideState({ ...base, pressed: true })).toEqual({ state: "paused", until: null })
    expect(glideState({ ...base, releasedAt: 9500 })).toEqual({ state: "paused", until: 10_500 })
    expect(glideState({ ...base, releasedAt: 9000 }).state).toBe("moving")
  })

  test("after his own scroll down it yields, and goes on from his place 2s after", () => {
    expect(HAND_RESUME_MS).toBe(2000)
    expect(glideState({ ...base, downAt: 9000 })).toEqual({ state: "yielded", until: 11_000 })
    expect(glideState({ ...base, downAt: 8000 }).state).toBe("moving")
  })

  test("a pause outranks a rest, so his hold is never cut short", () => {
    expect(glideState({ ...base, pressed: true, restUntil: 11_000 }).state).toBe("paused")
  })
})

describe("behindLabel and labelDue", () => {
  test("caught up it reads Watching alone", () => {
    expect(behindLabel(0)).toEqual({ band: "caught-up", text: null })
    expect(behindLabel(2)).toEqual({ band: "caught-up", text: null })
  })

  test("behind, it says how far, rounded to 5s", () => {
    expect(behindLabel(12)).toEqual({ band: "behind", text: "10s behind" })
    expect(behindLabel(13)).toEqual({ band: "behind", text: "15s behind" })
    expect(behindLabel(3)).toEqual({ band: "behind", text: "5s behind" })
  })

  test("it takes a new reading at most once a second while moving, held through a rest or pause, and at once when caught up", () => {
    expect(labelDue({ caughtUp: false, sinceLast: 1000, state: "moving" })).toBe(true)
    expect(labelDue({ caughtUp: false, sinceLast: 400, state: "moving" })).toBe(false)
    expect(labelDue({ caughtUp: false, sinceLast: 5000, state: "resting" })).toBe(false)
    expect(labelDue({ caughtUp: false, sinceLast: 5000, state: "paused" })).toBe(false)
    expect(labelDue({ caughtUp: true, sinceLast: 0, state: "yielded" })).toBe(true)
  })
})

describe("the learned pace", () => {
  const now = Date.parse("2026-10-19T00:00:00Z")

  test("a chat with none reads at 1x", () => {
    expect(paceNow(null, now)).toBe(1)
  })

  test("each scroll down while behind raises it 25%", () => {
    const once = paceAfterScrollDown(null, now)
    expect(once).toEqual({ at: now, pace: 1.25 })
    expect(paceAfterScrollDown(once, now).pace).toBeCloseTo(1.5625)
  })

  test("it stops at 2x", () => {
    expect(PACE_MAX).toBe(2)
    expect(paceAfterScrollDown({ at: now, pace: 1.9 }, now).pace).toBe(2)
  })

  test("a week with no change puts it back to 1x", () => {
    expect(paceNow({ at: now - PACE_RESET_MS + 1, pace: 1.5 }, now)).toBe(1.5)
    expect(paceNow({ at: now - PACE_RESET_MS, pace: 1.5 }, now)).toBe(1)
    expect(paceAfterScrollDown({ at: now - PACE_RESET_MS, pace: 2 }, now).pace).toBe(1.25)
  })
})

describe("↑ and ↓: his previous and next message", () => {
  const tops = [100, 600, 1200]

  test("from between two of his messages, up goes to the one above and down to the one below", () => {
    expect(jumpTarget(tops, 800, 12, "up")).toBe(1)
    expect(jumpTarget(tops, 800, 12, "down")).toBe(2)
  })

  test("from one resting at the top, up goes to the one before and down to the one after", () => {
    expect(jumpTarget(tops, 588, 12, "up")).toBe(0)
    expect(jumpTarget(tops, 588, 12, "down")).toBe(2)
  })

  test("from one a pixel or two off its rest, as the room under a reply growing moves it, that one is still the one he is on", () => {
    for (const viewTop of [586, 587, 589, 590]) {
      expect(jumpTarget(tops, viewTop, 12, "up")).toBe(0)
      expect(jumpTarget(tops, viewTop, 12, "down")).toBe(2)
    }
  })

  test("nowhere at either end", () => {
    expect(jumpTarget(tops, 88, 12, "up")).toBeNull()
    expect(jumpTarget(tops, 1188, 12, "down")).toBeNull()
    expect(jumpTarget([], 0, 12, "up")).toBeNull()
  })

  test("a button is disabled at either end, and down at the end of the stream", () => {
    expect(jumpEnds({ atEnd: false, first: 100, last: 1200, margin: 12, viewTop: 800 })).toEqual({
      mine: true,
      next: true,
      prev: true,
    })
    expect(jumpEnds({ atEnd: false, first: 100, last: 1200, margin: 12, viewTop: 88 })).toEqual({
      mine: true,
      next: true,
      prev: false,
    })
    expect(jumpEnds({ atEnd: true, first: 100, last: 1200, margin: 12, viewTop: 800 }).next).toBe(
      false,
    )
    for (const viewTop of [86, 87, 89, 90]) {
      expect(jumpEnds({ atEnd: false, first: 100, last: 1200, margin: 12, viewTop }).prev).toBe(
        false,
      )
    }
    for (const viewTop of [1186, 1187, 1189, 1190]) {
      expect(jumpEnds({ atEnd: false, first: 100, last: 1200, margin: 12, viewTop }).next).toBe(
        false,
      )
    }
    expect(jumpEnds({ atEnd: false, first: null, last: null, margin: 12, viewTop: 0 })).toEqual({
      mine: false,
      next: false,
      prev: false,
    })
  })

  test("a jump up switches to Reading", () => {
    expect(modeAfter("watching", "jump-up")).toBe("reading")
  })
})

describe("the jump's shortcut", () => {
  const key = (over: Partial<Parameters<typeof jumpKey>[0]>) =>
    jumpKey({
      altKey: true,
      ctrlKey: false,
      key: "ArrowUp",
      metaKey: false,
      shiftKey: false,
      shown: true,
      target: { tagName: "DIV" },
      ...over,
    })

  test("Alt+↑ and Alt+↓ jump", () => {
    expect(key({})).toBe("up")
    expect(key({ key: "ArrowDown" })).toBe("down")
  })

  test("not in a text field, where Option+Arrow moves the caret", () => {
    expect(key({ target: { tagName: "TEXTAREA" } })).toBeNull()
    expect(key({ target: { tagName: "INPUT" } })).toBeNull()
    expect(key({ target: { isContentEditable: true, tagName: "DIV" } })).toBeNull()
    expect(typingIn(null)).toBe(false)
  })

  test("not without Alt, nor with another modifier, nor another key", () => {
    expect(key({ altKey: false })).toBeNull()
    expect(key({ metaKey: true })).toBeNull()
    expect(key({ shiftKey: true })).toBeNull()
    expect(key({ key: "ArrowLeft" })).toBeNull()
  })

  test("not while the chat is hidden under another tab", () => {
    expect(key({ shown: false })).toBeNull()
  })

  test("the chat shows only when neither laid out away nor invisible, as the phone hides it under another tab", () => {
    const box = (style: { display?: string; visibility?: string }) => ({
      checkVisibility: (options?: { visibilityProperty?: boolean }) =>
        style.display !== "none" && !(options?.visibilityProperty && style.visibility === "hidden"),
    })
    expect(chatShown(box({}))).toBe(true)
    expect(chatShown(box({ visibility: "hidden" }))).toBe(false)
    expect(chatShown(box({ display: "none" }))).toBe(false)
    expect(chatShown(null)).toBe(false)
  })
})

describe("Reading's count", () => {
  const marks = (below: string[], seen: string[] = []) =>
    new Map([
      ...below.map((key) => [key, "below"] as const),
      ...seen.map((key) => [key, "seen"] as const),
    ])

  test("it counts the rows that landed below since it went to Reading and that he has not had in view", () => {
    expect(newCount(["a", "b", "c", "d"], new Set(["a", "b"]), marks(["d"], ["c"]))).toBe(1)
    expect(newCount(["a", "b"], new Set(["a", "b"]), marks([]))).toBe(0)
  })

  test("older rows Load older puts above never count", () => {
    expect(newCount(["x", "y", "a", "b", "c"], new Set(["a", "b"]), marks(["x", "y", "c"]))).toBe(1)
  })

  test("a row leaves the count once any of it has been in view", () => {
    expect(newCount(["a", "b", "c"], new Set(["a"]), marks([], ["b", "c"]))).toBe(0)
  })

  test("a step that lands in view counts 0 throughout: before the observer reports it, and once it reports it seen", () => {
    expect(newCount(["a", "b"], new Set(["a"]), new Map())).toBe(0)
    expect(
      newCount(["a", "b"], new Set(["a"]), markSteps(new Map(), [{ height: 40, key: "b" }])),
    ).toBe(0)
  })

  test("each step of a turn counts on its own, so a step landing in a turn already in view still counts", () => {
    const turn = (steps: number) => ({
      id: "t",
      metadata: { kind: "assistant", steps: Array.from({ length: steps }, (_, i) => `s${i}`) },
      parts: Array.from({ length: steps }, () => ({ type: "dynamic-tool" })),
    })
    const before = new Set(countKeys("t", turn(2)))
    const now = countKeys("t", turn(5))
    expect(now).toEqual(["s0", "s1", "s2", "s3", "s4"])
    expect(newCount(now, before, marks(["s2", "s3", "s4"], [...before]))).toBe(3)
  })

  test("a part the stream draws no row for never counts, and any other row counts once under its own key", () => {
    const turn = {
      id: "t",
      metadata: { kind: "assistant" },
      parts: [{ type: "step-start" }, { type: "text" }, { type: "reasoning" }],
    }
    expect(countKeys("t", turn)).toEqual(["t:1", "t:2"])
    const his = {
      id: "e1",
      metadata: { kind: "human" },
      parts: [{ type: "text" }, { type: "file" }],
    }
    expect(countKeys("sent-1", his)).toEqual(["sent-1"])
    expect(countKeys("need-1", null)).toEqual(["need-1"])
  })

  test("a step is seen only once some of its height has been at or above the view's bottom, never by touching its edge", () => {
    expect(
      markSteps(new Map(), [
        { height: 0, key: "edge" },
        { height: 0.5, key: "in" },
        { height: 10, key: undefined },
      ]),
    ).toEqual(
      new Map([
        ["edge", "below"],
        ["in", "seen"],
      ]),
    )
  })

  test("a step once seen stays seen when it is reported below again, as his scroll up leaves it there", () => {
    const was = new Map([["a", "seen" as const]])
    expect(markSteps(was, [{ height: 0, key: "a" }])).toBe(was)
  })

  test("the view reaches up without end for the count, so a step above it is seen: one Scroll to end passes, or one Load older puts there", () => {
    const [top, ...sides] = SEEN_OBSERVER.rootMargin.split(" ")
    expect(Number.parseFloat(top ?? "")).toBeGreaterThanOrEqual(1_000_000)
    expect(sides).toEqual(["0px", "0px", "0px"])
    expect(SEEN_OBSERVER.threshold.some((at) => at > 0 && at < 0.001)).toBe(true)
  })

  test("it shows up to 99, then 99+", () => {
    expect(countLabel(3)).toBe("3")
    expect(countLabel(99)).toBe("99")
    expect(countLabel(100)).toBe("99+")
  })
})

// Scrolling up just after a send once scrolled the view back down; a scroll up switches to Reading instead.
describe("startsScrollDown", () => {
  test("the first scroll down, or one after HAND_RESUME_MS without any, starts a new one", () => {
    expect(startsScrollDown(null, 1000)).toBe(true)
    expect(startsScrollDown(1000, 1000 + HAND_RESUME_MS + 1)).toBe(true)
  })

  test("each frame of the same scroll down does not, so the pace rises once a scroll", () => {
    expect(startsScrollDown(1000, 1016)).toBe(false)
    expect(startsScrollDown(1000, 1000 + HAND_RESUME_MS)).toBe(false)
  })
})

describe("dropsLead", () => {
  test("his scroll up or jump up ends a Reading send's hold on the top, even with the mode already Reading", () => {
    expect(dropsLead("up", "reading", "reading")).toBe(true)
    expect(dropsLead("jump-up", "reading", "reading")).toBe(true)
  })

  test("any change of mode ends it", () => {
    expect(dropsLead("click", "reading", "watching")).toBe(true)
    expect(dropsLead("up", "watching", "reading")).toBe(true)
    expect(dropsLead("end", "watching", "watching")).toBe(false)
  })
})

describe("Scroll to end", () => {
  const judge = (frames: { moved?: boolean; now: number; past: number }[]) => {
    let since: number | null = null
    return frames.map(({ moved = false, now, past }) => {
      since = pastSince({ moved, now, past, since })
      return showsToLatest(since, now)
    })
  }

  test("a send whose message stays on screen: the glide scrolls every frame and ends with nothing below, so no frame shows it", () => {
    const glide = [400, 300, 180, 90, 30, 0].map((past, frame) => ({
      moved: true,
      now: frame * 16,
      past,
    }))
    const rest = [
      { now: 112, past: 0 },
      { now: 600, past: 0 },
    ]
    expect(judge([...glide, ...rest])).toEqual(Array(8).fill(false))
  })

  test("a glide that runs longer than the hold still never shows it, since each frame of it is a scroll", () => {
    const frames = Array.from({ length: 40 }, (_, frame) => ({
      moved: true,
      now: frame * 16,
      past: 900 - frame * 20,
    }))
    expect(judge(frames).some(Boolean)).toBe(false)
  })

  test("a row that lands just past the bottom shows nothing: a row's height or less is not content below", () => {
    expect(
      judge([
        { now: 0, past: TO_LATEST_PAST },
        { now: 1000, past: TO_LATEST_PAST },
      ]),
    ).toEqual([false, false])
  })

  test("a long reply that runs out of view shows it once it has stayed there for the hold", () => {
    expect(
      judge([
        { now: 0, past: 0 },
        { now: 100, past: 120 },
        { now: 100 + TO_LATEST_HOLD_MS - 1, past: 260 },
        { now: 100 + TO_LATEST_HOLD_MS, past: 400 },
      ]),
    ).toEqual([false, false, false, true])
  })

  test("his scroll up shows it a hold after the view comes to rest", () => {
    expect(
      judge([
        { moved: true, now: 0, past: 300 },
        { moved: true, now: 200, past: 600 },
        { now: 200 + TO_LATEST_HOLD_MS, past: 600 },
      ]),
    ).toEqual([false, false, true])
  })

  test("once shown, his scroll with rows still past keeps it, so it never blinks under his wheel or keys", () => {
    expect(
      judge([
        { now: 0, past: 764 },
        { now: TO_LATEST_HOLD_MS, past: 764 },
        { moved: true, now: TO_LATEST_HOLD_MS + 16, past: 800 },
        { moved: true, now: TO_LATEST_HOLD_MS + 500, past: 1400 },
        { now: TO_LATEST_HOLD_MS + 520, past: 1400 },
      ]),
    ).toEqual([false, true, true, true, true])
  })

  test("rows back in view hide it at once", () => {
    expect(
      judge([
        { now: 0, past: 500 },
        { now: TO_LATEST_HOLD_MS, past: 500 },
        { moved: true, now: TO_LATEST_HOLD_MS + 50, past: 10 },
      ]),
    ).toEqual([false, true, false])
  })
})
