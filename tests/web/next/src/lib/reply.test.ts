import { describe, expect, test } from "bun:test"

import { REPLY_RE as API_REPLY_RE } from "../../../../../api/hono/src/lib/dashboard/inbox"
import type { InboxItem } from "../../../../../api/hono/src/lib/dashboard/inbox"
import {
  currentReply,
  setReply,
  TYPED,
  typedReply,
  withReply,
} from "../../../../../web/next/src/lib/reply"

const items = [
  { ref: 41, title: "Ship canary 3f9a2c1 to main?" },
  { ref: 40, title: "Ask Merritt to try the export fix" },
] as InboxItem[]

describe("a reply", () => {
  test("the words the composer sends and the API's recorded reply read the same pattern (a test holds the two equal)", () => {
    expect(TYPED.source).toBe(API_REPLY_RE.source)
  })

  test("a second pick of the same item is a new pick, so a phone's chat comes forward again", () => {
    setReply({ ref: 41, title: "Ship" })
    const first = currentReply()
    setReply({ ref: 41, title: "Ship" })
    expect(currentReply()).toEqual(first)
    expect(currentReply()).not.toBe(first)
    setReply(null)
  })

  test("re #iN in the words names the item the list holds, in any case", () => {
    expect(typedReply("Re #i41 hold it", items)).toEqual({ ref: 41, title: items[0]!.title })
    expect(typedReply("re #i999 hold it", items)).toBeNull()
    expect(typedReply("#i41 alone is not a reply", items)).toBeNull()
  })

  test("a picked item leads the words with its id, unless they name it already", () => {
    const reply = { ref: 41, title: "Ship" }
    expect(withReply("Hold it", reply)).toBe("re #i41: Hold it")
    expect(withReply("re #i41 hold it", reply)).toBe("re #i41 hold it")
    expect(withReply("Hold it", null)).toBe("Hold it")
    // files sent with no words still carry the id
    expect(withReply("", reply)).toBe("re #i41")
  })

  test("one of the session's skills keeps the start, where Claude Code runs it, and the id follows it", () => {
    const reply = { ref: 41, title: "Ship" }
    const skills = ["daily-notes"]
    expect(withReply("/daily-notes Hold it", reply, skills)).toBe("/daily-notes re #i41: Hold it")
    expect(withReply("/daily-notes", reply, skills)).toBe("/daily-notes re #i41")
    // any other leading / word is his words, led by the id as before
    expect(withReply("/tmp is full", reply, skills)).toBe("re #i41: /tmp is full")
    expect(withReply("/clear the queue first", reply, skills)).toBe(
      "re #i41: /clear the queue first",
    )
    expect(withReply("/daily-notes Hold it", reply)).toBe("re #i41: /daily-notes Hold it")
  })
})
