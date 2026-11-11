import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  attach,
  REPLY,
  sender,
  toWhatsApp,
} from "../../../../../packages/scripts/src/ops-wa/bridge"
import { SEND } from "../../../../../packages/scripts/src/ops-wa/habits"
import { fakeSocket, groupJid, jid, OWNER, STRANGER } from "./fake-socket"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const HOUR = 3_600_000
const START = Date.parse("2026-11-11T03:00:00Z")

// One bridge over a fake socket in a scratch data folder: the relay's lines, the waits it asked for and a clock the waits move.
const harness = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ops-wa-")), "whatsapp")
  dirs.push(dir)
  const fake = fakeSocket()
  const relayed: string[] = []
  const waits: number[] = []
  let now = START
  fake.setClock(() => now)
  const io = {
    dir,
    now: () => now,
    owner: OWNER,
    relay: async (text: string) => void relayed.push(text),
    sleep: async (ms: number) => {
      waits.push(ms)
      now += ms
    },
    sock: fake.sock,
  }
  const idle = attach(io)
  const send = sender(io)
  return {
    advance: (ms: number) => (now += ms),
    dir,
    dropped: async () =>
      (
        await Bun.file(join(dir, "dropped.log"))
          .text()
          .catch(() => "")
      )
        .split("\n")
        .filter(Boolean),
    fake,
    relayed,
    send,
    // the handlers queue on the emitter's turn and each writes a file, so a test waits for the queue to empty before it reads
    settle: idle,
    waits,
  }
}

