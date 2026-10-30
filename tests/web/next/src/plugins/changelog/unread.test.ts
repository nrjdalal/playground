import { describe, expect, test } from "bun:test"

import { IMAGE_EXTENSIONS } from "../../../../../../api/hono/src/lib/dashboard/attachments"
import { IMAGE_ID } from "../../../../../../api/hono/src/plugins/changelog/image-id"
import { VERIFY_VISIT } from "../../../../../../web/next/src/lib/verify-visit"
import {
  imageUrl,
  isUnread,
  newestArrival,
  seenMark,
} from "../../../../../../web/next/src/plugins/changelog/unread"

describe("the changelog's unread marks", () => {
  test("an entry is new when it arrived after the last look, and every entry before the first", () => {
    const entry = { createdAt: "2026-10-07T10:00:00.000Z" }
    expect(isUnread(entry, null)).toBe(true)
    expect(isUnread(entry, "2026-10-07T09:59:59.999Z")).toBe(true)
    expect(isUnread(entry, "2026-10-07T10:00:00.000Z")).toBe(false)
  })

  test("marks read up to the newest arrival shown, not the newest change", () => {
    expect(
      newestArrival([
        { createdAt: "2026-10-07T10:00:00.000Z" },
        { createdAt: "2026-10-07T12:00:00.000Z" },
        { createdAt: "2026-10-07T11:00:00.000Z" },
      ]),
    ).toBe("2026-10-07T12:00:00.000Z")
    expect(newestArrival([])).toBeNull()
  })
})

describe("imageUrl", () => {
  test("builds our own API's URL for an id the API would serve, and nothing for any other", () => {
    for (const extension of IMAGE_EXTENSIONS) {
      const each = `0f8b6a3e-2c1d-4e5f-9a7b-1c2d3e4f5a6b.${extension}`
      expect(IMAGE_ID.test(each)).toBe(true)
      expect(imageUrl(each)).toEndWith(`/api/v1/apps/changelog/images/${each}`)
    }
    const id = "0f8b6a3e-2c1d-4e5f-9a7b-1c2d3e4f5a6b.png"
    for (const bad of [
      "../x.png",
      "https://evil.example/a.png",
      `${id}?x=1`,
      id.replace(".png", ".svg"),
    ]) {
      expect(IMAGE_ID.test(bad)).toBe(false)
      expect(imageUrl(bad)).toBeNull()
    }
  })

  test("a person's visit marks the newest unread arrival read, and verify's visit marks nothing", () => {
    const newest = "2026-10-07T12:00:00.000Z"
    const page = globalThis as unknown as { window?: Record<string, unknown> }
    page.window = {}
    try {
      expect(seenMark(newest, "2026-10-07T11:00:00.000Z")).toBe(newest)
      expect(seenMark(newest, null)).toBe(newest)
      expect(seenMark(newest, newest)).toBeNull()
      expect(seenMark(null, null)).toBeNull()
      page.window[VERIFY_VISIT] = true
      expect(seenMark(newest, "2026-10-07T11:00:00.000Z")).toBeNull()
      expect(seenMark(newest, null)).toBeNull()
    } finally {
      delete page.window
    }
  })
})
