import { describe, expect, test } from "bun:test"

import { DEMO_SONG, parseYouTube } from "../../../../../web/next/src/lib/youtube"

describe("parseYouTube", () => {
  test("reads a song from a watch link, a short link, a short and an embed", () => {
    expect(parseYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
    })
    expect(parseYouTube("https://youtu.be/dQw4w9WgXcQ?t=42")).toEqual({ videoId: "dQw4w9WgXcQ" })
    expect(parseYouTube("https://youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
    })
    expect(parseYouTube("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      videoId: "dQw4w9WgXcQ",
    })
    expect(parseYouTube(" https://music.youtube.com/watch?v=dQw4w9WgXcQ ")).toEqual({
      videoId: "dQw4w9WgXcQ",
    })
  })

  test("reads a playlist, alone or with the song it starts on", () => {
    expect(
      parseYouTube("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"),
    ).toEqual({
      list: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
    })
    expect(parseYouTube("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ")).toEqual({
      list: "RDdQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
    })
  })

  test("refuses anything else", () => {
    expect(parseYouTube("not a link")).toBeNull()
    expect(parseYouTube("https://vimeo.com/123")).toBeNull()
    expect(parseYouTube("https://evil.youtube.com.example/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTube("javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(parseYouTube("https://www.youtube.com/watch?v=short")).toBeNull()
    expect(parseYouTube("https://www.youtube.com/")).toBeNull()
  })

  test("the demo song parses", () => {
    expect(parseYouTube(DEMO_SONG.url)).toEqual({ videoId: "dQw4w9WgXcQ" })
  })
})
