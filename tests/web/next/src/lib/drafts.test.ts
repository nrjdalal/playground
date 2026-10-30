import { afterEach, describe, expect, test } from "bun:test"

import { site } from "../../../../../packages/config/src/site"
import { attachmentUrl } from "../../../../../web/next/src/lib/attachments"
import {
  DRAFTS_KEY,
  draftSaver,
  keptAttachments,
  parseDrafts,
  putDraft,
  readDrafts,
  takeHanded,
  saveDraft,
} from "../../../../../web/next/src/lib/drafts"
import type { OutboxAttachment } from "../../../../../web/next/src/lib/outbox"

// Any session's name works as a key; the dispatcher's is the one the composer serves.
const TO = site.name.toLowerCase()
const PNG = "0b7e5f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b.png"
const PDF = "1b7e5f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf"

const ref = (id: string, kind: OutboxAttachment["kind"]): OutboxAttachment => ({
  id,
  kind,
  name: `${kind}.file`,
  previewUrl: kind === "image" ? attachmentUrl(id) : null,
  size: 10,
})

describe("parseDrafts", () => {
  test("reads each session's words and files back", () => {
    const stored = { [TO]: { attachments: [ref(PNG, "image")], text: "half a thought" } }
    expect(parseDrafts(JSON.stringify(stored))).toEqual(stored)
  })

  test("a missing, broken or foreign value reads as no drafts", () => {
    expect(parseDrafts(null)).toEqual({})
    expect(parseDrafts("{")).toEqual({})
    expect(parseDrafts("[1]")).toEqual({})
    expect(parseDrafts(JSON.stringify({ [TO]: "words" }))).toEqual({})
  })

  test("keeps only files the API would name, and rebuilds a preview from its id", () => {
    const stored = {
      [TO]: {
        attachments: [
          { ...ref(PNG, "image"), previewUrl: "https://elsewhere.example/x.png" },
          { ...ref(PDF, "pdf"), id: "../../etc/passwd" },
          { ...ref(PDF, "pdf"), kind: "exe" },
          ref(PDF, "pdf"),
        ],
        text: "",
      },
    }
    expect(parseDrafts(JSON.stringify(stored))[TO]?.attachments).toEqual([
      ref(PNG, "image"),
      ref(PDF, "pdf"),
    ])
  })

  test("a draft with only spaces and no files is dropped", () => {
    expect(parseDrafts(JSON.stringify({ [TO]: { attachments: [], text: "  \n" } }))).toEqual({})
  })
})

describe("putDraft", () => {
  test("replaces one session's draft and leaves the others", () => {
    const drafts = { a: { attachments: [], text: "one" }, b: { attachments: [], text: "two" } }
    expect(putDraft(drafts, "a", { attachments: [], text: "uno" })).toEqual({
      a: { attachments: [], text: "uno" },
      b: { attachments: [], text: "two" },
    })
  })

  test("an empty draft, as a send leaves, removes the session's", () => {
    const drafts = { a: { attachments: [], text: "one" } }
    expect(putDraft(drafts, "a", { attachments: [], text: "" })).toEqual({})
  })
})

describe("keptAttachments", () => {
  test("drops the files the API says are gone and keeps the rest in order", async () => {
    const refs = [ref(PNG, "image"), ref(PDF, "pdf")]
    expect(await keptAttachments(refs, async (id) => id === PNG)).toEqual([ref(PDF, "pdf")])
  })

  test("a file it cannot ask about stays, so the send says what is missing", async () => {
    const refs = [ref(PNG, "image")]
    expect(await keptAttachments(refs, () => Promise.reject(new Error("offline")))).toEqual(refs)
  })
})

// A stand-in for the browser's localStorage, shared as one origin's tabs share it; restored after each test, with the module's cache emptied.
const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
let refuse = false
const useStorage = () => {
  const store = new Map<string, string>()
  refuse = false
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => void store.delete(key),
      setItem: (key: string, value: string) => {
        if (refuse) throw new Error("QuotaExceededError")
        store.set(key, value)
      },
    } as Storage,
  })
  return store
}

