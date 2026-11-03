import { describe, expect, test } from "bun:test"

import { type Put, upload } from "../../../../../packages/scripts/src/dm/upload"

type Step = { at: string; params?: Record<string, string>; size?: number }

// Slack's HTTP, stubbed: each getUploadURLExternal hands back its own URL and file id, and every step lands in one log, so the order reads whole.
const stub = ({ complete = true, putStatus = 200 } = {}) => {
  const steps: Step[] = []
  let n = 0
  const slack = async (method: string, params: Record<string, string>) => {
    steps.push({ at: method, params })
    if (method === "files.getUploadURLExternal") {
      n += 1
      return { file_id: `F0MADEUP0${n}`, ok: true, upload_url: `https://files.example/upload/${n}` }
    }
    return complete ? { ok: true } : { error: "not_in_channel", ok: false }
  }
  const put: Put = async (url, bytes) => {
    steps.push({ at: url, size: bytes.length })
    return { ok: putStatus < 300, status: putStatus }
  }
  return { put, slack, steps }
}

const FILES = [
  { bytes: new Uint8Array([1, 2, 3]), name: "before.png" },
  { bytes: new Uint8Array([4, 5, 6, 7]), name: "after.png" },
]

describe("dm upload (PG-649)", () => {
  test("two files: each asks for an upload URL and posts its bytes, then one complete shares both into the channel and thread", async () => {
    const { put, slack, steps } = stub()
    const count = await upload({
      channel: "C0MADEUP01",
      files: FILES,
      put,
      slack,
      thread: "1700000000.000100",
    })
    expect(count).toBe(2)
    expect(steps).toEqual([
      { at: "files.getUploadURLExternal", params: { filename: "before.png", length: "3" } },
      { at: "https://files.example/upload/1", size: 3 },
      { at: "files.getUploadURLExternal", params: { filename: "after.png", length: "4" } },
      { at: "https://files.example/upload/2", size: 4 },
      {
        at: "files.completeUploadExternal",
        params: {
          channel_id: "C0MADEUP01",
          files: JSON.stringify([
            { id: "F0MADEUP01", title: "before.png" },
            { id: "F0MADEUP02", title: "after.png" },
          ]),
          thread_ts: "1700000000.000100",
        },
      },
    ])
  })

  test("a channel with no thread shares the files at its top level", async () => {
    const { put, slack, steps } = stub()
    await upload({ channel: "D0MADEUP11", files: FILES.slice(0, 1), put, slack })
    expect(steps.at(-1)?.params).toEqual({
      channel_id: "D0MADEUP11",
      files: JSON.stringify([{ id: "F0MADEUP01", title: "before.png" }]),
    })
  })

  test("a byte post Slack refuses fails the upload, naming the file, and shares nothing", async () => {
    const { put, slack, steps } = stub({ putStatus: 500 })
    await expect(
      upload({ channel: "C0MADEUP01", files: FILES, put, slack, thread: "1700000000.000100" }),
    ).rejects.toThrow("before.png")
    expect(steps.map((s) => s.at)).not.toContain("files.completeUploadExternal")
  })

  test("a complete Slack refuses fails the upload with Slack's error", async () => {
    const { put, slack } = stub({ complete: false })
    await expect(upload({ channel: "C0MADEUP01", files: FILES, put, slack })).rejects.toThrow(
      "files.completeUploadExternal: not_in_channel",
    )
  })
})
