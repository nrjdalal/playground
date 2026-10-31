import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "..", "..", "..", "..", "scripts", "ops", "usage", "run.py")
const scratch = mkdtempSync(join(tmpdir(), "ops-usage-run-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// run.py's functions, loaded without its loop, with beat and the Keychain probe stubbed, under a scratch HOME as tests/test_ops_merge_train.py does
const harness = `
import json, os, sys, time, types
sys.modules["beat"] = types.SimpleNamespace(beat=lambda *a, **k: None, setting=lambda key: {"models.probe": "a-made-up-model", "usage.accounts": [], "usage.keychainService": "made-up-service"}[key])
src = open(sys.argv[1]).read()
ns = {"__name__": "run_under_test"}
exec(compile(src[: src.index("\\nwhile True:")], sys.argv[1], "exec"), ns)
calls = []
ns["probe"] = lambda e: calls.append(e) or {"five": 10, "fiveReset": time.time() + 3600, "week": 40 if e == "spare@example.org" else 50, "weekReset": time.time() + 86400}
factory = ns["factory_reading"]({"account": "mine@example.org", "rate_limits": {}}, ns["flip_file"]())
accounts = ns["accounts_reading"]()
print(json.dumps({"accounts": {k: v["week"] for k, v in accounts.items()}, "factory": factory and factory["account"], "keys": sorted(json.load(open(ns["FLIP"]))), "probes": calls, "rotation": ns["rotation"](ns["flip_file"]())}))
line = {}
try:
    folder = os.path.dirname(os.path.dirname(os.path.dirname(ns["FLIP"])))
    ns["write_stored"]({"account": "stored@example.org", "rate_limits": {"five_hour": {"used_percentage": 10, "resets_at": 123}, "seven_day": {"used_percentage": 97, "resets_at": 456}}, "source": "oauth/usage", "writtenAt": "2026-10-24T01:00:00Z"})
    ns["write_stored"]({"account": None})
    line = {"stored": json.load(open(os.path.join(folder, "usage-stored.json"))), "noNone": not os.path.exists(os.path.join(folder, "usage-None.json"))}
except Exception as e:
    line = {"error": str(e)}
print(json.dumps(line))
`

const runRaw = (name: string, flip: object) => {
  const home = join(scratch, name)
  const folder = join(home, ".playground", "ops", "usage")
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "login-flip.json"), JSON.stringify(flip))
  const env: Record<string, string | undefined> = { ...process.env, HOME: home }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawnSync(["python3", "-I", "-c", harness, script], { env })
  expect(child.stderr.toString()).toBe("")
  return child.stdout.toString().trim().split("\n")
}

const run = (name: string, flip: object) => JSON.parse(runRaw(name, flip)[0]!)

const stale = { at: 0, week: 1 }

test("each account in `accounts` is probed once a cycle, the factory's shared with its own reading", () => {
  expect(
    run("two", {
      accounts: ["main@example.org", "spare@example.org"],
      due: "x",
      factory: "main@example.org",
      seen: { "spare@example.org": stale, "main@example.org": stale },
    }),
  ).toEqual({
    accounts: { "spare@example.org": 40, "main@example.org": 50 },
    factory: "main@example.org",
    keys: ["accounts", "due", "factory", "seen"],
    probes: ["main@example.org", "spare@example.org"],
    rotation: null,
  })
})

test("with no `accounts`, only the factory is probed, as before", () => {
  expect(run("one", { factory: "main@example.org", seen: {} })).toEqual({
    accounts: {},
    factory: "main@example.org",
    keys: ["factory", "seen"],
    probes: ["main@example.org"],
    rotation: null,
  })
})

test("login-flip.json's rotation is what usage.json's `rotation` copies, and any other shape is none", () => {
  const flip = { factory: "main@example.org", seen: {} }
  const pool = [
    {
      account: "main@example.org",
      ending: true,
      endsAt: "2026-11-07T18:30:00+00:00",
      renewsOn: null,
    },
    { account: "spare@example.org", ending: false, endsAt: null, renewsOn: 3 },
  ]
  expect(run("rotation", { ...flip, rotation: { pool } }).rotation).toEqual({ pool })
  expect(
    run("rotation-day", { ...flip, rotation: { pool: [{ ...pool[1], renewsOn: "3" }] } }).rotation,
  ).toBeNull()
  expect(
    run("rotation-day-range", { ...flip, rotation: { pool: [{ ...pool[1], renewsOn: 32 }] } })
      .rotation,
  ).toBeNull()
  expect(
    run("rotation-list", { ...flip, rotation: { pool: ["main@example.org"] } }).rotation,
  ).toBeNull()
  expect(
    run("rotation-bad", { ...flip, rotation: { pool: [{ account: "a", ending: 1 }] } }).rotation,
  ).toBeNull()
})

test("the stored login's reading lands in usage-<local part>.json beside usage.json, and an account of none writes none", () => {
  expect(
    JSON.parse(runRaw("stored", { factory: "main@example.org", seen: {} })[1] ?? "{}"),
  ).toEqual({
    stored: {
      account: "stored@example.org",
      rate_limits: {
        five_hour: { used_percentage: 10, resets_at: 123 },
        seven_day: { used_percentage: 97, resets_at: 456 },
      },
      source: "oauth/usage",
      writtenAt: "2026-10-24T01:00:00Z",
    },
    noNone: true,
  })
})

