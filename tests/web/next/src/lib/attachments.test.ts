import { describe, expect, test } from "bun:test"

import { EXTENSIONS } from "../../../../../api/hono/src/lib/dashboard/attachments"
import {
  ACCEPT,
  ATTACHMENT_EXTENSIONS,
  attachmentUrl,
  byteLabel,
  fitFiles,
  fitRefs,
  heldReducer,
  isAttachmentId,
  kindLabel,
  MAX_FILE_BYTES,
  MAX_FILES,
  pasteTakesFiles,
  uploadWait,
  type Held,
} from "../../../../../web/next/src/lib/attachments"
import { UNREACHED_ATTEMPTS } from "../../../../../web/next/src/lib/outbox"

const files = (n: number) => Array.from({ length: n }, (_, i) => new File(["x"], `f${i}.txt`))

describe("byteLabel", () => {
  test("KB under a megabyte, never 0, and MB with one decimal above", () => {
    expect(byteLabel(10)).toBe("1 KB")
    expect(byteLabel(300_000)).toBe("293 KB")
    expect(byteLabel(1_400_000)).toBe("1.3 MB")
    expect(byteLabel(1_048_300)).toBe("1.0 MB")
  })
})

describe("kindLabel", () => {
  test("names each kind the API gives", () => {
    expect(kindLabel("image")).toBe("Image")
    expect(kindLabel("pdf")).toBe("PDF")
    expect(kindLabel("text")).toBe("Text")
  })
})

describe("fitFiles", () => {
  test("takes what fits beside the files already held, and counts the rest", () => {
    expect(fitFiles(0, files(3))).toMatchObject({ dropped: 0, tooLarge: [] })
    const full = fitFiles(MAX_FILES - 2, files(3))
    expect(full.taken.map((f) => f.name)).toEqual(["f0.txt", "f1.txt"])
    expect(full.dropped).toBe(1)
    expect(fitFiles(MAX_FILES, files(1))).toEqual({ dropped: 1, taken: [], tooLarge: [] })
  })

  test("a file over the API's size cap is left out by name, before it is uploaded", () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.pdf")
    const fit = fitFiles(0, [big, ...files(1)])
    expect(fit.taken.map((f) => f.name)).toEqual(["f0.txt"])
    expect(fit.tooLarge).toEqual(["big.pdf"])
    expect(fit.dropped).toBe(0)
  })
})

describe("the extensions the API keeps", () => {
  test("the web's list is the API's, in A to Z order, and the picker offers every one", () => {
    const web: string[] = [...ATTACHMENT_EXTENSIONS]
    expect(web.sort()).toEqual([...EXTENSIONS].map(String).sort())
    expect([...ATTACHMENT_EXTENSIONS]).toEqual([...ATTACHMENT_EXTENSIONS].sort())
    const offered = ACCEPT.split(",")
    for (const extension of EXTENSIONS) expect(offered).toContain(`.${extension}`)
    const types = offered.filter((entry) => !entry.startsWith("."))
    expect(types).toEqual([...types].sort())
  })
})

describe("isAttachmentId and attachmentUrl", () => {
  const id = "3ec1fab9-9dd4-4327-8bac-642ce1981bf9.png"

  test("an id the API gives has a URL on the API, anything else has none", () => {
    expect(isAttachmentId(id)).toBe(true)
    expect(attachmentUrl(id)).toEndWith(`/api/v1/attachments/${id}`)
    for (const bad of [
      "../../v1/user",
      `../${id}`,
      `${id}?x=1`,
      id.replace(".png", ".exe"),
      id.toUpperCase(),
      "",
    ]) {
      expect(isAttachmentId(bad)).toBe(false)
      expect(attachmentUrl(bad)).toBeNull()
    }
  })
})

describe("pasteTakesFiles", () => {
  test("files with no text, or with only their own names, are what was pasted", () => {
    expect(pasteTakesFiles("", ["a.png"])).toBe(true)
    expect(pasteTakesFiles("a.png", ["a.png"])).toBe(true)
    expect(pasteTakesFiles("a.png\rb.md\n", ["a.png", "b.md"])).toBe(true)
  })

  test("real text beside an image, as a spreadsheet or a slide copies, is the text", () => {
    expect(pasteTakesFiles("Q3\t12\nQ4\t15", ["image.png"])).toBe(false)
    expect(pasteTakesFiles("a.png and more", ["a.png"])).toBe(false)
  })
})

describe("heldReducer", () => {
  const item = (key: string): Held => ({
    key,
    name: `${key}.md`,
    preview: null,
    ref: null,
    size: 1,
    wait: null,
  })
  const ref = { id: "x.md", kind: "text" as const, name: "a.md", previewUrl: null, size: 1 }

  test("an upload settles on its file, and one that finishes after its file was removed changes nothing", () => {
    const two = heldReducer(heldReducer([], { items: [item("a"), item("b")], type: "add" }), {
      key: "a",
      ref,
      type: "settle",
    })
    expect(two.map((h) => [h.key, h.ref?.id ?? null])).toEqual([
      ["a", "x.md"],
      ["b", null],
    ])
    const removed = heldReducer(two, { key: "b", type: "remove" })
    expect(heldReducer(removed, { key: "b", ref, type: "settle" })).toBe(removed)
    expect(heldReducer(removed, { type: "clear" })).toEqual([])
  })

  test("an upload waits as queued between tries, fails with Retry, and settling clears its wait", () => {
    const queued = heldReducer([item("a")], { key: "a", type: "wait", wait: "queued" })
    expect(queued[0]?.wait).toBe("queued")
    expect(heldReducer(queued, { key: "a", type: "wait", wait: "failed" })[0]?.wait).toBe("failed")
    expect(heldReducer(queued, { key: "a", ref, type: "settle" })[0]?.wait).toBeNull()
  })
})

describe("uploadWait", () => {
  test("no answer, or a 5xx while the dashboard restarts, waits on the outbox's backoff, about 2 minutes in all", () => {
    for (const code of ["NETWORK_ERROR", "UNKNOWN_ERROR", "INTERNAL_SERVER_ERROR"])
      expect(uploadWait(code, 1)).toBe(2000)
    const waits = Array.from({ length: UNREACHED_ATTEMPTS - 1 }, (_, i) =>
      uploadWait("NETWORK_ERROR", i + 1),
    )
    expect(waits).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000])
  })

  test("then it fails, keeping the file for Retry", () => {
    expect(uploadWait("NETWORK_ERROR", UNREACHED_ATTEMPTS)).toBe("failed")
  })

  test("a refusal no retry passes is refused at once", () => {
    for (const code of ["PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "TOO_MANY_REQUESTS"])
      expect(uploadWait(code, 1)).toBe("refused")
  })
})

describe("fitRefs", () => {
  test("files Edit hands back fill the room left, and the rest are counted", () => {
    const refs = Array.from({ length: 3 }, (_, i) => ({
      id: `${i}.md`,
      kind: "text" as const,
      name: `${i}.md`,
      previewUrl: null,
      size: 1,
    }))
    expect(fitRefs(MAX_FILES - 2, refs)).toEqual({ dropped: 1, taken: refs.slice(0, 2) })
    expect(fitRefs(0, refs)).toEqual({ dropped: 0, taken: refs })
  })
})
