import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const PTABLE = join(import.meta.dir, "../../../scripts/ops/ptable.py")
const ptable = (...args: string[]) =>
  Bun.spawnSync(["python3", "-I", PTABLE, ...args]).stdout.toString()

// the kernel's process table is read through macOS's sysctl kern.proc, so these run on a Mac alone
describe.skipIf(process.platform !== "darwin")(
  "ptable.py reads the kernel's process table, as Claude Code's sandbox lets it",
  () => {
    test("started gives a running pid's start as ps's lstart does, and nothing for one that has gone", async () => {
      const gone = Bun.spawn(["true"])
      await gone.exited
      const lstart = Bun.spawnSync(["ps", "-o", "pid=,lstart=", "-p", String(process.pid)], {
        env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      })
        .stdout.toString()
        .trim()
        .split(/\s+/)
        .join(" ")
      expect(ptable("started", String(process.pid), String(gone.pid))).toBe(`${lstart}\n`)
    })

    test("group lists each member of a process group with its command", () => {
      const out = Bun.spawnSync([
        "python3",
        "-I",
        "-c",
        "import os, subprocess, sys; os.setsid(); print(subprocess.run([sys.executable, '-I', sys.argv[1], 'group', str(os.getpid())], capture_output=True, text=True).stdout, end='')",
        PTABLE,
      ]).stdout.toString()
      expect(out.split("\n").filter(Boolean).length).toBe(2)
      expect(out).toMatch(/^\d+ [Pp]ython/m)
    })
  },
)
