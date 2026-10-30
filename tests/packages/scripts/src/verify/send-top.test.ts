import { describe, expect, test } from "bun:test"

import { parseLine } from "../../../../../api/hono/src/lib/dashboard/transcript"
import {
  atEndResult,
  behindResult,
  blankResult,
  countResult,
  earlierTurnLines,
  edgeResult,
  frameResult,
  heldOffResult,
  heldResult,
  atRest,
  modeResult,
  noFlashResult,
  notDownResult,
  scrolledResult,
  secondBox,
  sendTopResult,
  steadyResult,
} from "../../../../../packages/scripts/src/verify/send-top"

describe("earlierTurnLines", () => {
  test("the long turn's question carries a human origin, so the parser shows it as a prompt (#467)", () => {
    const lines = earlierTurnLines("t1", 0, { cwd: "/fixture/dispatcher", sessionId: "s1" }).map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    )
    const question = lines.find((line) => line.type === "user")
    expect(question?.origin).toEqual({ kind: "human" })
  })

  test("each line of the long turn carries its own time, so the order never rests on the sort (#467)", () => {
    const lines = earlierTurnLines("t1", 0, { cwd: "/fixture/dispatcher", sessionId: "s1" }).map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    )
    expect(new Set(lines.map((line) => line.timestamp)).size).toBe(lines.length)
  })

  test("the parser reads the question as a person's message and every call as a step", () => {
    const entries = earlierTurnLines("t1", 0, {
      cwd: "/fixture/dispatcher",
      sessionId: "s1",
    }).flatMap((line) => parseLine(line))
    expect(entries[0]).toMatchObject({ kind: "human", text: "An earlier question." })
    expect(entries.filter((entry) => entry.kind === "tool")).toHaveLength(420)
  })
})

describe("edgeResult", () => {
  test("passes a stream that starts at the page's top edge", () => {
    expect(edgeResult("e", 0).ok).toBe(true)
  })

  test("fails the page's top padding above the stream, since the stream meets the top edge", () => {
    const result = edgeResult("e", 24)
    expect(result.ok).toBe(false)
    expect(result.detail).toBe("the stream starts 24px below the top edge")
  })

  test("fails when the stream is not on the page", () => {
    expect(edgeResult("e", null).ok).toBe(false)
  })
})

describe("sendTopResult", () => {
  test("passes a sent message resting at the anchor with the step before it out of view", () => {
    expect(sendTopResult("send-top", { previousBottom: -4, top: 12 }).ok).toBe(true)
  })

  test("passes the first message of a stream, which has no step before it", () => {
    expect(sendTopResult("send-top", { previousBottom: null, top: 12 }).ok).toBe(true)
  })

  test("fails the stock 64px peek, which left the cut-off last lines of the reply before it in view", () => {
    const result = sendTopResult("send-top", { previousBottom: 48, top: 64 })
    expect(result.ok).toBe(false)
    expect(result.detail).toBe("the sent message sits 64px from the top, not 12px")
  })

  test("fails a message flush with the top, as before langsdk's room above, which left a send no margin", () => {
    const result = sendTopResult("send-top", { previousBottom: -16, top: 0 })
    expect(result.ok).toBe(false)
    expect(result.detail).toBe("the sent message sits 0px from the top, not 12px")
  })

  test("fails a message at the anchor with the step before it still showing above", () => {
    const result = sendTopResult("send-top", { previousBottom: 8, top: 12 })
    expect(result.ok).toBe(false)
    expect(result.detail).toBe("8px of the step before it shows above the sent message")
  })

  test("fails when the message is not in the stream", () => {
    expect(sendTopResult("send-top", null).ok).toBe(false)
  })
})

