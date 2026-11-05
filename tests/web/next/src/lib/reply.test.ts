import { describe, expect, test } from "bun:test"

import { REPLY_RE as API_REPLY_RE } from "../../../../../api/hono/src/lib/dashboard/inbox"
import type { InboxItem } from "../../../../../api/hono/src/lib/dashboard/inbox"
import { replyRoute, TYPED, typedReply, withRef } from "../../../../../web/next/src/lib/reply"

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

// A card's Reply (#1045): an empty box goes to Playground's composer, words in the box send, and a secret ask keeps its own box.
describe("a card's Reply", () => {
  test("an empty box goes to the composer, from an open card and a folded one", () => {
    expect(replyRoute({ chat: true, folded: false, secret: false, text: "" })).toBe("composer")
    expect(replyRoute({ chat: true, folded: true, secret: false, text: "  " })).toBe("composer")
  })

  test("words in the box send, and open a folded card to them first", () => {
    expect(replyRoute({ chat: true, folded: false, secret: false, text: "hold it" })).toBe("send")
    expect(replyRoute({ chat: true, folded: true, secret: false, text: "hold it" })).toBe("open")
  })

  test("while Playground's session is down an empty box opens the card's own box, since no composer would take the hand until it is back", () => {
    expect(replyRoute({ chat: false, folded: false, secret: false, text: "" })).toBe("open")
    expect(replyRoute({ chat: false, folded: true, secret: false, text: "" })).toBe("open")
    expect(replyRoute({ chat: false, folded: false, secret: false, text: "hold it" })).toBe("send")
  })

  test("a secret ask's Reply never goes to the composer, so a secret never reaches the chat", () => {
    expect(replyRoute({ chat: true, folded: false, secret: true, text: "" })).toBe("open")
    expect(replyRoute({ chat: true, folded: true, secret: true, text: "" })).toBe("open")
    expect(replyRoute({ chat: true, folded: false, secret: true, text: "hold it" })).toBe("send")
  })

  test("the composer reads re #iN: before the words it held, an empty one re #iN: alone", () => {
    expect(withRef("", 41)).toBe("re #i41: ")
    expect(withRef("hold it till Monday", 41)).toBe("re #i41: hold it till Monday")
    expect(typedReply(withRef("", 41), items)).toEqual({ ref: 41, title: items[0]!.title })
  })

  test("a composer that opens with another item's ref gets it swapped, not doubled", () => {
    expect(withRef("re #i40: hold it", 41)).toBe("re #i41: hold it")
    expect(withRef("  Re #i40 hold it", 41)).toBe("re #i41: hold it")
    expect(withRef("re #i41: hold it", 41)).toBe("re #i41: hold it")
    expect(withRef("re #i40: ", 41)).toBe("re #i41: ")
    expect(withRef("see re #i40 first", 41)).toBe("re #i41: see re #i40 first")
  })
})
