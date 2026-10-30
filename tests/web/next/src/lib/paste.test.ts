import { describe, expect, test } from "bun:test"

import { TEXT_CONTROLS as API_TEXT_CONTROLS } from "../../../../../api/hono/src/lib/dashboard/attachments"
import {
  insertPaste,
  MESSAGE_MAX_CHARS,
  MESSAGE_MAX_LINES,
  PASTE_MAX_CHARS,
  pastedFile,
  TEXT_CONTROLS,
} from "../../../../../web/next/src/lib/paste"

const words = (chars: number) => "Made-up meeting notes. ".repeat(chars).slice(0, chars)

describe("pastedFile", () => {
  test("a long paste becomes a text file named for its length, holding the paste", async () => {
    const pasted = words(15_234)
    const file = pastedFile(pasted, "")
    expect(file?.name).toBe("Pasted text · 15.2k chars")
    expect(file?.type).toStartWith("text/plain")
    expect(await file?.text()).toBe(pasted)
  })

  test("a short paste stays in the box as words", () => {
    expect(pastedFile("Ship it after lunch.", "")).toBeNull()
    expect(pastedFile(words(PASTE_MAX_CHARS), "")).toBeNull()
    expect(pastedFile(words(PASTE_MAX_CHARS + 1), "")).not.toBeNull()
  })

  test("a short paste that would take the box past a message's caps becomes a file", () => {
    expect(pastedFile(words(1500), words(MESSAGE_MAX_CHARS - 1000))?.name).toBe(
      "Pasted text · 1.5k chars",
    )
    const lines = Array(MESSAGE_MAX_LINES + 1).fill("x")
    expect(pastedFile(lines.join("\n"), "")?.name).toBe(
      `Pasted text · ${lines.length * 2 - 1} chars`,
    )
    expect(pastedFile(lines.slice(1).join("\r\n"), "")).toBeNull()
    // a tab counts as the four spaces deliver() types for it
    expect(pastedFile("\t".repeat(1001), words(4000))).not.toBeNull()
    expect(pastedFile("\t".repeat(990), words(4000))).toBeNull()
  })

  test("control characters the API reads as binary are left out, so the upload is kept as text", async () => {
    const file = pastedFile(`${words(PASTE_MAX_CHARS)}\u0000\u0007 end\tok\n`, "")
    expect(await file?.text()).toBe(`${words(PASTE_MAX_CHARS)} end\tok\n`)
  })
})

describe("pastedFile with nothing to keep", () => {
  test("a paste with no text, or only control characters, makes no file, even at the cap", () => {
    expect(pastedFile("", words(MESSAGE_MAX_CHARS))).toBeNull()
    expect(pastedFile("\u0001\u0007", words(MESSAGE_MAX_CHARS))).toBeNull()
  })
})

describe("TEXT_CONTROLS", () => {
  test("the control characters a paste keeps are the ones the API reads as text", () => {
    const web = [...TEXT_CONTROLS].map((ch) => ch.charCodeAt(0)).sort()
    expect(web).toEqual([...API_TEXT_CONTROLS].sort())
  })
})

// A box as the browser keeps one: its value, its selection, and the input events dispatched on it. Nothing here runs a paste's default insert, as the browser's did when it read the clipboard after a dictation app had put the old one back.
const textBox = (value = "", start = value.length, end = start) => {
  const inputs: Event[] = []
  const box = {
    dispatchEvent: (event: Event) => {
      inputs.push(event)
      return true
    },
    selectionEnd: end,
    selectionStart: start,
    setRangeText(text: string, from: number, to: number) {
      box.value = box.value.slice(0, from) + text + box.value.slice(to)
      box.selectionStart = box.selectionEnd = from + text.length
    },
    value,
  }
  return { box, inputs }
}

const pasteOf = (box: ReturnType<typeof textBox>["box"], text: string, prevented = false) => {
  const event = {
    clipboardData: { getData: (type: string) => (type === "text/plain" ? text : "") },
    currentTarget: box,
    defaultPrevented: prevented,
    preventDefault: () => void (event.defaultPrevented = true),
  }
  return event
}

// The browser's insertText as it lands in the box: at the selection, with one input event.
const browserInsert = (box: ReturnType<typeof textBox>["box"]) => (text: string) => {
  box.setRangeText(text, box.selectionStart, box.selectionEnd)
  box.dispatchEvent(new Event("input", { bubbles: true }))
  return true
}

describe("insertPaste", () => {
  test("lands a paste's words when the browser's own insert would carry nothing", () => {
    const { box, inputs } = textBox()
    const event = pasteOf(box, "x".repeat(84))
    expect(insertPaste(event, browserInsert(box))).toBe("landed")
    expect(event.defaultPrevented).toBe(true)
    expect(box.value).toBe("x".repeat(84))
    expect(inputs).toHaveLength(1)
  })

  test("a normal paste replaces the selection and fires exactly one input", () => {
    const { box, inputs } = textBox("keep THIS here", 5, 9)
    insertPaste(pasteOf(box, "that"), browserInsert(box))
    expect(box.value).toBe("keep that here")
    expect(box.selectionStart).toBe(9)
    expect(inputs.map((event) => [event.type, event.bubbles])).toEqual([["input", true]])
  })

  test("when the browser's insertText refuses, it lands at the selection by hand with one input", () => {
    const { box, inputs } = textBox("ab", 1)
    insertPaste(pasteOf(box, "XY"), () => false)
    expect(box.value).toBe("aXYb")
    expect(inputs.map((event) => event.type)).toEqual(["input"])
  })

  test("an insertText that reports done and changes nothing falls back to the hand insert", () => {
    const { box, inputs } = textBox("ab", 1)
    expect(insertPaste(pasteOf(box, "XY"), () => true)).toBe("landed")
    expect(box.value).toBe("aXYb")
    expect(inputs.map((event) => event.type)).toEqual(["input"])
  })

  test("reads missed when neither insert changes the box", () => {
    const { box } = textBox("ab", 1)
    box.setRangeText = () => {}
    expect(insertPaste(pasteOf(box, "XY"), () => true)).toBe("missed")
    expect(box.value).toBe("ab")
  })

  test("the same words over the same selection read landed, inserted once", () => {
    const { box, inputs } = textBox("ab", 0, 2)
    expect(insertPaste(pasteOf(box, "ab"), browserInsert(box))).toBe("landed")
    expect(box.value).toBe("ab")
    expect(inputs).toHaveLength(1)
  })

  test("takes line ends as the box does", () => {
    const { box } = textBox()
    insertPaste(pasteOf(box, "one\r\ntwo\rthree"), () => false)
    expect(box.value).toBe("one\ntwo\nthree")
  })

  test("leaves a paste the composer took as a file, and one with no plain text, to the paths they had", () => {
    const { box, inputs } = textBox()
    const taken = pasteOf(box, "words", true)
    expect(insertPaste(taken, browserInsert(box))).toBe("left")
    const none = pasteOf(box, "")
    expect(insertPaste(none, browserInsert(box))).toBe("left")
    expect(none.defaultPrevented).toBe(false)
    expect(box.value).toBe("")
    expect(inputs).toEqual([])
  })
})
