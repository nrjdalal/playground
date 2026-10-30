import { deflateSync } from "node:zlib"

import type { NewEntry } from "@/plugins/changelog/sources"

// Made-up entries for a test stack, whose database must never hold real lines (sync and seed refuse there): `bun run changelog fixture` writes these, each time moved to now, with two drawn screenshots, so a tester sees an entry with images and a Markdown detail (a list and a link), one with a list alone, one with neither, and a version.

const BEFORE_ID = "00000000-0000-4000-8000-000000000001.png"
const AFTER_ID = "00000000-0000-4000-8000-000000000002.png"

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

type Box = {
  color: [number, number, number]
  h: number
  w: number
  x: number
  y: number
}

// A flat RGB PNG of boxes on a light ground: a drawn stand-in for a page, never a real screen.
export function drawPng(width: number, height: number, boxes: Box[]): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      const box = boxes.findLast((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
      const [r, g, b] = box?.color ?? [246, 246, 247]
      raw.set([r, g, b], row + 1 + x * 3)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const SIDEBAR: Box = { color: [228, 228, 231], h: 450, w: 200, x: 0, y: 0 }
const rows = (color: Box["color"]): Box[] =>
  [0, 1, 2, 3].map((i) => ({ color, h: 18, w: 150, x: 24, y: 80 + i * 36 }))

let drawn: { bytes: Uint8Array; id: string }[] | null = null

// The screenshots the fixture's first entry carries, by the fixed ids it names them under, drawn on first use so a stack that reads this machine never draws them.
export const fixtureImages = (): { bytes: Uint8Array; id: string }[] =>
  (drawn ??= [
    { bytes: drawPng(800, 450, [SIDEBAR, ...rows([161, 161, 170])]), id: BEFORE_ID },
    {
      bytes: drawPng(800, 450, [
        SIDEBAR,
        ...rows([161, 161, 170]),
        { color: [14, 165, 233], h: 14, w: 14, x: 180, y: 82 },
      ]),
      id: AFTER_ID,
    },
  ])

const HOUR = 60 * 60 * 1000

// The fixture's rows, newest first, `at` hours before now.
export function fixtureEntries(now = new Date()): NewEntry[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR)
  return [
    {
      at: ago(1),
      detail: [
        "The Changelog square in the sidebar now shows how many changes you have not read.",
        "",
        "- Opening the Changelog marks them read.",
        "- Each person has their own count, kept by **when you last looked**.",
        "- See [the example notes](https://example.com/notes/212) for the rules.",
        "- It builds on #209, which made long messages wrap.",
      ].join("\n"),
      images: [
        { alt: "Before: the Changelog square with no count", id: BEFORE_ID },
        { alt: "After: a count of new changes in its corner", id: AFTER_ID },
      ],
      kind: "feature",
      link: "https://github.com/example/factory/pull/212",
      sourceKey: "fixture:212",
      text: "The sidebar counts the changes you have not read yet.",
    },
    {
      at: ago(3),
      detail: [
        "- A long message no longer runs past the edge of its bubble.",
        "- Words and long links wrap onto the next line instead.",
      ].join("\n"),
      kind: "fix",
      link: "https://github.com/example/factory/pull/209",
      sourceKey: "fixture:209",
      text: "Long messages wrap inside their bubble.",
    },
    {
      at: ago(5),
      kind: "rule",
      link: null,
      sourceKey: "fixture:rule-small-tickets",
      text: "Workers take small tickets first.",
    },
    {
      at: ago(26),
      kind: "release",
      link: "https://github.com/example/factory/releases/tag/v0.0.9",
      sourceKey: "fixture:v0.0.9",
      text: "Version v0.0.9 is out, with 2 changes.",
    },
    {
      at: ago(30),
      detail: "Plan opens on the Report tab, which says in plain words what each lane is doing.",
      kind: "feature",
      link: "https://github.com/example/factory/pull/201",
      sourceKey: "fixture:201",
      text: "Plan opens on a report of what each lane is doing.",
    },
    {
      at: ago(34),
      kind: "ops",
      link: null,
      sourceKey: "fixture:ops-sweep",
      text: "Old worktrees are cleaned up every night.",
    },
  ]
}
