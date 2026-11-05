import { describe, expect, test } from "bun:test"

import { REPLY_RE as API_REPLY_RE } from "../../../../../api/hono/src/lib/dashboard/inbox"
import type { InboxItem } from "../../../../../api/hono/src/lib/dashboard/inbox"
import { TYPED, typedReply } from "../../../../../web/next/src/lib/reply"

const items = [
  { ref: 41, title: "Ship canary 3f9a2c1 to main?" },
  { ref: 40, title: "Ask Merritt to try the export fix" },
] as InboxItem[]

describe("a reply", () => {
  test("the words the composer sends and the API's recorded reply read the same pattern (a test holds the two equal)", () => {
    expect(TYPED.source).toBe(API_REPLY_RE.source)
  })

  test("re #iN in the words names the item the list holds, in any case", () => {
    expect(typedReply("Re #i41 hold it", items)).toEqual({ ref: 41, title: items[0]!.title })
    expect(typedReply("re #i999 hold it", items)).toBeNull()
    expect(typedReply("#i41 alone is not a reply", items)).toBeNull()
  })
})
