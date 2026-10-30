import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
