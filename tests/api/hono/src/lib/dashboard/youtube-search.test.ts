import { describe, expect, test } from "bun:test"

import { readPage, readResults } from "../../../../../../api/hono/src/lib/dashboard/youtube-search"

const video = (videoId: string, title: string) => ({
  videoRenderer: {
    lengthText: { simpleText: "3:21" },
    ownerText: { runs: [{ text: "Made Up " }, { text: "Channel" }] },
    title: { runs: [{ text: title }] },
    videoId,
  },
})

const page = (data: unknown, version = "2.20261027.00.00") =>
  `<html><script>var ytInitialData = ${JSON.stringify(data)};</script><script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"${version}"});</script></html>`

const data = {
  contents: {
    sectionListRenderer: {
      contents: [
        {
          itemSectionRenderer: {
            contents: [
              video("aaaaaaaaaaa", "First Song"),
              { adSlotRenderer: {} },
              video("bbbbbbbbbbb", "Second Song"),
            ],
          },
        },
        {
          continuationItemRenderer: {
            continuationEndpoint: { continuationCommand: { token: "TOKEN1" } },
          },
        },
      ],
    },
  },
}

describe("readResults", () => {
  test("reads each video in YouTube's order, and the next page's token after the client version", () => {
    expect(readResults(page(data))).toEqual({
      results: [
        { channel: "Made Up Channel", id: "aaaaaaaaaaa", length: "3:21", title: "First Song" },
        { channel: "Made Up Channel", id: "bbbbbbbbbbb", length: "3:21", title: "Second Song" },
      ],
      next: "2.20261027.00.00 TOKEN1",
    })
  })

  test("skips a renderer whose id is not a video id", () => {
    expect(readResults(page({ items: [video("short", "Not A Video")] })).results).toEqual([])
  })

  test("reads no results and no next page from a page without its data", () => {
    expect(readResults("<html></html>")).toEqual({ results: [], next: null })
  })
})

describe("readPage", () => {
  test("reads a continuation's videos and a null token at the end", () => {
    expect(readPage({ items: [video("ccccccccccc", "Third Song")] })).toEqual({
      results: [
        { channel: "Made Up Channel", id: "ccccccccccc", length: "3:21", title: "Third Song" },
      ],
      token: null,
    })
  })
})
