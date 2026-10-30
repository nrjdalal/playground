import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MAX_ATTACHMENT_BYTES } from "../../../../../../api/hono/src/lib/dashboard/attachments"
import { inboxInputSchema } from "../../../../../../api/hono/src/lib/dashboard/inbox"
import { keepAttachments } from "../../../../../../api/hono/src/lib/dashboard/inbox-attachments"

const scratch = mkdtempSync(join(tmpdir(), "inbox-attachments-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const source = join(scratch, "sources")
mkdirSync(source)
const file = (name: string, bytes: Uint8Array | string) => {
  writeFileSync(join(source, name), bytes)
  return join(source, name)
}

let folders = 0
const keep = (attachments: unknown) => {
  const dir = join(scratch, `kept${folders++}`)
  const input = {
    from: "dispatcher",
    preview: { attachments, text: "Look", type: "ask" },
    title: "A mock",
  }
  return keepAttachments(input, { dir }).then((kept) => ({ dir, kept }))
}

describe("bun run ask keeps an ask's pictures (#2282)", () => {
  test("a picture is copied in, and the item keeps its id, kind and name, never the path", async () => {
    const src = file("watching-light-before.png", PNG)
    const { dir, kept } = await keep([{ group: "Watching · Light", label: "before", src }])
    expect(kept.ok).toBe(true)
    const attachments = (kept as { input: { preview: { attachments: unknown[] } } }).input.preview
      .attachments
    const [stored] = readdirSync(dir)
    expect(attachments).toEqual([
      {
        group: "Watching · Light",
        id: stored!,
        kind: "image",
        label: "before",
        name: "watching-light-before.png",
      },
    ])
    expect(JSON.stringify(attachments)).not.toContain(source)
    expect(inboxInputSchema.safeParse((kept as { input: unknown }).input).success).toBe(true)
  })

  test("an item with no attachments passes as it is", async () => {
    const input = { from: "dispatcher", preview: { text: "Look", type: "ask" }, title: "A mock" }
    expect(await keepAttachments(input, { dir: join(scratch, "none") })).toEqual({
      input,
      ok: true,
    })
  })

  test.each([
    [
      "an unknown key",
      () => [{ src: file("a.png", PNG), url: "https://example.com/a.png" }],
      "Unrecognized key",
    ],
    ["a relative path", () => [{ src: "a.png" }], "absolute path"],
    ["a missing file", () => [{ src: join(source, "gone.png") }], "no such file"],
    [
      "bytes that are not a picture",
      () => [{ src: file("fake.png", "not a picture") }],
      "its bytes do not match its kind, image",
    ],
    ["an extension with no kind", () => [{ src: file("data.bin", PNG) }], "name its kind"],
  ])("refuses %s, with a plain line, keeping nothing", async (_, attachments, message) => {
    const { dir, kept } = await keep(attachments())
    expect(kept.ok).toBe(false)
    expect((kept as { message: string }).message).toContain(message)
    expect(() => readdirSync(dir)).toThrow()
  })

  test("refuses a file over the cap", async () => {
    const big = file("big.png", PNG)
    truncateSync(big, MAX_ATTACHMENT_BYTES + 1)
    const { kept } = await keep([{ src: big }])
    expect((kept as { message: string }).message).toContain("A file holds at most 10 MB.")
  })

  // root reads a file whatever its mode, so the check holds only for a user
  test.skipIf(process.getuid?.() === 0)(
    "refuses a file it cannot read, with a plain line",
    async () => {
      const locked = file("locked.png", PNG)
      chmodSync(locked, 0o000)
      const { kept } = await keep([{ src: locked }])
      chmodSync(locked, 0o600)
      expect((kept as { message: string }).message).toContain("it cannot be read")
    },
  )

  test("one bad file of several keeps none of them", async () => {
    const { dir, kept } = await keep([
      { src: file("ok.png", PNG) },
      { src: join(source, "gone.png") },
    ])
    expect(kept.ok).toBe(false)
    expect(() => readdirSync(dir)).toThrow()
  })
})

describe("an ask's stored attachments", () => {
  const ask = (attachments: unknown) => ({
    from: "dispatcher",
    preview: { attachments, text: "Look", type: "ask" },
    title: "A mock",
  })
  const id = "3f0e7a52-1c4b-4d2a-9e6f-0000000000a1.png"

  test("take a kept id, kind and name", () => {
    expect(inboxInputSchema.safeParse(ask([{ id, kind: "image", name: "a.png" }])).success).toBe(
      true,
    )
  })

  test("refuse a path, an id the dashboard never gives, and an unknown key", () => {
    expect(
      inboxInputSchema.safeParse(ask([{ kind: "image", name: "a.png", src: "/tmp/a.png" }]))
        .success,
    ).toBe(false)
    expect(
      inboxInputSchema.safeParse(ask([{ id: "../a.png", kind: "image", name: "a.png" }])).success,
    ).toBe(false)
    expect(
      inboxInputSchema.safeParse(ask([{ id, kind: "image", name: "a.png", url: "x" }])).success,
    ).toBe(false)
  })
})

describe("bun run ask keeps an ask's pages, docs, code and PDFs (#2276, #2277)", () => {
  const data = join(scratch, "data")
  const pages = join(data, "previews")
  mkdirSync(pages, { recursive: true })
  const inFolder = (folder: string, name: string, body: string) => {
    writeFileSync(join(folder, name), body)
    return join(folder, name)
  }
  const keepFrom = (attachments: unknown) =>
    keepAttachments(
      { from: "dispatcher", preview: { attachments, text: "Look", type: "ask" }, title: "A mock" },
      { data, dir: join(scratch, `kept${folders++}`) },
    )
  const kinds = async (attachments: unknown) => {
    const kept = await keepFrom(attachments)
    if (!kept.ok) throw new Error(kept.message)
    return (
      kept.input as { preview: { attachments: { kind: string; name: string }[] } }
    ).preview.attachments.map((a) => [a.name, a.kind])
  }
  const refused = (src: string) => ({
    message: `${src}: an HTML page is taken only from ${data}`,
    ok: false as const,
  })

  test("reads each kind from its extension", async () => {
    expect(
      await kinds([
        { src: file("report.pdf", "%PDF-1.4\n%%EOF\n") },
        { src: file("notes.md", "# Notes\n") },
        { src: file("main.ts", "export const a = 1\n") },
        { src: inFolder(pages, "mock.html", "<!doctype html><p>hi</p>") },
      ]),
    ).toEqual([
      ["report.pdf", "pdf"],
      ["notes.md", "doc"],
      ["main.ts", "code"],
      ["mock.html", "html"],
    ])
  })

  test("refuses a PDF whose bytes are not one", async () => {
    const kept = await keepFrom([{ src: file("fake.pdf", "just text") }])
    expect((kept as { message: string }).message).toContain("its bytes do not match its kind, pdf")
  })

  test("takes an HTML page from the previews folder or anywhere in the data folder", async () => {
    expect(
      await kinds([
        { src: inFolder(pages, "chart.html", "<p>chart</p>") },
        { src: inFolder(data, "report.html", "<p>report</p>") },
      ]),
    ).toEqual([
      ["chart.html", "html"],
      ["report.html", "html"],
    ])
  })

  test("refuses an HTML page anywhere else, by extension or by kind", async () => {
    const outside = file("page.html", "<p>hi</p>")
    expect(await keepFrom([{ src: outside }])).toEqual(refused(outside))
    const named = file("page.txt", "<p>hi</p>")
    expect(await keepFrom([{ kind: "html", src: named }])).toEqual(refused(named))
  })

  test("names a missing HTML page as missing, wherever it was looked for", async () => {
    const gone = join(pages, "gone.html")
    expect(await keepFrom([{ src: gone }])).toEqual({ message: `${gone}: no such file`, ok: false })
  })

  test("refuses a link in the data folder that points out of it, and a path that climbs out", async () => {
    const link = join(pages, "link.html")
    symlinkSync(file("target.html", "<p>hi</p>"), link)
    expect(await keepFrom([{ src: link }])).toEqual(refused(link))
    file("climb.html", "<p>hi</p>")
    const climb = join(data, "..", "sources", "climb.html")
    expect(await keepFrom([{ src: climb }])).toEqual(refused(climb))
  })
})