describe("scrolledResult", () => {
  test("passes a view that stays where he scrolled it", () => {
    expect(
      scrolledResult("s", { previousBottom: 150, top: 200 }, { previousBottom: 150, top: 200 }).ok,
    ).toBe(true)
  })

  test("fails a view that pulled back to his message by itself", () => {
    const result = scrolledResult(
      "s",
      { previousBottom: 150, top: 200 },
      { previousBottom: -4, top: 12 },
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain("moved by itself")
  })

  test("fails when his scroll never moved the view", () => {
    expect(
      scrolledResult("s", { previousBottom: -4, top: 12 }, { previousBottom: -4, top: 12 }).ok,
    ).toBe(false)
  })
})

describe("blankResult", () => {
  test("passes a turn past the screen with langsdk's 36px under its last row", () => {
    expect(blankResult("b", { blank: 36, past: true }).ok).toBe(true)
    expect(blankResult("b", { blank: 37, past: true }).ok).toBe(true)
  })

  test("fails blank space under the last row, and a turn that ends flush", () => {
    expect(blankResult("b", { blank: 358, past: true })).toMatchObject({
      detail: "358px of space under the last row, not 36px",
      ok: false,
    })
    expect(blankResult("b", { blank: 0, past: true }).ok).toBe(false)
  })

  test("fails a turn that never grew past the screen, and a stream not on the page", () => {
    expect(blankResult("b", { blank: 36, past: false }).ok).toBe(false)
    expect(blankResult("b", null).ok).toBe(false)
  })
})

describe("heldResult", () => {
  test("passes a view that held or moved down with the turn", () => {
    expect(heldResult("h", 9415, 9415).ok).toBe(true)
    expect(heldResult("h", 9415, 9500).ok).toBe(true)
  })

  test("fails a view pulled up against his scroll, and a stream not on the page", () => {
    expect(heldResult("h", 9415, 9327)).toMatchObject({
      detail: "the view was pulled up 88px after his scroll",
      ok: false,
    })
    expect(heldResult("h", null, 9415).ok).toBe(false)
  })
})

describe("frameResult", () => {
  test("passes a sent message that glides to the top and then holds within 2px a frame", () => {
    expect(frameResult("f", [null, null, 300, 120, 40, 13, 12, 12, 11, 12]).ok).toBe(true)
  })

  test("fails a sent message that leaves its rest and comes back", () => {
    expect(frameResult("f", [null, 200, 12, 12, -90, 12])).toMatchObject({
      detail: "the sent message moved -102px in one frame, 2 frames after it rested",
      ok: false,
    })
  })

  test("fails a sent message that never rests at the top", () => {
    expect(frameResult("f", [null, 300, 200]).ok).toBe(false)
  })
})

describe("noFlashResult (#928)", () => {
  test("passes a send that showed Scroll to end in no frame", () => {
    expect(noFlashResult("f", [false, false, false])).toMatchObject({
      detail: "Scroll to end showed in none of 3 frames",
      ok: true,
    })
  })

  test("fails one that showed it in any frame, naming how many", () => {
    expect(noFlashResult("f", [false, true, true, false])).toMatchObject({
      detail: "Scroll to end showed in 2 of 4 frames",
      ok: false,
    })
  })

  test("fails a log that never ran", () => {
    expect(noFlashResult("f", null).ok).toBe(false)
    expect(noFlashResult("f", []).ok).toBe(false)
  })
})

describe("atEndResult", () => {
  test("passes a view at the end, within 2px", () => {
    expect(atEndResult("e", 0).ok).toBe(true)
    expect(atEndResult("e", 2).ok).toBe(true)
  })

  test("fails a view left above the end, and a stream not on the page", () => {
    expect(atEndResult("e", 310)).toMatchObject({
      detail: "the view sits 310px above the end",
      ok: false,
    })
    expect(atEndResult("e", null).ok).toBe(false)
  })
})

describe("steadyResult", () => {
  test("passes a view that holds or moves down frame by frame", () => {
    expect(steadyResult("s", [100, 100, 126, 152, 153]).ok).toBe(true)
  })

  test("fails a log too short to judge", () => {
    expect(steadyResult("s", []).ok).toBe(false)
    expect(steadyResult("s", [100]).ok).toBe(false)
  })

  test("fails a view that moves up on its own", () => {
    expect(steadyResult("s", [100, 126, 98, 126])).toMatchObject({
      detail: "the view moved up 28px in one frame",
      ok: false,
    })
  })
})

describe("heldOffResult", () => {
  test("passes a view left above the end as rows land while Reading", () => {
    expect(heldOffResult("h", 310)).toMatchObject({
      detail: "the view held, 310px above the end",
      ok: true,
    })
  })

  test("fails a view that followed the end, and a stream not on the page", () => {
    expect(heldOffResult("h", 0).ok).toBe(false)
    expect(heldOffResult("h", null).ok).toBe(false)
  })
})

describe("atRest (#1088)", () => {
  test("a mode read from a view that never came to rest fails, naming why, and one at rest stands", () => {
    const read = modeResult("m", "watching", "watching")
    expect(atRest(true, read)).toEqual(read)
    expect(atRest(false, read)).toMatchObject({
      detail: "the view never came to rest; the chat reads watching",
      ok: false,
    })
  })
})

describe("modeResult (#1088)", () => {
  test("passes the mode it wants, and fails another or a bar not on the page", () => {
    expect(modeResult("m", "reading", "reading")).toMatchObject({
      detail: "the chat reads reading",
      ok: true,
    })
    expect(modeResult("m", "watching", "reading")).toMatchObject({
      detail: "the chat reads watching",
      ok: false,
    })
    expect(modeResult("m", null, "watching")).toMatchObject({
      detail: "the chat's Checkpoint bar is not on the page",
      ok: false,
    })
  })

  test("a failure names where the view sat at the read", () => {
    const view = "scrollTop 10392 of scrollHeight 11040, clientHeight 648, 516px held"
    expect(modeResult("m", "reading", "watching", view)).toMatchObject({
      detail: `the chat reads reading, ${view}`,
      ok: false,
    })
    expect(modeResult("m", "watching", "watching", view).detail).toBe("the chat reads watching")
  })
})

describe("behindResult (#1088)", () => {
  test("passes words that read behind during a turn and then Watching", () => {
    expect(
      behindResult("b", ["Watching", "Watching· 20s behind", "Watching· 5s behind", "Watching"]),
    ).toMatchObject({
      detail: 'it read "Watching· 20s behind", then Watching',
      ok: true,
    })
  })

  test("fails words that never read behind, or never caught up", () => {
    expect(behindResult("b", ["Watching"]).ok).toBe(false)
    expect(behindResult("b", ["Watching", "Watching· 10s behind"])).toMatchObject({
      detail: 'it read "Watching· 10s behind" and never caught up',
      ok: false,
    })
  })
})

describe("countResult (#1088)", () => {
  test("passes Reading with a count, with or without a space before its dot", () => {
    expect(countResult("c", "Reading· 3 new").ok).toBe(true)
    expect(countResult("c", "Reading · 99+ new").ok).toBe(true)
  })

  test("fails Reading with no count, Watching, and a bar not on the page", () => {
    expect(countResult("c", "Reading").ok).toBe(false)
    expect(countResult("c", "Watching· 5s behind").ok).toBe(false)
    expect(countResult("c", null).ok).toBe(false)
  })
})

describe("notDownResult", () => {
  test("passes a view that held or moved up after his scroll up", () => {
    expect(notDownResult("n", 120, 120).ok).toBe(true)
    expect(notDownResult("n", 120, 40).ok).toBe(true)
  })

  test("fails a view that moved down on its own, and a message not on the page", () => {
    expect(notDownResult("n", 120, 400)).toMatchObject({
      detail: "the view moved down 280px after his scroll up",
      ok: false,
    })
    expect(notDownResult("n", null, 10).ok).toBe(false)
  })
})

describe("secondBox", () => {
  // composer.test.ts holds composerId to the same id for the second dispatcher
  test("is the second dispatcher's own box on its view, never #composer, which is Playground's in the aside there", () => {
    expect(secondBox("dispatcher-2")).toBe("#composer-dispatcher-2")
  })
})
