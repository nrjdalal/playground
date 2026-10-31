import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { refresh, type Shard } from "../../../../packages/scripts/src/test-timings"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/test-timings.ts")
const all = () => true

describe("refresh", () => {
  test("a shard's own files take its fresh timing, and a file no shard timed keeps its old one", () => {
    const base = { "tests/a.test.ts": 100, "tests/b.test.ts": 200, "tests/serial.test.ts": 50 }
    const shards: Shard[] = [
      {
        files: ["./tests/a.test.ts", "./tests/serial.test.ts"],
        timings: { "tests/a.test.ts": 140, "tests/b.test.ts": 999 },
      },
      { files: ["./tests/b.test.ts"], timings: { "tests/b.test.ts": 210 } },
    ]
    expect(refresh(base, shards, all)).toEqual({
      "tests/a.test.ts": 140,
      "tests/b.test.ts": 210,
      "tests/serial.test.ts": 50,
    })
  })

  test("a file new to the suite gains its timing, and a file that is gone drops", () => {
    const base = { "tests/gone.test.ts": 300, "tests/kept.test.ts": 10 }
    const shards = [{ files: ["./tests/new.test.ts"], timings: { "tests/new.test.ts": 70 } }]
    const exists = (file: string) => file !== "tests/gone.test.ts"
    expect(refresh(base, shards, exists)).toEqual({
      "tests/new.test.ts": 70,
      "tests/kept.test.ts": 10,
    })
  })

  test("a timing that is not a finite count of milliseconds is left out, so the seed's stands", () => {
    const shards = [
      {
        files: ["./tests/a.test.ts", "./tests/b.test.ts", "./tests/c.test.ts"],
        timings: { "tests/a.test.ts": -1, "tests/b.test.ts": "9", "tests/c.test.ts": Infinity },
      },
    ]
    const base = { "tests/a.test.ts": 4, "tests/b.test.ts": 5 }
    expect(refresh(base, shards as never, all)).toEqual({
      "tests/b.test.ts": 5,
      "tests/a.test.ts": 4,
    })
  })

  test("the result runs slowest first, a tie A to Z, as bun writes it", () => {
    const shards = [
      {
        files: ["./tests/c.test.ts", "./tests/b.test.ts", "./tests/a.test.ts"],
        timings: { "tests/a.test.ts": 5, "tests/b.test.ts": 9, "tests/c.test.ts": 5 },
      },
    ]
    expect(Object.keys(refresh({}, shards, all))).toEqual([
      "tests/b.test.ts",
      "tests/a.test.ts",
      "tests/c.test.ts",
    ])
  })
})

describe("test-timings.ts <dir>", () => {
  test("rewrites tests/timings.json from each shard folder's timings.json and shard-files", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-timings-"))
    try {
      await mkdir(join(root, "tests"))
      await Bun.write(join(root, "tests/a.test.ts"), "")
      await Bun.write(join(root, "tests/b.test.ts"), "")
      await Bun.write(
        join(root, "tests/timings.json"),
        JSON.stringify({ version: 1, files: { "tests/a.test.ts": 1, "tests/gone.test.ts": 2 } }),
      )
      for (const [n, file, ms] of [
        ["1", "tests/a.test.ts", 40],
        ["2", "tests/b.test.ts", 60],
      ] as const) {
        await Bun.write(join(root, `shards/timings-${n}/shard-files`), `./${file}\n`)
        await Bun.write(
          join(root, `shards/timings-${n}/timings.json`),
          JSON.stringify({ version: 1, files: { [file]: ms } }),
        )
      }
      const run = Bun.spawnSync(["bun", SCRIPT, "shards"], { cwd: root, stderr: "pipe" })
      expect(run.exitCode).toBe(0)
      expect(await Bun.file(join(root, "tests/timings.json")).text()).toBe(
        `${JSON.stringify({ version: 1, files: { "tests/b.test.ts": 60, "tests/a.test.ts": 40 } }, null, 2)}\n`,
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test("with no shard to read, it keeps the committed tests/timings.json and says so", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-timings-"))
    try {
      const seed = JSON.stringify({ version: 1, files: { "tests/a.test.ts": 1 } })
      await Bun.write(join(root, "tests/timings.json"), seed)
      await mkdir(join(root, "empty"))
      for (const dir of ["empty", "missing"]) {
        const run = Bun.spawnSync(["bun", SCRIPT, dir], { cwd: root, stderr: "pipe" })
        expect(run.exitCode).toBe(0)
        expect(run.stderr.toString()).toContain("keeps the committed timings")
        expect(await Bun.file(join(root, "tests/timings.json")).text()).toBe(seed)
      }
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
