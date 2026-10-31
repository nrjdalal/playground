import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  locked,
  ownerMessages,
  PLAYGROUND,
  readSent,
  recordSent,
  USER,
} from "../../../../../packages/scripts/src/dm/slack"
import { OWNER } from "./fake-dm"

const scratch = mkdtempSync(join(tmpdir(), "dm-slack-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const at = (text: string, ts: number, user = OWNER) => ({ text, ts: `${ts}.000100`, user })
const texts = (read: ReturnType<typeof at>[], ours: number[]) =>
  ownerMessages(read, OWNER, new Set(ours.map((ts) => `${ts}.000100`))).map((m) => m.text)

describe("ownerMessages", () => {
  test("reads the owner's messages dm send did not post, and none from another member or with a subtype", () => {
    const read = [
      at("first", 1),
      at(PLAYGROUND, 2),
      at("our body", 3),
      at(USER, 4),
      at("second", 5),
      at("a bot", 6, "U0OTHER"),
      { ...at("joined", 7), subtype: "channel_join" },
    ]
    expect(texts(read, [2, 3, 4])).toEqual(["first", "second"])
  })

  test("a send that fails after its body leaves the owner's next messages readable", () => {
    const read = [at(PLAYGROUND, 1), at("our body", 2), at("are you there?", 3), at("hello?", 4)]
    expect(texts(read, [1, 2])).toEqual(["are you there?", "hello?"])
  })

  test("after the mid-send repair, the owner's next message is read past the lone PLAYGROUND line", () => {
    const read = [
      at(PLAYGROUND, 1),
      at(`our body\n${USER}`, 2),
      at("mid", 3),
      at(PLAYGROUND, 4),
      at("follow-up", 5),
    ]
    expect(texts(read, [1, 2, 4])).toEqual(["mid", "follow-up"])
  })

  test("a window that starts after a reused PLAYGROUND line reads none of our body", () => {
    const read = [at("update two", 2), at(USER, 3), at("ok", 4)]
    expect(texts(read, [1, 2, 3])).toEqual(["ok"])
  })
})

describe("the record of our posts", () => {
  test("keeps each ts dm send records, and reads empty before the first", async () => {
    const dir = join(scratch, "data")
    expect(await readSent(dir)).toEqual(new Set())
    await recordSent(dir, "1.000100")
    await recordSent(dir, "2.000100")
    expect(await readSent(dir)).toEqual(new Set(["1.000100", "2.000100"]))
  })
})

describe("the send lock", () => {
  test("a dead send's lock, past its stale bound, is taken over, and the taken-over send never frees its successor's", async () => {
    const dir = join(scratch, "lock")
    const lock = join(dir, "dm-send.lock")
    const old = new Date(Date.now() - 11 * 60_000)
    let releaseA = () => {}
    let insideA = false
    const a = locked(dir, () => {
      insideA = true
      return new Promise<void>((resolve) => (releaseA = resolve))
    })
    while (!insideA) await Bun.sleep(10)
    utimesSync(lock, old, old)
    let releaseB = () => {}
    let insideB = false
    const b = locked(dir, () => {
      insideB = true
      return new Promise<void>((resolve) => (releaseB = resolve))
    })
    while (!insideB) await Bun.sleep(10)
    releaseA()
    await a
    expect(existsSync(lock)).toBe(true)
    releaseB()
    await b
    expect(existsSync(lock)).toBe(false)
  })
})