afterEach(() => {
  refuse = false
  for (const to of Object.keys(readDrafts())) saveDraft(to, { attachments: [], text: "" })
  if (real) Object.defineProperty(globalThis, "localStorage", real)
  else delete (globalThis as { localStorage?: Storage }).localStorage
})

describe("saveDraft", () => {
  test("writes to localStorage, keeps the draft in the tab when storage refuses, and a send clears it", () => {
    const store = useStorage()

    saveDraft(TO, { attachments: [ref(PDF, "pdf")], text: "hello" })
    expect(parseDrafts(store.get(DRAFTS_KEY) ?? null)).toEqual({
      [TO]: { attachments: [ref(PDF, "pdf")], text: "hello" },
    })

    refuse = true
    saveDraft(TO, { attachments: [], text: "hello there" })
    expect(readDrafts()[TO]?.text).toBe("hello there")

    refuse = false
    saveDraft(TO, { attachments: [], text: "" })
    expect(readDrafts()).toEqual({})
    expect(store.has(DRAFTS_KEY)).toBe(false)
  })

  test("writes over what storage holds now, so another tab's draft for another session stays", () => {
    const store = useStorage()
    saveDraft(TO, { attachments: [], text: "mine" })
    store.set(
      DRAFTS_KEY,
      JSON.stringify({
        other: { attachments: [], text: "theirs" },
        [TO]: { attachments: [], text: "mine" },
      }),
    )
    saveDraft(TO, { attachments: [], text: "mine, longer" })
    expect(parseDrafts(store.get(DRAFTS_KEY) ?? null)).toEqual({
      other: { attachments: [], text: "theirs" },
      [TO]: { attachments: [], text: "mine, longer" },
    })
  })
})

describe("draftSaver", () => {
  test("an idle tab re-rendering its empty box never wipes the draft typed in another tab", () => {
    const store = useStorage()
    const idle = draftSaver(TO, undefined)
    const typing = draftSaver(TO, undefined)
    idle({ attachments: [], text: "" })
    typing({ attachments: [], text: "typed in the other tab" })
    idle({ attachments: [], text: "" })
    idle({ attachments: [], text: "" })
    expect(parseDrafts(store.get(DRAFTS_KEY) ?? null)[TO]?.text).toBe("typed in the other tab")
  })

  test("saves this composer's own edits, a send's empty box included", () => {
    const store = useStorage()
    const save = draftSaver(TO, { attachments: [], text: "restored" })
    save({ attachments: [], text: "restored" })
    expect(store.has(DRAFTS_KEY)).toBe(false)
    save({ attachments: [ref(PDF, "pdf")], text: "restored" })
    expect(parseDrafts(store.get(DRAFTS_KEY) ?? null)[TO]?.attachments).toEqual([ref(PDF, "pdf")])
    save({ attachments: [], text: "" })
    expect(store.has(DRAFTS_KEY)).toBe(false)
  })
})

describe("takeHanded", () => {
  const handed = { attachments: [], text: "update available: 3 new changes", to: "dispatcher" }

  // React runs a new composer's effects twice in development, the second before clearDraft lands: Update now clicked on another page put its line in twice.
  test("takes one hand-off once, however often the composer's effect runs on it", () => {
    let box = "a saved draft"
    let taken: typeof handed | null = null
    for (let run = 0; run < 2; run++) {
      const text = takeHanded(box, handed, "dispatcher", taken)
      if (text === null) continue
      box = text
      taken = handed
    }
    expect(box).toBe("a saved draft\nupdate available: 3 new changes")
  })

  test("puts the words after what is typed, or alone in an empty box, and takes none for another session", () => {
    expect(takeHanded("  ", handed, "dispatcher", null)).toBe(handed.text)
    expect(takeHanded("typed", { ...handed, text: "" }, "dispatcher", null)).toBe("typed")
    expect(takeHanded("typed", handed, "builder", null)).toBeNull()
    expect(takeHanded("typed", null, "dispatcher", null)).toBeNull()
  })
})
