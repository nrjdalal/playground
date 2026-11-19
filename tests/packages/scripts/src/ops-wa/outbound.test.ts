import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sender } from "../../../../../packages/scripts/src/ops-wa/bridge"
import { SEND, typingMs, writeOwn } from "../../../../../packages/scripts/src/ops-wa/habits"
import {
  messagesOf,
  outboxDir,
  readOutbound,
} from "../../../../../packages/scripts/src/ops-wa/outbound"
import { ALERT, fakeSocket, jid, OWNER, SPARE } from "./fake-socket"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const START = Date.parse("2026-11-18T03:00:00Z")
const BYTES = Buffer.from("made-up bytes")

// A sender over a fake socket in a scratch data folder, the owner and the alert number each written an hour ago, with an outbox holding made-up files.
const harness = async () => {
  const data = mkdtempSync(join(tmpdir(), "ops-wa-out-"))
  dirs.push(data)
  const dir = join(data, "whatsapp")
  const outbox = outboxDir(data)
  mkdirSync(outbox, { recursive: true })
  await writeOwn(join(dir, "owner.json"), { jid: jid(OWNER), ownerAt: START - 3_600_000 })
  await writeOwn(join(dir, "alert.json"), { alertAt: START - 3_600_000, jid: jid(ALERT) })
  const fake = fakeSocket()
  let now = START
  fake.setClock(() => now)
  const send = sender({
    alert: async () => ALERT,
    device: SPARE,
    dir,
    now: () => now,
    owner: OWNER,
    random: () => 0.5,
    sleep: async (ms) => void (now += ms),
    sock: fake.sock,
  })
  const file = (name: string, bytes: string | Buffer = BYTES) => {
    const path = join(outbox, name)
    writeFileSync(path, bytes)
    return path
  }
  return {
    data,
    fake,
    file,
    outbox,
    send: (body: string, kind: Parameters<typeof send>[1], path?: string) =>
      send(body, kind, undefined, path),
  }
}

