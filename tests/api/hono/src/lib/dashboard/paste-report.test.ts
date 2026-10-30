import { afterAll, describe, expect, test } from "bun:test"
import { lstatSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  PASTE_REPORT_ENTRIES,
  type PasteReport,
  pasteReportSchema,
  pasteReportsDir,
  storePasteReport,
} from "../../../../../../api/hono/src/lib/dashboard/paste-report"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const scratch = mkdtempSync(join(tmpdir(), "dashboard-paste-reports-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const entry: PasteReport["entries"][number] = {
  active: "#composer",
  at: "2026-10-18T12:11:00.000Z",
  boxLength: 0,
  cause: null,
  delay: 640,
  event: "keydown",
  inBox: true,
  inputType: null,
  length: 0,
  mount: "k3j9x2",
  prevented: false,
  reached: "box",
  related: "none",
  target: "#composer",
  types: [],
  visible: true,
}
const report: PasteReport = { entries: [entry], miss: "no-paste" }

describe("pasteReportSchema (PG-1015)", () => {
  test("takes an entry with no reached, as a page from before it logged", () => {
    const { reached: _, ...earlier } = entry
    expect(pasteReportSchema.safeParse({ entries: [earlier], miss: "load" }).success).toBe(true)
  })

  test("keeps an entry's names, lengths, timing and types, and drops any other field", () => {
    const parsed = pasteReportSchema.parse({
      entries: [{ ...entry, text: "dictated words nobody may read" }],
      miss: "no-paste",
      words: "dictated words nobody may read",
    })
    expect(parsed).toEqual(report)
    expect(JSON.stringify(parsed)).not.toContain("dictated")
  })

  test("refuses a name or a type that could hold words, and an unknown miss", () => {
    const bad = (patch: Record<string, unknown>, miss = "no-paste") =>
      pasteReportSchema.safeParse({ entries: [{ ...entry, ...patch }], miss }).success
    expect(bad({ active: "dictated words" })).toBe(false)
    expect(bad({ target: "x".repeat(101) })).toBe(false)
    expect(bad({ types: ["text/plain", "dictated words"] })).toBe(false)
    expect(bad({ inputType: "insert Text" })).toBe(false)
    expect(bad({ delay: -1 })).toBe(false)
    expect(bad({}, "typed")).toBe(false)
    expect(bad({ related: "dictated words" })).toBe(false)
    expect(bad({ mount: "x".repeat(101) })).toBe(false)
    expect(bad({ reached: "dictated words" })).toBe(false)
    expect(bad({ reached: "none" }, "off-box")).toBe(true)
    expect(bad({ cause: "empty-insert", event: "emptied" }, "emptied")).toBe(true)
    expect(bad({ cause: "dictated words", event: "emptied" }, "emptied")).toBe(false)
    expect(bad({ inputType: "insertFromPaste", types: ["text/plain", "Files"] })).toBe(true)
  })

  test(`holds 1 to ${PASTE_REPORT_ENTRIES} entries`, () => {
    const entries = (n: number) => Array.from({ length: n }, () => entry)
    expect(pasteReportSchema.safeParse({ entries: [], miss: "no-paste" }).success).toBe(false)
    expect(
      pasteReportSchema.safeParse({ entries: entries(PASTE_REPORT_ENTRIES), miss: "no-paste" })
        .success,
    ).toBe(true)
    expect(
      pasteReportSchema.safeParse({ entries: entries(PASTE_REPORT_ENTRIES + 1), miss: "no-paste" })
        .success,
    ).toBe(false)
  })
})

test("takes a page load's whole log, the focus and mount events, and an older entry's unknowns", () => {
  const events = ["blur", "focus", "focusout", "mount", "unmount", "visibilitychange"] as const
  const parsed = pasteReportSchema.safeParse({
    entries: [
      ...events.map((event) => ({ ...entry, event })),
      { ...entry, inBox: null, mount: "none", visible: null },
    ],
    miss: "load",
  })
  expect(parsed.success).toBe(true)
})

describe("storePasteReport", () => {
  test("writes one 0600 file in a 0700 folder, holding the miss and its entries", async () => {
    const dir = join(scratch, "reports")
    const name = await storePasteReport(report, { dir })
    expect(lstatSync(dir).mode & 0o777).toBe(0o700)
    expect(lstatSync(join(dir, name)).mode & 0o777).toBe(0o600)
    expect(await Bun.file(join(dir, name)).json()).toMatchObject(report)
    expect(readdirSync(dir)).toEqual([name])
  })
})

describe("the paste reports folder", () => {
  test("is PLAYGROUND_DEBUG_PASTE_DIR when set, else debug/paste in the data folder", () => {
    const saved = {
      home: process.env.HOME,
      dir: process.env.PLAYGROUND_DEBUG_PASTE_DIR,
    }
    try {
      process.env.PLAYGROUND_DEBUG_PASTE_DIR = "/tmp/dashboard-paste"
      expect(pasteReportsDir()).toBe("/tmp/dashboard-paste")
      delete process.env.PLAYGROUND_DEBUG_PASTE_DIR
      process.env.HOME = "/home/x"
      expect(pasteReportsDir()).toBe("/home/x/.playground/debug/paste")
    } finally {
      for (const [key, value] of [
        ["HOME", saved.home],
        ["PLAYGROUND_DEBUG_PASTE_DIR", saved.dir],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})
