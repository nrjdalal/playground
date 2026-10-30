import { afterAll, describe, expect, test } from "bun:test"
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  findPreview,
  isPreviewName,
  previewHeaders,
  previewsDir,
  readPreview,
  readPreviews,
  topicOf,
} from "../../../../../../api/hono/src/lib/apps/previews"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const scratch = mkdtempSync(join(tmpdir(), "dashboard-previews-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

let folders = 0
const folder = () => {
  const dir = join(scratch, `f${folders++}`)
  mkdirSync(dir, { mode: 0o700 })
  return dir
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1")
const WEBP = Buffer.concat([Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8 ", "latin1"), Buffer.alloc(8)])
const HTML =
  "<style>@keyframes s{to{transform:rotate(1turn)}}div{animation:s 1s infinite}</style><div>o</div>"

// Each file is given its own time, so the order newest first is the test's to set.
const put = (dir: string, name: string, bytes: Buffer | string, minutesAgo = 0) => {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  const at = new Date(Date.now() - minutesAgo * 60_000)
  utimesSync(path, at, at)
  return path
}

// Runs fn as if this process were another user, so a folder the test made reads as someone else's.
async function asAnotherUser<T>(fn: () => Promise<T>): Promise<T> {
  const real = process.getuid
  const uid = real?.() ?? 0
  process.getuid = () => uid + 1
  try {
    return await fn()
  } finally {
    process.getuid = real
  }
}

describe("isPreviewName", () => {
  test("a plain name with a preview's extension is one", () => {
    for (const name of ["spinner-light-1.png", "a.gif", "System_item.2.webp", "x.html"]) {
      expect(isPreviewName(name)).toBe(true)
    }
  })

  test("a name with / or .., a leading dot or dash, or a type off the list is not", () => {
    for (const name of [
      "../secret.png",
      "a/b.png",
      "a\\b.png",
      "a..b.png",
      "..png",
      ".hidden.png",
      "-x.png",
      "a.svg",
      "a.jpg",
      "a.txt",
      "a.htm",
      "a.PNG",
      "a.png.svg",
      "a png.png",
      "",
    ]) {
      expect(isPreviewName(name)).toBe(false)
    }
  })
})

describe("topicOf", () => {
  test("is the name before its first - or .", () => {
    expect(topicOf("spinner-light-1.png")).toBe("spinner")
    expect(topicOf("spinner-preview.html")).toBe("spinner")
    expect(topicOf("system-item-2.png")).toBe("system")
    expect(topicOf("logo.png")).toBe("logo")
  })
})

describe("readPreviews", () => {
  test("lists each preview newest first, with its topic, kind, size and the caption beside it", async () => {
    const dir = folder()
    put(dir, "spinner-light-1.png", PNG, 30)
    put(dir, "spinner-preview.html", HTML, 10)
    put(dir, "spinner-preview.txt", "  The spinner, live  \n")
    put(dir, "logo.gif", GIF, 20)
    put(dir, "notes.txt", "a caption with no preview")
    put(dir, "sketch.svg", "<svg/>")
    const { previews, problems } = await readPreviews(dir)
    expect(problems).toEqual([])
    expect(previews.map((p) => p.name)).toEqual([
      "spinner-preview.html",
      "logo.gif",
      "spinner-light-1.png",
    ])
    expect(previews[0]).toMatchObject({
      caption: "The spinner, live",
      kind: "html",
      size: HTML.length,
      topic: "spinner",
    })
    expect(previews[1]).toMatchObject({ caption: null, kind: "image", topic: "logo" })
  })

  test("a folder that is missing holds none, and says nothing", async () => {
    expect(await readPreviews(join(scratch, "missing"))).toEqual({ previews: [], problems: [] })
  })

  test("a folder that is a symlink is named and read from not at all", async () => {
    const real = folder()
    put(real, "a.png", PNG)
    const link = join(scratch, `link${folders++}`)
    symlinkSync(real, link)
    const { previews, problems } = await readPreviews(link)
    expect(previews).toEqual([])
    expect(problems).toEqual([
      `${link} is not a folder this user owns, so no preview is read from it`,
    ])
  })

  test("another user's folder is named and read from not at all", async () => {
    const dir = folder()
    put(dir, "a.png", PNG)
    const { previews, problems } = await asAnotherUser(() => readPreviews(dir))
    expect(previews).toEqual([])
    expect(problems).toHaveLength(1)
  })

  test("a symlink, a hard link, a folder, a bad name and bytes that are not what the name says are each named and left out", async () => {
    const dir = folder()
    const outside = folder()
    put(dir, "ok.png", PNG)
    symlinkSync(put(outside, "target.png", PNG), join(dir, "linked.png"))
    linkSync(put(outside, "shared.png", PNG), join(dir, "hard.png"))
    mkdirSync(join(dir, "folder.png"))
    put(dir, "bad name.png", PNG)
    put(dir, "fake.png", HTML)
    put(dir, "binary.html", PNG)
    const { previews, problems } = await readPreviews(dir)
    expect(previews.map((p) => p.name)).toEqual(["ok.png"])
    expect(problems.map((problem) => problem.split(":")[0])).toEqual([
      "bad name.png",
      "binary.html",
      "fake.png",
      "folder.png",
      "hard.png",
      "linked.png",
    ])
  })

  test("a caption that is a symlink is not read", async () => {
    const dir = folder()
    const outside = folder()
    put(dir, "a.png", PNG)
    symlinkSync(put(outside, "secret.txt", "a secret"), join(dir, "a.txt"))
    const { previews } = await readPreviews(dir)
    expect(previews[0]?.caption).toBeNull()
  })
})

describe("findPreview and readPreview", () => {
  test("a preview's name finds its file and gives its bytes", async () => {
    const dir = folder()
    put(dir, "a.png", PNG)
    put(dir, "b.webp", WEBP)
    put(dir, "c.html", HTML)
    expect(await findPreview("a.png", dir)).toEqual({
      kind: "image",
      name: "a.png",
      path: join(dir, "a.png"),
      size: PNG.length,
    })
    expect((await readPreview("a.png", dir))?.bytes).toEqual(Uint8Array.from(PNG))
    expect((await readPreview("b.webp", dir))?.file.kind).toBe("image")
    expect(new TextDecoder().decode((await readPreview("c.html", dir))?.bytes)).toBe(HTML)
  })

  test("a name with / or .. finds nothing, even when the file it reaches exists", async () => {
    const dir = folder()
    const inner = join(dir, "inner")
    mkdirSync(inner, { mode: 0o700 })
    put(dir, "outside.png", PNG)
    for (const name of [
      "../outside.png",
      "inner/../outside.png",
      "inner/x.png",
      `${dir}/outside.png`,
    ]) {
      expect(await findPreview(name, inner)).toBeNull()
    }
  })

  test("a symlink finds nothing", async () => {
    const dir = folder()
    const outside = folder()
    symlinkSync(put(outside, "target.png", PNG), join(dir, "a.png"))
    expect(await findPreview("a.png", dir)).toBeNull()
    expect(await readPreview("a.png", dir)).toBeNull()
  })

  test("a hard link to a file elsewhere finds nothing", async () => {
    const dir = folder()
    const outside = folder()
    linkSync(put(outside, "target.png", PNG), join(dir, "a.png"))
    expect(await findPreview("a.png", dir)).toBeNull()
  })

  test("a file in a symlinked folder or another user's folder finds nothing", async () => {
    const real = folder()
    put(real, "a.png", PNG)
    const link = join(scratch, `link${folders++}`)
    symlinkSync(real, link)
    expect(await findPreview("a.png", link)).toBeNull()
    expect(await asAnotherUser(() => findPreview("a.png", real))).toBeNull()
  })

  test("a type off the list finds nothing, even when it is there", async () => {
    const dir = folder()
    put(dir, "a.svg", "<svg onload='alert(1)'/>")
    put(dir, "a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00]))
    put(dir, "a.txt", "text")
    for (const name of ["a.svg", "a.jpg", "a.txt"]) expect(await findPreview(name, dir)).toBeNull()
  })

  test("bytes that are not what the name says are not served", async () => {
    const dir = folder()
    put(dir, "fake.png", HTML)
    put(dir, "fake.gif", PNG)
    put(dir, "binary.html", PNG)
    for (const name of ["fake.png", "fake.gif", "binary.html"]) {
      expect(await findPreview(name, dir)).not.toBeNull()
      expect(await readPreview(name, dir)).toBeNull()
    }
  })
})

describe("previewHeaders", () => {
  const origins = ["https://playground.localhost"]

  test("an image is shown as itself, never sniffed and never run", () => {
    expect(previewHeaders({ kind: "image", name: "a.png" }, origins)).toEqual({
      "cache-control": "private, no-cache",
      "content-disposition": "inline",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-type": "image/png",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    })
  })

  test('an HTML page runs its own inline script in a sandbox with an opaque origin, its sandbox lifting scripts alone and nothing loading but its own inline script and styles and data: images and fonts, framed by the dashboard alone (the owner: "why navigation is not working in html")', () => {
    const csp = previewHeaders({ kind: "html", name: "a.html" }, origins)[
      "content-security-policy"
    ]!
    expect(csp.split("; ")).toEqual([
      "sandbox allow-scripts",
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      "font-src data:",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${origins[0]}`,
    ])
    expect(
      previewHeaders({ kind: "html", name: "a.html" }, [])["content-security-policy"],
    ).toContain("frame-ancestors 'none'")
  })
})

describe("the previews folder", () => {
  test("is PLAYGROUND_PREVIEWS_DIR when set, else beside the roster", () => {
    const saved = {
      home: process.env.HOME,
      dir: process.env.PLAYGROUND_PREVIEWS_DIR,
    }
    try {
      process.env.PLAYGROUND_PREVIEWS_DIR = "/tmp/dashboard-previews"
      expect(previewsDir()).toBe("/tmp/dashboard-previews")
      delete process.env.PLAYGROUND_PREVIEWS_DIR
      process.env.HOME = "/home/x"
      expect(previewsDir()).toBe("/home/x/.playground/previews")
    } finally {
      for (const [key, value] of [
        ["HOME", saved.home],
        ["PLAYGROUND_PREVIEWS_DIR", saved.dir],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe("readPreviews with a session (#1850)", () => {
  const line = (file: string, by: string, forName: string | null, at: string) =>
    JSON.stringify({ at, by, file, for: forName, title: `Title of ${file}` })

  // Three pages kept by playground page, a screenshot with no line, and a line that is not a page's record.
  const pagesFolder = () => {
    const dir = folder()
    put(dir, "lookup.html", HTML, 30)
    put(dir, "mock.html", HTML, 20)
    put(dir, "theirs.html", HTML, 10)
    put(dir, "shot.png", PNG)
    writeFileSync(
      join(dir, "pages.jsonl"),
      [
        line("lookup.html", "vwrv7f-worker", "planner", "2026-10-23T10:00:00.000Z"),
        line("mock.html", "planner", null, "2026-10-23T12:00:00.000Z"),
        line("theirs.html", "k3m9px-worker", "builder", "2026-10-23T11:00:00.000Z"),
        "not json",
        "",
      ].join("\n"),
    )
    return dir
  }
  const names = async (dir: string, session: string) =>
    (await readPreviews(dir, { dispatcher: "dispatcher", session })).previews.map((p) => p.name)

  test("lists the pages a session made or that were made for it, newest kept first, and no screenshot", async () => {
    const dir = pagesFolder()
    expect(await names(dir, "planner")).toEqual(["mock.html", "lookup.html"])
    expect(await names(dir, "vwrv7f-worker")).toEqual(["lookup.html"])
    expect(await names(dir, "ops")).toEqual([])
    const { previews, problems } = await readPreviews(dir, {
      dispatcher: "dispatcher",
      session: "vwrv7f-worker",
    })
    expect(previews[0]!.page).toEqual({
      at: "2026-10-23T10:00:00.000Z",
      by: "vwrv7f-worker",
      for: "planner",
      title: "Title of lookup.html",
    })
    expect(problems).toEqual(["pages.jsonl line 4: not a page's record"])
  })

  test("lists every page on the primary dispatcher's view, and still none of the screenshots", async () => {
    expect(await names(pagesFolder(), "dispatcher")).toEqual([
      "mock.html",
      "theirs.html",
      "lookup.html",
    ])
  })

  test("with no session, the Previews app's list keeps every file and marks each kept page", async () => {
    const { previews } = await readPreviews(pagesFolder())
    expect(previews.map((p) => p.name)).toEqual([
      "shot.png",
      "theirs.html",
      "mock.html",
      "lookup.html",
    ])
    expect(previews[0]!.page).toBeUndefined()
    expect(previews[1]!.page?.by).toBe("k3m9px-worker")
  })
})
