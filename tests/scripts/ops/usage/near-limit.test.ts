import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "../../../../scripts/ops/usage/near-limit.py")
const scratch = mkdtempSync(join(tmpdir(), "near-limit-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// near-limit.py whole, under a scratch HOME: a stand-in beat module gives its settings and swaps urllib's urlopen for an answer with a week and no 5-hour headers, so no call leaves the Mac; a stand-in `security` holds the Keychain
test("a probe answered with no 5-hour headers writes the account's five as none in login-flip.json, never 0%", async () => {
  const ops = join(scratch, ".playground", "ops")
  const stubs = join(scratch, "stubs")
  mkdirSync(join(ops, "usage"), { recursive: true })
  mkdirSync(stubs, { recursive: true })
  const settings = {
    "models.probe": "a-made-up-model",
    "usage.accounts": [{ email: "watched@example.org", nearLimit: true, provider: "claude" }],
    "usage.keychainService": "made-up-service",
  }
  writeFileSync(
    join(ops, "beat.py"),
    `
import io, json, os, urllib.error, urllib.request
OPS = os.path.dirname(os.path.abspath(__file__))
def urlopen(req, timeout=None):
    raise urllib.error.HTTPError(req.full_url, 200, "ok", {"anthropic-ratelimit-unified-7d-utilization": "0.3", "anthropic-ratelimit-unified-7d-reset": "4000000000"}, io.BytesIO(b"{}"))
urllib.request.urlopen = urlopen
def setting(key):
    return json.loads(${JSON.stringify(JSON.stringify(settings))})[key]
`,
  )
  writeFileSync(
    join(scratch, ".playground", "usage.json"),
    JSON.stringify({ account: "stored@example.org", rate_limits: {} }),
  )
  writeFileSync(join(stubs, "security"), "#!/bin/sh\necho made-up-token\n", { mode: 0o755 })
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: scratch,
    PATH: `${stubs}:${process.env.PATH}`,
  }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawn(["python3", "-I", script], { env, stderr: "pipe", stdout: "pipe" })
  const [err] = await Promise.all([new Response(child.stderr).text(), child.exited])
  expect(err).toBe("")
  const seen = JSON.parse(readFileSync(join(ops, "usage", "login-flip.json"), "utf8")).seen
  expect(seen["watched@example.org"]).toMatchObject({ five: null, fiveReset: null, week: 30 })
})
