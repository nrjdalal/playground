import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  attachmentsDir,
  findAttachment,
  ID_PATTERN,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
  RETENTION_MS,
  sniff,
  splitAttachments,
  storeAttachment,
  sweep,
  withAttachments,
} from "../../../../../../api/hono/src/lib/dashboard/attachments"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const scratch = mkdtempSync(join(tmpdir(), "dashboard-attachments-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

let folders = 0
const folder = () => join(scratch, `f${folders++}`)

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part)] : part)),
  )

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest of a png")
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "rest of a jpeg")
const GIF = bytes("GIF89a", "rest of a gif")
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")
const PDF = bytes("%PDF-1.7\n", "rest of a pdf")

const mode = (path: string) => lstatSync(path).mode & 0o777

describe("sniff", () => {
  test("an image, a PDF or text is told by its bytes, whatever its name says", () => {
    expect(sniff(PNG, "photo.jpg")).toBe("png")
    expect(sniff(JPEG, "x.png")).toBe("jpg")
    expect(sniff(GIF, "x")).toBe("gif")
    expect(sniff(WEBP, "x.webp")).toBe("webp")
    expect(sniff(PDF, "notes.txt")).toBe("pdf")
  })

  test("text keeps an extension on the list, and anything else is .txt", () => {
    expect(sniff(bytes("# notes"), "README.md")).toBe("md")
    expect(sniff(bytes("{}"), "data.JSON")).toBe("json")
    expect(sniff(bytes("plain"), "")).toBe("txt")
    expect(sniff(bytes("<svg onload=alert(1)/>"), "logo.svg")).toBe("txt")
    expect(sniff(bytes("x=1"), "../../etc/passwd")).toBe("txt")
    expect(sniff(bytes("\u001b[31mred\u001b[0m\tok\r\n"), "build.log")).toBe("log")
  })

  test("bytes that are neither an image, a PDF nor text are refused", () => {
    expect(sniff(bytes("PK", [3, 4, 0, 0]), "a.zip")).toBeNull()
    expect(sniff(bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0]), "a.out")).toBeNull()
    expect(sniff(bytes("text with a", [0], "nul"), "a.txt")).toBeNull()
    expect(sniff(bytes([0xc3, 0x28]), "bad.txt")).toBeNull()
  })
})

describe("storeAttachment", () => {
  test("a file is kept under a name the dashboard makes, readable by its owner alone, in a folder only its owner can enter", async () => {
    const dir = folder()
    const stored = await storeAttachment(PNG, "../../../evil name.png", { dir })
    expect(stored).toMatchObject({ kind: "image", ok: true, size: PNG.length })
    if (!stored.ok) throw new Error("not stored")
    expect(stored.id).toMatch(ID_PATTERN)
    expect(stored.id).toEndWith(".png")
    expect(readdirSync(dir)).toEqual([stored.id])
    expect(mode(dir)).toBe(0o700)
    expect(mode(join(dir, stored.id))).toBe(0o600)
  })

  test("a folder something widened is put back to 0700", async () => {
    const dir = folder()
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)
    expect((await storeAttachment(PDF, "a.pdf", { dir })).ok).toBe(true)
    expect(mode(dir)).toBe(0o700)
  })

  test("a folder that is a symlink is refused, and nothing is written through it", async () => {
    const real = folder()
    mkdirSync(real, { mode: 0o700 })
    const link = folder()
    symlinkSync(real, link)
    await expect(storeAttachment(PNG, "a.png", { dir: link })).rejects.toThrow()
    expect(readdirSync(real)).toEqual([])
  })

  test("an empty file, one too large and one of another kind are refused before anything is written", async () => {
    const dir = folder()
    expect(await storeAttachment(new Uint8Array(), "a.txt", { dir })).toMatchObject({
      code: "EMPTY",
      ok: false,
    })
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(0x61)
    expect(await storeAttachment(big, "a.txt", { dir })).toMatchObject({ code: "TOO_LARGE" })
    expect(await storeAttachment(bytes("PK", [3, 4]), "a.zip", { dir })).toMatchObject({
      code: "UNSUPPORTED",
    })
    expect(readdirSync(scratch)).not.toContain(dir.split("/").pop())
  })

  test("an expired file is swept before the cap is counted, so its room is free again", async () => {
    const dir = folder()
    const old = await storeAttachment(bytes("x".repeat(60)), "a.txt", { dir, maxFolderBytes: 100 })
    if (!old.ok) throw new Error("not stored")
    const longAgo = new Date(Date.now() - RETENTION_MS - 60_000)
    utimesSync(join(dir, old.id), longAgo, longAgo)
    const fresh = await storeAttachment(bytes("y".repeat(60)), "b.txt", {
      dir,
      maxFolderBytes: 100,
    })
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) throw new Error("not stored")
    expect(readdirSync(dir)).toEqual([fresh.id])
  })

  test("a full folder refuses another file", async () => {
    const dir = folder()
    const first = await storeAttachment(bytes("x".repeat(60)), "a.txt", {
      dir,
      maxFolderBytes: 100,
    })
    expect(first.ok).toBe(true)
    expect(
      await storeAttachment(bytes("y".repeat(60)), "b.txt", { dir, maxFolderBytes: 100 }),
    ).toMatchObject({ code: "FULL", ok: false })
  })
})