describe("ops-wa's bridge", () => {
  test("hands the owner's message to the dispatcher whole, with how to answer", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "is the train moving?\nsecond line")])
    await h.settle()
    expect(h.relayed).toHaveLength(1)
    expect(h.relayed[0]).toContain("is the train moving?\nsecond line")
    expect(h.relayed[0]).toContain(REPLY)
    expect(await h.dropped()).toEqual([])
  })

  test("tells the dispatcher to answer with factory status alone, door 2's line", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "status?")])
    await h.settle()
    expect(h.relayed[0]).toEndWith(
      "Answer with factory status alone, no org work, secret or customer data, through playground wa send <file>.",
    )
  })

  test("keeps every send and the owner's last message when both land at once, so the hourly cap counts them all", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "go")])
    await h.settle()
    const sends = [1, 2, 3, 4, 5].map((n) => {
      h.fake.upsert([h.fake.message(jid(OWNER), `more ${n}`)])
      return h.send(`part ${n}`)
    })
    await Promise.all(sends)
    await h.settle()
    const kept = (await Bun.file(join(h.dir, "sends.json")).json()) as { sends: number[] }
    expect(kept.sends).toHaveLength(5)
    const owner = (await Bun.file(join(h.dir, "owner.json")).json()) as { ownerAt: number }
    expect(owner.ownerAt).toBeGreaterThanOrEqual(START)
    expect(h.relayed).toHaveLength(6)
  })

  test("sends the reply to the owner's number alone, with no link preview", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "status?")])
    await h.settle()
    expect(await h.send("**3 PRs** merged, see [the board](https://example.test/b)")).toBe("sent")
    expect(h.fake.sent).toEqual([
      {
        at: expect.any(Number),
        content: {
          linkPreview: null,
          text: "*3 PRs* merged, see the board (https://example.test/b)",
        },
        jid: jid(OWNER),
      },
    ])
  })

  test("drops a stranger's message, logging its time, kind and last 4 digits alone", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(STRANGER), "a made-up stranger's words")])
    await h.settle()
    expect(h.relayed).toEqual([])
    const lines = await h.dropped()
    expect(lines).toEqual([`${new Date(START).toISOString()} stranger ...0777`])
    expect(lines.join("\n")).not.toContain("made-up stranger")
    expect(lines.join("\n")).not.toContain(STRANGER.slice(1))
  })

  test("refuses a body holding a token shape, sending nothing", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "token?")])
    await h.settle()
    const body = `here: ghp_${"a".repeat(36)}`
    await expect(h.send(body)).rejects.toThrow("a GitHub token")
    expect(h.fake.sent).toEqual([])
  })

  test("drops a group's, a status's, a broadcast's and a newsletter's message, and a call, each logged", async () => {
    const h = harness()
    h.fake.upsert([
      h.fake.message(groupJid("120363000000000001"), "group words", { participant: jid(OWNER) }),
      h.fake.message("status@broadcast", "status words", { participant: jid(OWNER) }),
      h.fake.message("1234567890@broadcast", "broadcast words"),
      h.fake.message("120363000000000002@newsletter", "news"),
    ])
    h.fake.emit("call", [{ from: jid(STRANGER), status: "offer" }])
    await h.settle()
    expect(h.relayed).toEqual([])
    expect((await h.dropped()).map((l) => l.split(" ")[1])).toEqual([
      "group",
      "status",
      "broadcast",
      "newsletter",
      "call",
    ])
  })

  test("passes over its own messages and a history sync's, and logs neither", async () => {
    const h = harness()
    h.fake.upsert([
      { ...h.fake.message(jid(OWNER), "mine"), key: { fromMe: true, remoteJid: jid(OWNER) } },
    ])
    h.fake.upsert([h.fake.message(jid(OWNER), "old")], "append")
    await h.settle()
    expect(h.relayed).toEqual([])
    expect(await h.dropped()).toEqual([])
  })

  test("knows the owner by the phone number Baileys gives beside a LID", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message("99887766554433@lid", "via lid", { remoteJidAlt: jid(OWNER) })])
    await h.settle()
    expect(h.relayed).toHaveLength(1)
    expect(h.relayed[0]).toContain("via lid")
  })

  test("tells the dispatcher of a message with no text, without its content", async () => {
    const h = harness()
    h.fake.upsert([
      { ...h.fake.message(jid(OWNER), ""), message: { imageMessage: { caption: "x" } } },
    ])
    await h.settle()
    expect(h.relayed).toHaveLength(1)
    expect(h.relayed[0]).toContain("an image")
    expect(h.relayed[0]).not.toContain("caption")
  })

  test("never starts a chat: it sends only within 24 hours of the owner's last message", async () => {
    const h = harness()
    await expect(h.send("hello first")).rejects.toThrow("has not written in the last 24 hours")
    h.fake.upsert([h.fake.message(jid(OWNER), "hi")])
    await h.settle()
    expect(await h.send("reply")).toBe("sent")
    h.advance(24 * HOUR + 1)
    await expect(h.send("late")).rejects.toThrow("has not written in the last 24 hours")
    expect(h.fake.sent).toHaveLength(1)
  })

  test("paces sends one at a time, a second apart, and a split message's parts 300 ms apart", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "go")])
    await h.settle()
    await Promise.all([h.send("one"), h.send("two")])
    const [a, b] = h.fake.sent
    expect(b!.at - a!.at).toBeGreaterThanOrEqual(SEND.gapMs)
    const long = Array.from({ length: 3 }, (_, i) => `${i}`.repeat(SEND.partChars - 10)).join(
      "\n\n",
    )
    h.advance(SEND.gapMs)
    expect(await h.send(long)).toBe("sent")
    const parts = h.fake.sent.slice(2)
    expect(parts).toHaveLength(3)
    expect(parts[1]!.at - parts[0]!.at).toBeGreaterThanOrEqual(SEND.partGapMs)
    expect(parts[2]!.at - parts[1]!.at).toBeGreaterThanOrEqual(SEND.partGapMs)
    expect(parts.map((p) => p.content.text).join("\n\n")).toBe(long)
  })

  test("refuses the 61st send in an hour, naming when it frees, and counts across restarts", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "go")])
    await h.settle()
    for (let i = 0; i < SEND.perHour; i++) await h.send(`n${i}`)
    // a new sender over the same folder stands for a restart of ops-wa
    const again = sender({
      dir: h.dir,
      now: () => START + 70_000,
      owner: OWNER,
      sleep: async () => {},
      sock: h.fake.sock,
    })
    await expect(again("one more")).rejects.toThrow(
      /the hourly cap of 60 sends is reached until \d\d:\d\dZ/,
    )
    expect(h.fake.sent).toHaveLength(SEND.perHour)
  })

  test("never marks a message read nor sends presence", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "hi")])
    await h.settle()
    await h.send("ok")
    expect(h.fake.calls).toEqual([])
  })

  test("keeps its folder to the owner (700) and its files too (600)", async () => {
    const h = harness()
    h.fake.upsert([h.fake.message(jid(OWNER), "hi"), h.fake.message(jid(STRANGER), "x")])
    await h.settle()
    await h.send("ok")
    expect(statSync(h.dir).mode & 0o777).toBe(0o700)
    for (const file of ["dropped.log", "owner.json", "sends.json"])
      expect(statSync(join(h.dir, file)).mode & 0o777).toBe(0o600)
  })
})

describe("toWhatsApp", () => {
  test("turns markdown into WhatsApp's own marks, links as plain text", () => {
    expect(toWhatsApp("# Head\n**bold** and __it__, [a](https://x.test)")).toBe(
      "*Head*\n*bold* and _it_, a (https://x.test)",
    )
    expect(toWhatsApp("```\ncode **kept**\n```")).toBe("```\ncode **kept**\n```")
  })
})
