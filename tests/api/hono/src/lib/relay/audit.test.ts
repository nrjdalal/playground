import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { AUDIT_FILE, AUDIT_KEPT, AUDIT_SHOWN, auditLog } =
  await import("../../../../../../api/hono/src/lib/relay/audit")

const scratch = mkdtempSync(join(tmpdir(), "relay-audit-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const line = (n: number) => ({
  at: new Date(Date.UTC(2026, 10, 5, 1, 0, n)).toISOString(),
  fingerprint: n % 2 ? "a0a2 32c2 f194 a535" : "7164 56b9 4c42 3c99",
  path: "/api/v1/messages",
  status: n % 3 ? 201 : 403,
})

describe("the relayed writes' audit, in the data folder", () => {
  test("reads empty before any write", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    expect(await auditLog({ dir: () => dir }).recent()).toEqual([])
  })

  test("keeps each write's time, path, key and status at mode 600, and shows the last 20, newest first", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    const audit = auditLog({ dir: () => dir })
    for (let n = 0; n < 25; n++) await audit.append(line(n))
    const shown = await audit.recent()
    expect(AUDIT_SHOWN).toBe(20)
    expect(shown).toEqual(Array.from({ length: 20 }, (_, i) => line(24 - i)))
    expect(statSync(join(dir, AUDIT_FILE)).mode & 0o777).toBe(0o600)
  })

  test("keeps the last 200 lines in the file, the oldest dropped, and every line of writes answered at once", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    const audit = auditLog({ dir: () => dir })
    await Promise.all(Array.from({ length: AUDIT_KEPT + 5 }, (_, n) => audit.append(line(n))))
    const kept = (await Bun.file(join(dir, AUDIT_FILE)).text()).trim().split("\n")
    expect(AUDIT_KEPT).toBe(200)
    expect(kept.map((one) => JSON.parse(one))).toEqual(
      Array.from({ length: AUDIT_KEPT }, (_, i) => line(i + 5)),
    )
    expect(statSync(join(dir, AUDIT_FILE)).mode & 0o777).toBe(0o600)
  })

  test("a file it cannot read fails the append and keeps its lines, where a missing one reads as empty", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    const audit = auditLog({ dir: () => dir })
    await audit.append(line(1))
    chmodSync(join(dir, AUDIT_FILE), 0o000)
    try {
      await expect(audit.append(line(2))).rejects.toThrow()
    } finally {
      chmodSync(join(dir, AUDIT_FILE), 0o600)
    }
    expect(await audit.recent()).toEqual([line(1)])
  })

  test("skips a line that does not read as one", async () => {
    const dir = mkdtempSync(join(scratch, "data-"))
    const audit = auditLog({ dir: () => dir })
    await audit.append(line(1))
    await Bun.write(
      join(dir, AUDIT_FILE),
      `${await Bun.file(join(dir, AUDIT_FILE)).text()}not json\n{"at":1}\n`,
    )
    expect(await audit.recent()).toEqual([line(1)])
  })
})