test("PLAYGROUND_USAGE_API moves the stored login's reads to its own answers, as the new-user gate's box gives them", () => {
  const api = join(scratch, "api")
  mkdirSync(api, { recursive: true })
  writeFileSync(join(api, "profile"), JSON.stringify({ account: { email: "gate@example.com" } }))
  writeFileSync(
    join(api, "usage"),
    JSON.stringify({ seven_day: { resets_at: "2026-11-05T00:00:00+00:00", utilization: 10 } }),
  )
  const read = `
import json, sys, types
sys.modules["beat"] = types.SimpleNamespace(beat=lambda *a, **k: None, setting=lambda key: "made-up")
src = open(sys.argv[1]).read()
ns = {"__name__": "run_under_test"}
exec(compile(src[: src.index("\\nwhile True:")], sys.argv[1], "exec"), ns)
ns["oauth"] = lambda: {"accessToken": "made-up", "expiresAt": 4102444800000}
print(json.dumps(ns["stored_login"]()))
`
  const home = join(scratch, "api-home")
  mkdirSync(join(home, ".playground", "ops", "usage"), { recursive: true })
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PLAYGROUND_USAGE_API: `file://${api}`,
  }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawnSync(["python3", "-I", "-c", read, script], { env })
  expect(child.stderr.toString()).toBe("")
  expect(JSON.parse(child.stdout.toString())).toMatchObject({
    account: "gate@example.com",
    rate_limits: { seven_day: { resets_at: 1793836800, used_percentage: 10 } },
  })
})

// run.py whole, for one cycle, under a scratch HOME: a stand-in beat module in its ops folder records the beat and ends the run, and swaps urllib's urlopen for made-up answers, so no call leaves the Mac; a stand-in `security` holds the Keychain
const beatModule = (settings: object) => `
import io, json, os, sys, urllib.error, urllib.request
calls = []
def urlopen(req, timeout=None):
    url = req.full_url
    calls.append(url)
    if url.startswith("http://127.0.0.1:9/"):
        five = {} if "/no-5h/" in url else {"anthropic-ratelimit-unified-5h-utilization": "0.2", "anthropic-ratelimit-unified-5h-reset": "4000000000"}
        raise urllib.error.HTTPError(url, 200, "ok", dict(five, **{"anthropic-ratelimit-unified-7d-utilization": "0.3", "anthropic-ratelimit-unified-7d-reset": "4000000000"}), io.BytesIO(b"{}"))
    if url.endswith("/api/oauth/profile"):
        return io.BytesIO(json.dumps({"account": {"email": "stored@example.org"}}).encode())
    if url.endswith("/api/oauth/usage"):
        return io.BytesIO(json.dumps({"seven_day": {"utilization": 70, "resets_at": "2026-11-07T00:00:00+00:00"}}).encode())
    raise OSError("no made-up answer for " + url)
urllib.request.urlopen = urlopen
def setting(key):
    return ${JSON.stringify(settings)}[key]
def beat(job, pid, started, cycle, result, extra=None):
    json.dump({"calls": calls, "detail": (extra or {}).get("detail"), "result": result}, open(os.path.join(os.path.dirname(__file__), "beat.json"), "w"))
    os._exit(0)
`

const cycle = async (
  name: string,
  opts: {
    added: string[]
    factory?: string
    login: boolean
    loginExit?: number
    probeUrl?: string
  },
) => {
  const home = join(scratch, name)
  const ops = join(home, ".playground", "ops")
  const stubs = join(home, "stubs")
  mkdirSync(join(ops, "usage"), { recursive: true })
  mkdirSync(stubs, { recursive: true })
  const settings = {
    "models.probe": "a-made-up-model",
    "usage.accounts": [
      ...opts.added.map((email) => ({ email, provider: "claude" })),
      { email: "glm-key", provider: "glm" },
    ],
    "usage.keychainService": "made-up-service",
  }
  writeFileSync(join(ops, "beat.py"), beatModule(settings))
  if (opts.factory)
    writeFileSync(join(ops, "usage", "login-flip.json"), JSON.stringify({ factory: opts.factory }))
  const login = JSON.stringify({
    claudeAiOauth: { accessToken: "made-up", expiresAt: 4_000_000_000_000 },
  })
  writeFileSync(
    join(stubs, "security"),
    `#!/bin/sh\ncase "$*" in\n  *Claude\\ Code-credentials*) ${opts.login ? `echo '${login}'` : `exit ${opts.loginExit ?? 44}`} ;;\n  *made-up-service*) echo made-up-token ;;\n  *) exit 44 ;;\nesac\n`,
    { mode: 0o755 },
  )
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PATH: `${stubs}:${process.env.PATH}`,
    PLAYGROUND_PROBE_URL: opts.probeUrl ?? "http://127.0.0.1:9/v1/messages",
  }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawn(["python3", "-I", script], { env, stderr: "pipe" })
  await child.exited
  expect(await new Response(child.stderr).text()).toBe("")
  const read = (path: string) => {
    try {
      return JSON.parse(readFileSync(join(home, ".playground", path), "utf8"))
    } catch {
      return null
    }
  }
  return { beat: read("ops/beat.json"), usage: read("usage.json") }
}

