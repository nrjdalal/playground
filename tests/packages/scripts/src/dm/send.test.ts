import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { send } from "../../../../../packages/scripts/src/dm/send"
import { ownerMessages, PLAYGROUND, USER } from "../../../../../packages/scripts/src/dm/slack"
import { DM, fakeDm, OWNER } from "./fake-dm"

const pass = async () => undefined
const io = (slack: ReturnType<typeof fakeDm>["slack"], body = "the body") => ({
  body,
  channel: DM,
  leak: pass,
  owner: OWNER,
  slack,
})
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
    await send(io(dm.slack))
    expect(dm.texts()).toEqual([
      "status?",
      PLAYGROUND,
      `the body\n${USER}`,
      "wait, one more thing",
      PLAYGROUND,
    ])
    expect(ownerMessages(dm.messages, OWNER).map((m) => m.text)).toEqual([
      "status?",
      "wait, one more thing",
    ])
    const next = fakeDm(dm.messages.map((m) => ({ ...m })))
    await send(io(next.slack, "the answer"))
    expect(next.texts().slice(3)).toEqual(["wait, one more thing", PLAYGROUND, "the answer", USER])
  })

  test("a body no-playground-leak refuses posts nothing and names the refusal", async () => {
    const dm = fakeDm([{ text: "hi", ts: "1000.000100", user: OWNER }])
    const refused = send({
      ...io(dm.slack),
      leak: async () => "no-playground-leak hook refused it",
    })
    expect(refused).rejects.toThrow("no-playground-leak hook refused it")
    await refused.catch(() => {})
    expect(dm.calls).toEqual([])
  })
})

describe("ownerMessages", () => {
  test("reads the owner's messages outside our frame, and none from another member", () => {
    const read = [
      { text: "first", ts: "1", user: OWNER },
      { text: PLAYGROUND, ts: "2", user: OWNER },
      { text: "our body", ts: "3", user: OWNER },
      { text: USER, ts: "4", user: OWNER },
      { text: "second", ts: "5", user: OWNER },
      { text: "a bot", ts: "6", user: "U0OTHER" },
      { subtype: "channel_join", text: "joined", ts: "7", user: OWNER },
    ]
    expect(ownerMessages(read, OWNER).map((m) => m.text)).toEqual(["first", "second"])
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
