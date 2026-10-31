import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { send } from "../../../../../packages/scripts/src/dm/send"
import {
  ownerMessages,
  PLAYGROUND,
  readSent,
  USER,
} from "../../../../../packages/scripts/src/dm/slack"
import { DM, fakeDm, OWNER } from "./fake-dm"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const pass = async () => undefined
// each send's data folder, a scratch one, where its record and lock live
const io = (slack: ReturnType<typeof fakeDm>["slack"], body = "the body", into?: string) => {
  const dir = into ?? mkdtempSync(join(tmpdir(), "dm-send-"))
  dirs.push(dir)
  return { body, channel: DM, dir, leak: pass, owner: OWNER, slack }
}
const recorded = async (dir: string) => [...(await readSent(dir))]
const marks = (dm: ReturnType<typeof fakeDm>) =>
  dm.calls.filter((c) => c.method === "conversations.mark").map((c) => c.params.ts)
const edits = (dm: ReturnType<typeof fakeDm>) => dm.calls.filter((c) => c.method === "chat.update")

describe("dm send", () => {
  test("after an owner message: three posts in order, PLAYGROUND, the body, USER, marked unread from the owner's message", async () => {
    const dm = fakeDm([{ text: "how is it going", ts: "1000.000100", user: OWNER }])
    await send(io(dm.slack))
    expect(dm.texts()).toEqual(["how is it going", PLAYGROUND, "the body", USER])
    expect(edits(dm)).toEqual([])
    expect(marks(dm)).toEqual(["1000.000100"])
  })

  test("when the DM's latest message is our USER line, it becomes the PLAYGROUND line and two posts follow, marked from the message before it", async () => {
    const dm = fakeDm([
      { text: "the earlier body", ts: "1000.000100", user: OWNER },
      { text: USER, ts: "1001.000100", user: OWNER },
    ])
    await send(io(dm.slack, "an update"))
    expect(dm.texts()).toEqual(["the earlier body", PLAYGROUND, "an update", USER])
    expect(marks(dm)).toEqual(["1000.000100"])
  })

  test("two owner messages below our USER line: the send edits nothing and opens with a fresh PLAYGROUND line", async () => {
    const dm = fakeDm([
      { text: "the earlier body", ts: "1000.000100", user: OWNER },
      { text: USER, ts: "1001.000100", user: OWNER },
      { text: "one", ts: "1002.000100", user: OWNER },
      { text: "two", ts: "1003.000100", user: OWNER },
    ])
    await send(io(dm.slack))
    expect(edits(dm)).toEqual([])
    expect(dm.texts().slice(2)).toEqual(["one", "two", PLAYGROUND, "the body", USER])
    expect(marks(dm)).toEqual(["1003.000100"])
  })

  test("an owner message that lands between the body and the USER line: the body ends with the USER line, and the USER post opens our reply to it", async () => {
    let dropped = false
    const dm = fakeDm([{ text: "status?", ts: "1000.000100", user: OWNER }], (text) => {
      if (text === USER && !dropped) {
        dropped = true
        dm.add("wait, one more thing")
      }
    })
    const repaired = io(dm.slack)
    await send(repaired)
    expect(dm.texts()).toEqual([
      "status?",
      PLAYGROUND,
      `the body\n${USER}`,
      "wait, one more thing",
      PLAYGROUND,
    ])
    expect(
      ownerMessages(dm.messages, OWNER, await readSent(repaired.dir)).map((m) => m.text),
    ).toEqual(["status?", "wait, one more thing"])
    const next = fakeDm(dm.messages.map((m) => ({ ...m })))
    await send(io(next.slack, "the answer"))
    expect(next.texts().slice(3)).toEqual(["wait, one more thing", PLAYGROUND, "the answer", USER])
  })

  test("a body no-playground-leak refuses posts nothing and names the refusal", async () => {
    const dm = fakeDm([{ text: "hi", ts: "1000.000100", user: OWNER }])
    await expect(
      send({ ...io(dm.slack), leak: async () => "no-playground-leak hook refused it" }),
    ).rejects.toThrow("no-playground-leak hook refused it")
    expect(dm.calls).toEqual([])
  })
})

describe("dm send's record", () => {
  test("records each post as it lands, so a send whose USER post fails leaves its PLAYGROUND line and body on record", async () => {
    const dm = fakeDm([{ text: "hi", ts: "1000.000100", user: OWNER }], (text) => {
      if (text === USER) throw new Error("ratelimited")
    })
    const failed = io(dm.slack)
    await expect(send(failed)).rejects.toThrow("ratelimited")
    expect(await recorded(failed.dir)).toEqual([dm.messages[1]!.ts, dm.messages[2]!.ts])
    expect(dm.texts()).toEqual(["hi", PLAYGROUND, "the body"])
  })

  test("a reused USER line is recorded as the PLAYGROUND line it becomes", async () => {
    const dm = fakeDm([
      { text: "hi", ts: "1000.000100", user: OWNER },
      { text: USER, ts: "1001.000100", user: OWNER },
    ])
    const reused = io(dm.slack)
    await send(reused)
    expect(await recorded(reused.dir)).toEqual([
      "1001.000100",
      dm.messages[2]!.ts,
      dm.messages[3]!.ts,
    ])
  })
})

describe("two sends at once", () => {
  test("the second waits for the first, so the frames stay whole, nothing is repaired and every post is recorded", async () => {
    const dm = fakeDm([{ text: "hi", ts: "1000.000100", user: OWNER }])
    const first = io(dm.slack, "one")
    await Promise.all([send(first), send(io(dm.slack, "two", first.dir))])
    // either may take the lock first, so the bodies' order is open and the frame's is not
    const [a, b] = [dm.texts()[2], dm.texts()[4]].sort()
    expect(dm.texts()).toEqual(["hi", PLAYGROUND, dm.texts()[2], PLAYGROUND, dm.texts()[4], USER])
    expect([a, b]).toEqual(["one", "two"])
    expect(edits(dm).map((c) => c.params.text)).toEqual([PLAYGROUND])
    expect(await recorded(first.dir)).toEqual(dm.messages.slice(1).map((m) => m.ts))
  })
})

describe("send.ts as dm send runs it", () => {
  test("with no token, it exits 1 with one plain error line", async () => {
    const script = join(import.meta.dir, "../../../../../packages/scripts/src/dm/send.ts")
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.SLACK_TOKEN
    const child = Bun.spawn([process.execPath, script, "/nonexistent/body.md"], {
      env,
      stderr: "pipe",
    })
    const [err, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
    expect(code).toBe(1)
    expect(err).toBe(
      "error: usage: SLACK_TOKEN=<token> send.ts <file>, run by playground dm send\n",
    )
  })
})
