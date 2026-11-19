import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
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

// a job's herdr pane closes the moment its job exits (measured on a scratch herdr server), so once.py keeps the job's last stderr line in ops/<job>.last for ops-up (PG-2878)
describe("once.py's last stderr line", () => {
  const data = join(scratch, "last")
  const opsDir = join(data, "ops")
  const once = (job: string, command: string) =>
    Bun.spawn(["python3", "-I", join(ops, "once.py"), job, command], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: scratch, PLAYGROUND_DATA_DIR: data },
      stderr: "pipe",
      stdout: "pipe",
    })
  const readerPid = async (job: string) => {
    for (let i = 0; i < 50 && !existsSync(join(opsDir, `${job}.reader`)); i++) await Bun.sleep(100)
    return Number(readFileSync(join(opsDir, `${job}.reader`), "utf8").trim())
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const gone = async (pid: number) => {
    for (let i = 0; i < 50 && alive(pid); i++) await Bun.sleep(100)
    return !alive(pid)
  }

  test("a job that dies leaves its last non-empty stderr line, cut to 200 characters, in a 0600 file, its stderr still reaching the pane", async () => {
    await Bun.write(join(opsDir, "keep"), "")
    const long = "x".repeat(300)
    const job = once(
      "ops-t1",
      `sh -c 'echo first >&2; echo "vault: cache unreadable: ${long}" >&2; echo >&2; exit 2'`,
    )
    expect(await job.exited).toBe(2)
    expect(await gone(await readerPid("ops-t1"))).toBe(true)
    const last = readFileSync(join(opsDir, "ops-t1.last"), "utf8")
    expect(last).toBe(`vault: cache unreadable: ${long}`.slice(0, 200))
    expect(statSync(join(opsDir, "ops-t1.last")).mode & 0o777).toBe(0o600)
    expect(await new Response(job.stderr).text()).toContain("vault: cache unreadable:")
  })

  test("the reader, by its own pid, ends once the job has, and never outlives it", async () => {
    const job = once("ops-t2", "sh -c 'sleep 1; echo bye >&2'")
    const reader = await readerPid("ops-t2")
    expect(alive(reader)).toBe(true)
    expect(await job.exited).toBe(0)
    expect(await gone(reader)).toBe(true)
  })

  test("a reader that dies leaves the job running: its stderr writes neither block nor kill it", async () => {
    const job = once(
      "ops-t3",
      "sh -c 'sleep 1; i=0; while [ $i -lt 3000 ]; do echo line-$i >&2; i=$((i+1)); done; echo done'",
    )
    process.kill(await readerPid("ops-t3"), "SIGKILL")
    expect(await job.exited).toBe(0)
    expect(await new Response(job.stdout).text()).toBe("done\n")
  })

  test("a start drops the last copy's line, so a stale one never stands for this copy", async () => {
    await Bun.write(join(opsDir, "ops-t4.last"), "an old line from yesterday")
    const job = once("ops-t4", "sh -c 'exit 0'")
    expect(await job.exited).toBe(0)
    await gone(await readerPid("ops-t4"))
    expect(existsSync(join(opsDir, "ops-t4.last"))).toBe(false)
  })
})
