import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { WRITE_IDS_FILE, writeIdStore } =
  await import("../../../../../../api/hono/src/lib/relay/write-ids")

const scratch = mkdtempSync(join(tmpdir(), "relay-write-ids-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ONE = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
const TWO = "7a2d3b4c-5e6f-4a70-9b8c-0d1e2f3a4b5c"

describe("the write ids this Mac took, in the data folder", () => {
  test("takes an id once, across a fresh store on the same folder, at mode 600", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    expect(await writeIdStore({ dir: () => dir }).claim(ONE, 2000, 1000)).toBe(true)
    expect(await writeIdStore({ dir: () => dir }).claim(ONE, 2000, 1500)).toBe(false)
    expect(statSync(join(dir, WRITE_IDS_FILE)).mode & 0o777).toBe(0o600)
  })

  test("drops an id once its frame has expired, so the file holds only live ones", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    const ids = writeIdStore({ dir: () => dir })
    await ids.claim(ONE, 2000, 1000)
    await ids.claim(TWO, 5000, 2000)
    expect(Object.keys(await Bun.file(join(dir, WRITE_IDS_FILE)).json())).toEqual([TWO])
  })

  test("two frames with one id at once: only one is taken", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    const ids = writeIdStore({ dir: () => dir })
    expect(await Promise.all([ids.claim(ONE, 2000, 1000), ids.claim(ONE, 2000, 1000)])).toEqual([
      true,
      false,
    ])
  })

  test("a file that does not read as one refuses every claim", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    await Bun.write(join(dir, WRITE_IDS_FILE), "not json")
    await expect(writeIdStore({ dir: () => dir }).claim(ONE, 2000, 1000)).rejects.toThrow()
  })
})
