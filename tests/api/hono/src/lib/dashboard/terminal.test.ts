import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"

// A cmux on PATH that logs each call and answers read-screen with a screen of its own.
const FAKE_CMUX = `#!/usr/bin/env bun
const { appendFileSync } = await import("node:fs")
const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_CMUX_LOG, args.join(" ") + "\\n")
if (args[0] === "read-screen") console.log("cmux screen")
else process.exit(1)
`

describe.skipIf(onLiveDashboard())("readScreen", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-terminal-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  test("a herdr surface reads its pane through herdr's socket, and any other surface through cmux's read-screen", async () => {
    const bin = join(dir, "bin")
    mkdirSync(bin)
    writeFileSync(join(bin, "cmux"), FAKE_CMUX)
    chmodSync(join(bin, "cmux"), 0o755)
    const log = join(dir, "cmux.log")
    writeFileSync(log, "")
    const { code, result, stderr } = await inFixture(
      `const { join } = await import("node:path")
const { readScreen } = await import(\`\${API}/lib/dashboard/terminal\`)
const seen = []
const pane = { agent_status: "idle", focused: true, pane_id: "w1:p1", revision: 1, scroll: { offset_from_bottom: 0 }, tab_id: "w1:t1", terminal_id: "t-1", workspace_id: "w1" }
Bun.listen({ unix: join(process.env.PLAYGROUND_HERDR_DIR, "s.sock"), socket: { data(conn, chunk) {
  const req = JSON.parse(new TextDecoder().decode(chunk).split("\\n")[0])
  seen.push([req.method, req.params])
  const result = req.method === "pane.get" ? { pane } : { read: { text: "herdr screen" }, type: "pane_read" }
  conn.write(JSON.stringify({ id: req.id, result }) + "\\n")
  conn.end()
} } })
const herdr = await readScreen("herdr:s:w1:p1", 40)
const cmux = await readScreen("surface:7", 40)
console.log(JSON.stringify({ cmux, herdr, seen }))
process.exit(0)`,
      dir,
      {
        CLAUDE_CONFIG_DIR: join(dir, "config"),
        PLAYGROUND_HERDR_DIR: dir,
        PLAYGROUND_HERDR_SESSIONS: "s",
        PLAYGROUND_LIVE_READS: "1",
        FAKE_CMUX_LOG: log,
        PATH: `${bin}:${process.env.PATH}`,
      },
    )
    expect(stderr).not.toContain("error:")
    expect(code).toBe(0)
    expect(result).toEqual({
      cmux: "cmux screen\n",
      herdr: "herdr screen",
      seen: [
        ["pane.get", { pane_id: "w1:p1" }],
        ["pane.read", { lines: 40, pane_id: "w1:p1", source: "visible" }],
      ],
    })
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "read-screen --surface surface:7 --lines 40",
    ])
  }, 60_000)
})