describe("findAttachment", () => {
  test("an id the dashboard gave finds its file, with its kind, absolute path and size", async () => {
    const dir = folder()
    const stored = await storeAttachment(GIF, "a.gif", { dir })
    if (!stored.ok) throw new Error("not stored")
    expect(await findAttachment(stored.id, dir)).toEqual({
      id: stored.id,
      kind: "image",
      path: join(dir, stored.id),
      size: GIF.length,
    })
  })

  test("anything but a dashboard-made name in the folder itself finds nothing", async () => {
    const dir = folder()
    const stored = await storeAttachment(PNG, "a.png", { dir })
    if (!stored.ok) throw new Error("not stored")
    const outside = join(scratch, "secret.txt")
    writeFileSync(outside, "secret")
    for (const id of [
      "../secret.txt",
      outside,
      `../${dir.split("/").pop()}/${stored.id}`,
      "secret.txt",
      stored.id.replace(".png", ".exe"),
      `${stored.id}/`,
      "",
    ]) {
      expect(await findAttachment(id, dir)).toBeNull()
    }
  })

  test("a dashboard-made name that is a symlink or a folder finds nothing", async () => {
    const dir = folder()
    mkdirSync(dir, { mode: 0o700 })
    const outside = join(scratch, "linked.txt")
    writeFileSync(outside, "secret")
    const linked = "11111111-2222-4333-8444-555555555555.txt"
    symlinkSync(outside, join(dir, linked))
    const folderNamed = "11111111-2222-4333-8444-666666666666.txt"
    mkdirSync(join(dir, folderNamed))
    expect(await findAttachment(linked, dir)).toBeNull()
    expect(await findAttachment(folderNamed, dir)).toBeNull()
  })

  test("a dashboard-made name hard-linked to a file elsewhere finds nothing", async () => {
    const dir = folder()
    mkdirSync(dir, { mode: 0o700 })
    const outside = join(scratch, "hard.txt")
    writeFileSync(outside, "secret")
    const linked = "11111111-2222-4333-8444-777777777777.txt"
    linkSync(outside, join(dir, linked))
    expect(await findAttachment(linked, dir)).toBeNull()
    expect(await readAttachment(linked, dir)).toBeNull()
  })

  test("readAttachment gives a found file's bytes, and null once it is gone", async () => {
    const dir = folder()
    const stored = await storeAttachment(PDF, "a.pdf", { dir })
    if (!stored.ok) throw new Error("not stored")
    const read = await readAttachment(stored.id, dir)
    expect(read?.file).toMatchObject({ id: stored.id, kind: "pdf", size: PDF.length })
    expect([...(read?.bytes ?? [])]).toEqual([...PDF])
    expect(await readAttachment("11111111-2222-4333-8444-555555555555.pdf", dir)).toBeNull()
  })

  test("an id that is gone finds nothing", async () => {
    expect(await findAttachment("11111111-2222-4333-8444-555555555555.png", folder())).toBeNull()
  })
})