test("on a fresh install whose only account came through the Dashboard, usage.json holds that account's week and the job reads ok", async () => {
  const { beat, usage } = await cycle("added-only", { added: ["added@example.org"], login: false })
  expect(beat.result).toBe("ok")
  expect(beat.calls).toEqual(["http://127.0.0.1:9/v1/messages"])
  expect(usage.account).toBe("added@example.org")
  expect(usage.rate_limits.seven_day).toEqual({ used_percentage: 30, resets_at: 4_000_000_000 })
})

test("with both a Dashboard account and Claude Code's own login, usage.json holds the Dashboard account's, the login named beside it", async () => {
  const { beat, usage } = await cycle("both", { added: ["added@example.org"], login: true })
  expect(beat.result).toBe("ok")
  expect(usage.account).toBe("added@example.org")
  expect(usage.storedLogin).toEqual({ account: "stored@example.org", week: 70 })
})

test("when the Dashboard account's probe is refused, usage.json holds Claude Code's own login and the job still reads ok", async () => {
  const { beat, usage } = await cycle("refused", {
    added: ["added@example.org"],
    login: true,
    probeUrl: "http://127.0.0.1:8/v1/messages",
  })
  expect(beat.result).toBe("ok")
  expect(beat.detail).toContain("added account: RuntimeError: no reading of added@example.org")
  expect(usage.account).toBe("stored@example.org")
})

test("with Claude Code's own login alone, usage.json holds its reading, as before", async () => {
  const { beat, usage } = await cycle("login-only", { added: [], login: true })
  expect(beat.result).toBe("ok")
  expect(usage.account).toBe("stored@example.org")
})

test("with no account at all, the job beats waiting, not an error, and writes no usage.json", async () => {
  const { beat, usage } = await cycle("none", { added: [], login: false })
  expect(beat.result).toBe("waiting: no Claude account yet; add one in the Dashboard")
  expect(usage).toBeNull()
})

test("while login-flip names the stored login as the factory, usage.json follows that login and no added account is probed", async () => {
  const { beat, usage } = await cycle("factory-is-stored", {
    added: ["added@example.org"],
    factory: "stored@example.org",
    login: true,
  })
  expect(beat.result).toBe("ok")
  expect(beat.calls).not.toContain("http://127.0.0.1:9/v1/messages")
  expect(usage.account).toBe("stored@example.org")
})

test("a Keychain that refuses the read, not one missing the login, fails rather than waits", async () => {
  const { beat } = await cycle("locked", { added: [], login: false, loginExit: 51 })
  expect(beat.result).toBe(
    "error: stored login: RuntimeError: security exited 51 reading Claude Code's credentials",
  )
})

test("an account whose probe answers with no 5-hour headers has no 5-hour window in usage.json, never a 0% one (#85)", async () => {
  const { beat, usage } = await cycle("no-five-hour", {
    added: ["added@example.org"],
    login: false,
    probeUrl: "http://127.0.0.1:9/no-5h/v1/messages",
  })
  expect(beat.result).toBe("ok")
  expect(usage.rate_limits.five_hour).toBeUndefined()
  expect(usage.rate_limits.seven_day).toEqual({ used_percentage: 30, resets_at: 4_000_000_000 })
  expect(beat.detail).toStartWith("added@example.org: 5h none, 7d 30%")
})

// #152: alerts-usage.json carries a week alert for each factory account past a mark, the spares in usage.json's `accounts` included, each naming its account
test("week alerts name each factory account past a mark, a spare's included, and skip an account outside usage.accounts (#152)", () => {
  const home = join(scratch, "week-alerts")
  mkdirSync(join(home, ".playground", "ops", "usage"), { recursive: true })
  const read = `
import json, sys, types
sys.modules["beat"] = types.SimpleNamespace(beat=lambda *a, **k: None, setting=lambda key: "made-up")
src = open(sys.argv[1]).read()
ns = {"__name__": "run_under_test"}
exec(compile(src[: src.index("\\nwhile True:")], sys.argv[1], "exec"), ns)
data = {"account": "login@example.org", "rate_limits": {"seven_day": {"used_percentage": 50}}, "writtenAt": "2026-10-31T13:00:00Z",
        "accounts": {"login@example.org": {"week": 50}, "spare@example.org": {"week": 97.5}, "other@example.org": {"week": 99}}}
print(json.dumps([a["line"] for a in ns["week_alerts"](data, ["login@example.org", "spare@example.org"])]))
`
  const env: Record<string, string | undefined> = { ...process.env, HOME: home }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawnSync(["python3", "-I", "-c", read, script], { env })
  expect(child.stderr.toString()).toBe("")
  expect(JSON.parse(child.stdout.toString())).toEqual([
    "week usage at 97.5% (spare@example.org), past 97%",
  ])
})
