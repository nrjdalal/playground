import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "ops",
  "dashboard",
  "watch-stuck.py",
)
const scratch = mkdtempSync(join(tmpdir(), "watch-stuck-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The watcher's own helpers, loaded from its file without running its loop, with `docker ps` stubbed.
const alerts = async (rows: string[][], state: object): Promise<unknown> => {
  const code = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("watch_stuck", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.containers = lambda: json.loads(sys.argv[2])
state = json.loads(sys.argv[3])
print(json.dumps([[a["kind"], a["name"], a["exposed"]] for a in mod.docker_alerts(state)] + [state]))`
  const proc = Bun.spawn(
    ["python3", "-I", "-c", code, script, JSON.stringify(rows), JSON.stringify(state)],
    { env: { ...process.env, CLAUDE_CONFIG_DIR: scratch }, stderr: "pipe", stdout: "pipe" },
  )
  const out = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  return JSON.parse(out)
}

// a stuck session's alert comes from its own hook, so the watch keeps the off-loopback Docker check alone.
test("a container publishing a port off loopback alerts once; one on loopback never", async () => {
  const rows = [
    ["c1", "playground-x-db", "0.0.0.0:5432->5432/tcp"],
    ["c2", "playground-y-db", "127.0.0.1:55001->5432/tcp"],
  ]
  expect(await alerts(rows, {})).toEqual([
    ["docker", "playground-x-db", ["0.0.0.0:5432->5432/tcp"]],
    { exposed: ["c1|0.0.0.0:5432->5432/tcp"] },
  ])
  expect(await alerts(rows, { exposed: ["c1|0.0.0.0:5432->5432/tcp"] })).toEqual([
    { exposed: ["c1|0.0.0.0:5432->5432/tcp"] },
  ])
})
