import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ops = join(import.meta.dir, "..", "..", "..", "scripts", "ops")
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "once-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const runningFor = (script: string) =>
  Bun.spawnSync(
    [
      "python3",
      "-I",
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); import once; print(once.running('ops-dashboard', once.marker_of(sys.argv[2])))",
      ops,
      script,
    ],
    {
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: scratch,
        PLAYGROUND_DATA_DIR: join(scratch, "playground"),
      },
      stdout: "pipe",
    },
  )
    .stdout.toString()
    .trim()

describe("once.py's read of a running job", () => {
  test("finds a holder running the job's folder from another checkout, and not one running another job's folder", async () => {
    const held = join(scratch, "dashboard-checkout", "scripts", "ops", "dashboard", "run.sh")
    await Bun.write(held, "sleep 30\n")
    const holder = Bun.spawn(["bash", held])
    try {
      await Bun.write(join(scratch, "playground", "ops", "ops-dashboard.pid"), `${holder.pid}\n`)
      expect(runningFor(join(scratch, "main", "scripts", "ops", "dashboard", "run.sh"))).toBe(
        String(holder.pid),
      )
      expect(runningFor(join(scratch, "main", "scripts", "ops", "fixture", "run.sh"))).toBe("None")
    } finally {
      holder.kill()
    }
  })
})