describe("wa send's files (#2783)", () => {
  test("an image, a video and a document carry the body as their caption, a document its file name", async () => {
    const h = await harness()
    expect(await h.send("the new board", "reply", h.file("board.png"))).toBe("sent")
    expect(await h.send("a short run", "reply", h.file("run.mp4"))).toBe("sent")
    expect(await h.send("the week's notes", "reply", h.file("notes.pdf"))).toBe("sent")
    expect(h.fake.sent.map((s) => [s.jid, s.content])).toEqual([
      [jid(OWNER), { caption: "the new board", image: BYTES, mimetype: "image/png" }],
      [jid(OWNER), { caption: "a short run", mimetype: "video/mp4", video: BYTES }],
      [
        jid(OWNER),
        {
          caption: "the week's notes",
          document: BYTES,
          fileName: "notes.pdf",
          mimetype: "application/pdf",
        },
      ],
    ])
  })

  test("a voice note takes no caption, so the body goes first as text and the note after it", async () => {
    const h = await harness()
    expect(await h.send("listen to this", "reply", h.file("note.ogg"))).toBe("sent")
    expect(h.fake.sent.map((s) => s.content)).toEqual([
      { linkPreview: null, text: "listen to this" },
      { audio: BYTES, mimetype: "audio/ogg; codecs=opus", ptt: true },
    ])
  })

  test("a file with no body goes alone, with no caption and no empty text", async () => {
    const h = await harness()
    expect(await h.send("", "reply", h.file("shot.jpg"))).toBe("sent")
    expect(await h.send("", "reply", h.file("hello.opus"))).toBe("sent")
    expect(h.fake.sent.map((s) => s.content)).toEqual([
      { caption: undefined, image: BYTES, mimetype: "image/jpeg" },
      { audio: BYTES, mimetype: "audio/ogg; codecs=opus", ptt: true },
    ])
  })

  test("a caption waits its typing time as a text does, and a file with no caption goes on the gap alone", async () => {
    const h = await harness()
    const caption = "the new board, with this week's three changes"
    await h.send("", "reply", h.file("shot.jpg"))
    await h.send(caption, "reply", h.file("board.png"))
    await h.send("", "reply", h.file("hello.opus"))
    const [bare, captioned, note] = h.fake.sent.map((s) => s.at)
    expect(bare).toBe(START)
    expect(captioned! - bare!).toBe(typingMs(caption.length, () => 0.5))
    expect(typingMs(caption.length, () => 0.5)).toBeGreaterThan(SEND.gapMs)
    expect(note! - captioned!).toBe(SEND.gapMs)
  })

  test("a long caption keeps its first part on the file, and the rest follow as text, each paced as a part", async () => {
    const parts = messagesOf(["first", "second"], {
      bytes: BYTES,
      kind: "image",
      mimetype: "image/png",
      name: "a.png",
    })
    expect(parts).toEqual([
      { caption: "first", image: BYTES, mimetype: "image/png" },
      { linkPreview: null, text: "second" },
    ])
    const h = await harness()
    await h.send("one", "reply")
    await h.send("two", "reply", h.file("b.png"))
    expect(h.fake.sent[1]!.at - h.fake.sent[0]!.at).toBeGreaterThanOrEqual(1_000)
  })

  test("with --to alert a file reaches the alert number alone", async () => {
    const h = await harness()
    expect(await h.send("for you", "guest", h.file("plan.md", "# made-up plan\n"))).toBe("sent")
    expect(h.fake.sent.map((s) => [s.jid, s.content.fileName, s.content.caption])).toEqual([
      [jid(ALERT), "plan.md", "for you"],
    ])
  })

  test("a file outside the outbox, through a link out of it, or of an unknown type is refused, and nothing goes", async () => {
    const h = await harness()
    const outside = join(h.data, "secret.png")
    writeFileSync(outside, BYTES)
    const link = join(h.outbox, "link.png")
    symlinkSync(outside, link)
    await expect(h.send("x", "reply", outside)).rejects.toThrow(
      `wa send takes a file from ${h.outbox} alone`,
    )
    await expect(h.send("x", "reply", link)).rejects.toThrow("takes a file from")
    await expect(h.send("x", "reply", join(h.outbox, "gone.png"))).rejects.toThrow(
      "takes a file from",
    )
    await expect(h.send("x", "reply", h.file("tool.sh"))).rejects.toThrow(
      "wa send takes a file of these types alone: csv, jpeg, jpg",
    )
    mkdirSync(join(h.outbox, "dir.png"))
    await expect(h.send("x", "reply", join(h.outbox, "dir.png"))).rejects.toThrow(
      "a regular file alone",
    )
    expect(h.fake.sent).toEqual([])
  })

  test("a text document holding a token shape is refused as a body is, and a guest's holding an email address too", async () => {
    const h = await harness()
    const token = h.file("keys.txt", `ghp_${"a".repeat(36)}`)
    await expect(h.send("", "reply", token)).rejects.toThrow("never goes over WhatsApp")
    const email = h.file("contacts.csv", `name,mail\nmade-up,${["a", "example.test"].join("@")}\n`)
    await expect(h.send("", "guest", email)).rejects.toThrow("an email address")
    expect(h.fake.sent).toEqual([])
  })

  test("a file keeps the 24 hours: none goes once the owner has not written in them", async () => {
    const h = await harness()
    await writeOwn(join(h.data, "whatsapp", "owner.json"), { jid: jid(OWNER), ownerAt: 0 })
    await expect(h.send("late", "reply", h.file("late.png"))).rejects.toThrow(
      "has not written in the last 24 hours",
    )
    expect(h.fake.sent).toEqual([])
  })

  test("sends no presence and marks nothing read", async () => {
    const h = await harness()
    await h.send("x", "reply", h.file("c.png"))
    expect(h.fake.calls).toEqual([])
  })

  test("readOutbound names the file's kind, mime and name, and reads a text document's words", async () => {
    const h = await harness()
    const read = await readOutbound(h.outbox, h.file("Notes.MD", "made-up words"))
    expect(read).toMatchObject({
      kind: "document",
      mimetype: "text/markdown",
      name: "Notes.MD",
      text: "made-up words",
    })
  })
})