describe("sweep", () => {
  test("files older than the retention go, newer ones and names the dashboard did not make stay", async () => {
    const dir = folder()
    const old = await storeAttachment(PNG, "old.png", { dir })
    const fresh = await storeAttachment(PDF, "fresh.pdf", { dir })
    if (!old.ok || !fresh.ok) throw new Error("not stored")
    writeFileSync(join(dir, "notes"), "not ours")
    const now = new Date()
    const longAgo = new Date(now.getTime() - RETENTION_MS - 60_000)
    utimesSync(join(dir, old.id), longAgo, longAgo)
    utimesSync(join(dir, "notes"), longAgo, longAgo)
    expect(await sweep(dir, now)).toBe(PDF.length)
    expect(readdirSync(dir).sort()).toEqual([fresh.id, "notes"].sort())
  })

  test("a folder that is missing holds nothing", async () => {
    expect(await sweep(folder())).toBe(0)
  })
})

describe("the attachments folder", () => {
  test("is PLAYGROUND_ATTACHMENTS_DIR when set, else beside the roster", () => {
    const saved = {
      home: process.env.HOME,
      dir: process.env.PLAYGROUND_ATTACHMENTS_DIR,
    }
    try {
      process.env.PLAYGROUND_ATTACHMENTS_DIR = "/tmp/dashboard-files"
      expect(attachmentsDir()).toBe("/tmp/dashboard-files")
      delete process.env.PLAYGROUND_ATTACHMENTS_DIR
      process.env.HOME = "/home/x"
      expect(attachmentsDir()).toBe("/home/x/.playground/attachments")
    } finally {
      for (const [key, value] of [
        ["HOME", saved.home],
        ["PLAYGROUND_ATTACHMENTS_DIR", saved.dir],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe("withAttachments and splitAttachments", () => {
  const dir = "/home/x/.playground/attachments"
  const png = "11111111-2222-4333-8444-555555555555.png"
  const pdf = "11111111-2222-4333-8444-666666666666.pdf"
  const files = [
    { path: join(dir, png), size: 1 },
    { path: join(dir, pdf), size: 2 },
  ]

  test("the files follow the words, one Attached line each, after a blank line", () => {
    expect(withAttachments("look at these", files)).toBe(
      `look at these\n\nAttached: ${dir}/${png}\nAttached: ${dir}/${pdf}`,
    )
  })

  test("a message of files alone starts with a word, never with a path", () => {
    expect(withAttachments("", files.slice(0, 1))).toBe(`Attached: ${dir}/${png}`)
  })

  test("a message with no files is its words", () => {
    expect(withAttachments("hello", [])).toBe("hello")
  })

  test("the trailing Attached lines come back out as ids and kinds, leaving the words", () => {
    expect(splitAttachments(withAttachments("look\nat these", files), dir)).toEqual({
      attachments: [
        { id: png, kind: "image" },
        { id: pdf, kind: "pdf" },
      ],
      text: "look\nat these",
    })
    expect(splitAttachments(withAttachments("", files), dir)).toEqual({
      attachments: [
        { id: png, kind: "image" },
        { id: pdf, kind: "pdf" },
      ],
      text: "",
    })
  })

  test("an Attached line anywhere else, or naming any other path, stays the person's words", () => {
    const kept = [
      "Attached: /etc/passwd",
      `Attached: ${dir}/../secret/${png}`,
      `Attached: ${dir}/sub/${png}`,
      `Attached: ${dir}/notes.txt`,
      `Attached: ${dir}/${png}\nand then words`,
      `Attached:${dir}/${png}`,
    ]
    for (const text of kept) {
      expect(splitAttachments(text, dir)).toEqual({ attachments: [], text })
    }
  })

  test("only the trailing run of Attached lines is lifted", () => {
    const text = `Attached: /etc/passwd\nAttached: ${dir}/${png}`
    expect(splitAttachments(text, dir)).toEqual({
      attachments: [{ id: png, kind: "image" }],
      text: "Attached: /etc/passwd",
    })
  })
})
