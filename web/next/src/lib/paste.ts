// A long paste goes with a message as a text file, as Claude.ai and ChatGPT take one, so the terminal is typed only his own words and the paste is not refused while a file fits beside the others. No `@/` import here, so the API's tests can hold these caps to deliver.ts's.

// The caps deliver() refuses a message past (MAX_CHARS and MAX_LINES in api/hono/src/lib/dashboard/deliver.ts).
export const MESSAGE_MAX_CHARS = 8000
export const MESSAGE_MAX_LINES = 100
// A paste longer than this goes as a file even when the message would fit.
export const PASTE_MAX_CHARS = 2000

// The control characters a text file holds (tab, line feed, form feed, carriage return and escape), the ones the API's isText() keeps; asText drops every other control character, DEL and C1 included, which deliver() would drop as well.
export const TEXT_CONTROLS = "\t\n\f\r\u001b"
const asText = (text: string) =>
  text.replace(/\p{Cc}/gu, (ch) => (TEXT_CONTROLS.includes(ch) ? ch : ""))

const charLabel = (chars: number) =>
  chars < 1000 ? `${chars} chars` : `${(chars / 1000).toFixed(1)}k chars`

// Pure: the paste as a file to attach, or null to paste it as words (a paste with nothing to keep is words too). `before` and `after` are what the box keeps either side of the cursor. The file's name is the chip's title; it ends in no extension the API knows, so the API keeps it as .txt.
export function pastedFile(pasted: string, before: string, after = ""): File | null {
  const kept = asText(pasted)
  if (!kept) return null
  // as normalize() in deliver.ts leaves the box before it counts: line ends as \n (each part's own, as the box takes a paste: a \r beside a \n is two), a tab as four spaces, no other control character
  const whole = [before, pasted, after]
    .map((part) => part.replace(/\r\n?/g, "\n"))
    .join("")
    .replaceAll("\t", "    ")
    .replace(/(?!\n)\p{Cc}/gu, "")
  if (
    pasted.length <= PASTE_MAX_CHARS &&
    whole.length <= MESSAGE_MAX_CHARS &&
    whole.split("\n").length <= MESSAGE_MAX_LINES
  ) {
    return null
  }
  return new File([kept], `Pasted text · ${charLabel(pasted.length)}`, {
    type: "text/plain",
  })
}

type PasteBox = {
  dispatchEvent: (event: Event) => boolean
  selectionEnd: number
  selectionStart: number
  setRangeText: (text: string, start: number, end: number, mode: "end") => void
  value: string
}

export type PasteInsert = "landed" | "left" | "missed"

// A plain-text paste the box takes as words lands as the text its paste event carried, inserted here rather than by the browser, whose own insert reads the clipboard again and lands nothing when it has changed since (a dictation's 84 characters read at the paste and none at the insert, most likely the dictation app putting the old clipboard back between the two, estimated). It replaces the selection, through the browser's insertText so undo keeps it, else at the selection by hand with the input event React's onChange reads. Call it after the composer's own paste handling, which takes files and long text; returns left when it leaves the paste to the browser, else whether the box then holds it, read from the box itself (its value or its caret moved), so an insert that reports done and changes nothing falls back to the hand insert and, missing that too, reads missed.
export function insertPaste(
  event: {
    clipboardData: { getData: (type: string) => string }
    currentTarget: PasteBox
    defaultPrevented: boolean
    preventDefault: () => void
  },
  insertText: (text: string) => boolean = (text) => document.execCommand("insertText", false, text),
): PasteInsert {
  if (event.defaultPrevented) return "left"
  // line ends as the box takes them from a paste
  const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n")
  if (!text) return "left"
  event.preventDefault()
  const box = event.currentTarget
  const { selectionEnd: end, selectionStart: start, value } = box
  const moved = () =>
    box.value !== value || box.selectionStart !== start || box.selectionEnd !== end
  insertText(text)
  if (moved()) return "landed"
  box.setRangeText(text, box.selectionStart, box.selectionEnd, "end")
  box.dispatchEvent(new Event("input", { bubbles: true }))
  return moved() ? "landed" : "missed"
}
