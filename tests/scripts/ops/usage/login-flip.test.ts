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
  "usage",
  "login-flip.py",
)
const scratch = mkdtempSync(join(tmpdir(), "ops-usage-login-flip-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// login-flip.py run whole under a scratch HOME at the clock given, with subprocess stubbed so no Keychain read or bun run ask runs, and beat's setting() answering ACCOUNTS as usage.accounts. Accounts go by short names (ND, LW, ...) over made-up addresses: the harness writes the stored login and every reading into the state it finds, runs it, and names the switch's target (none when no account has room), the accounts it said have no end, and the pool and split it wrote
const harness = `
import contextlib, io, json, os, re, sys, time, types
spec = json.loads(sys.argv[2])
time.time = lambda: spec["now"]
email = {k: f"{k.lower()}@example.test" for k in ("OWN", "ND", "LW", "PRIDE", "OWN2")}
name = {v: k for k, v in email.items()}
values = {"models.probe": "a-made-up-model", "usage.keychainService": "made-up-service", "usage.accounts": [dict(row, email=email[row["email"]]) for row in spec["accounts"]]}
sys.modules["beat"] = types.SimpleNamespace(OPS=os.path.expanduser("~/.playground/ops"), checkout=lambda: "/checkout", setting=lambda key: values[key])
sys.modules["subprocess"] = types.SimpleNamespace(run=lambda *a, **k: types.SimpleNamespace(returncode=1, stdout="", stderr=""))
src = open(sys.argv[1]).read()
folder = os.path.expanduser("~/.playground/ops/usage")
os.makedirs(folder, exist_ok=True)
me = spec["seen"][spec["on"]]
limits = {"five_hour": {"used_percentage": me.get("five", 0), "resets_at": me.get("fiveReset")}}
if "week" in me:
    limits["seven_day"] = {"used_percentage": me["week"], "resets_at": me.get("weekReset")}
if spec.get("probeRead"):
    json.dump({"account": email[spec["on"]], "rate_limits": limits, "source": "token/ratelimit-headers"}, open(os.path.expanduser("~/.playground/usage.json"), "w"))
else:
    json.dump({"account": email[spec["on"]], "rate_limits": limits}, open(os.path.join(folder, "stored-login.json"), "w"))
path = os.path.join(folder, "login-flip.json")
state = json.load(open(path)) if os.path.exists(path) else {}
state["seen"] = dict(state.get("seen") or {}, **{email[k]: dict({"five": 0, "at": spec["now"]}, **v) for k, v in spec["seen"].items() if k != spec["on"] or spec.get("probeRead")})
if not spec.get("keepDue"):
    state.pop("due", None)
if spec.get("factory"):
    state["factory"] = email[spec["factory"]]
json.dump(state, open(path, "w"))
out = io.StringIO()
ns = {"__name__": "__main__"}
with contextlib.redirect_stdout(out):
    exec(compile(src, sys.argv[1], "exec"), ns)
text = out.getvalue()
due = re.search(r"switch due to (\\S+)", text)
target = name[due.group(1)] if due else "none" if "no account has room" in text else None
noEnd = [name[e] for e in re.findall(r"login flip: (\\S+)'s plan ends but usage.accounts sets no end", text)]
written = json.load(open(ns["STATE"]))
pool = [dict(e, account=name[e["account"]]) for e in written["rotation"]["pool"]]
split = {name[k]: v for k, v in written["split"]["shares"].items()}
seenAt = {name[k]: v.get("at") for k, v in written["seen"].items()}
print(json.dumps({"noEnd": noEnd, "pool": pool, "seenAt": seenAt, "split": split, "target": target}))
`

const at = (iso: string) => Date.parse(iso) / 1000
const TONIGHT = at("2026-10-25T18:30:00Z")
const MON_1400 = at("2026-10-26T14:00:00Z")
const MON_1500 = at("2026-10-26T15:00:00Z")
const TUE_1000 = at("2026-10-27T10:00:00Z")
const TUE_1600 = at("2026-10-27T16:00:00Z")
const SUN_1700 = at("2026-11-01T17:00:00Z")
const LATER = at("2026-11-10T12:00:00Z")

type Reading = {
  at?: number
  five?: number
  fiveReset?: number
  limitedUntil?: number
  week?: number
  weekReset?: number
}

// usage.accounts as the owner's machine sets it, by short name: two ending accounts lead, one ends at a date not yet known, and the renewing ones name a billing day or none
const ACCOUNTS = [
  { email: "OWN", renews: 17 },
  { email: "ND", ends: "2026-11-07T18:30:00+00:00", endsFirst: true },
  { email: "LW", ends: "2026-11-06T18:30:00+00:00" },
  { email: "PRIDE", renews: null },
  { email: "OWN2", ends: null, endsFirst: true },
]

const flip = (
  on: string,
  seen: Record<string, Reading>,
  now = TONIGHT,
  home?: string,
  factory?: string,
  keepDue = false,
  probeRead = false,
) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home ?? mkdtempSync(join(scratch, "home-")),
  }
  delete env.CLAUDE_CONFIG_DIR
  const spec = JSON.stringify({ accounts: ACCOUNTS, factory, keepDue, now, on, probeRead, seen })
  const child = Bun.spawnSync(["python3", "-I", "-c", harness, script, spec], { env })
  expect(child.stderr.toString()).toBe("")
  return JSON.parse(child.stdout.toString().trim())
}

// every account at its week reset tonight, each spent unless a test says otherwise
const spent = {
  LW: { week: 100, weekReset: SUN_1700 },
  ND: { week: 100, weekReset: TUE_1000 },
  OWN: { week: 100, weekReset: MON_1500 },
  OWN2: { week: 100, weekReset: TUE_1600 },
  PRIDE: { week: 100, weekReset: MON_1400 },
}

test("every account is in the pool, the ending ones marked with their end", () => {
  expect(flip("OWN2", spent).pool).toEqual([
    { account: "OWN", ending: false, endsAt: null, renewsOn: 17 },
    { account: "ND", ending: true, endsAt: "2026-11-07T18:30:00+00:00", renewsOn: null },
    { account: "LW", ending: true, endsAt: "2026-11-06T18:30:00+00:00", renewsOn: null },
    { account: "PRIDE", ending: false, endsAt: null, renewsOn: null },
    { account: "OWN2", ending: true, endsAt: null, renewsOn: null },
  ])
})

test("nd941z@ is the target first, at 97% with 3 points left", () => {
  const seen = {
    ...spent,
    ND: { ...spent.ND, week: 97 },
    OWN: { ...spent.OWN, week: 50 },
    OWN2: { ...spent.OWN2, week: 90 },
  }
  expect(flip("OWN2", seen).target).toBe("ND")
})

test("own2@ comes next", () => {
  const seen = {
    ...spent,
    OWN: { ...spent.OWN, week: 50 },
    OWN2: { ...spent.OWN2, week: 50 },
  }
  expect(flip("PRIDE", seen).target).toBe("OWN2")
})

test("the account the factory runs on is the current one, not the stored login", () => {
  // the factory on own2@ at 100%, the stored login own@ usable: the factory moves to own@
  const toStored = { ...spent, OWN: { ...spent.OWN, week: 50 } }
  expect(flip("OWN", toStored, TONIGHT, undefined, "OWN2").target).toBe("OWN")
  // the factory already on nd941z@, usable, the stored login elsewhere: no switch
  const onFirst = {
    ...spent,
    ND: { ...spent.ND, week: 97 },
    OWN2: { ...spent.OWN2, week: 50 },
  }
  expect(flip("OWN2", onFirst, TONIGHT, undefined, "ND").target).toBeNull()
})

test("a reading missing its week keeps the last one, so no switch fires", () => {
  const home = mkdtempSync(join(scratch, "home-"))
  const seen = { ...spent, OWN: { ...spent.OWN, week: 40 } }
  expect(flip("OWN", seen, TONIGHT, home).target).toBeNull()
  expect(flip("OWN", { ...seen, OWN: { five: 10 } }, TONIGHT, home).target).toBeNull()
})

test("an ending account is spent to 100% before the switch", () => {
  const seen = { ...spent, OWN2: { ...spent.OWN2, week: 90 } }
  expect(flip("ND", { ...seen, ND: { ...spent.ND, week: 99 } }).target).toBeNull()
  expect(flip("ND", seen).target).toBe("OWN2")
})

test("a 5-hour block on nd941z@ moves to own2@, and its clearing moves back", () => {
  const blocked = { ...spent.ND, five: 85, week: 97 }
  const seen = { ...spent, OWN2: { ...spent.OWN2, week: 90 } }
  expect(flip("ND", { ...seen, ND: { ...blocked, fiveReset: TONIGHT + 3600 } }).target).toBe("OWN2")
  expect(flip("OWN2", { ...seen, ND: { ...blocked, fiveReset: TONIGHT - 60 } }).target).toBe("ND")
})

test("a block that clears before the switch, then comes back, is said again", () => {
  const home = mkdtempSync(join(scratch, "home-"))
  const seen = { ...spent, OWN2: { ...spent.OWN2, week: 90 } }
  const nd = (fiveReset: number) => ({ ...spent.ND, five: 85, fiveReset, week: 97 })
  const run = (fiveReset: number) =>
    flip("ND", { ...seen, ND: nd(fiveReset) }, TONIGHT, home, undefined, true).target
  expect(run(TONIGHT + 3600)).toBe("OWN2")
  expect(run(TONIGHT - 60)).toBeNull()
  expect(run(TONIGHT + 3600)).toBe("OWN2")
})

test("a renewing current account leaves for any usable ending one, else holds until its line", () => {
  const seen = { ...spent, OWN2: { ...spent.OWN2, week: 50 } }
  expect(flip("PRIDE", { ...seen, PRIDE: { ...spent.PRIDE, five: 85, week: 50 } }).target).toBe(
    "OWN2",
  )
  expect(flip("PRIDE", { ...seen, PRIDE: { ...spent.PRIDE, week: 50 } }).target).toBe("OWN2")
  expect(flip("PRIDE", { ...spent, PRIDE: { ...spent.PRIDE, week: 99 } }).target).toBe("none")
  expect(flip("PRIDE", { ...spent, PRIDE: { ...spent.PRIDE, week: 50 } }).target).toBeNull()
})

test("a refused account is skipped until its limit lifts", () => {
  const seen = {
    ...spent,
    ND: { ...spent.ND, limitedUntil: TONIGHT + 3600, week: 50 },
    OWN2: { ...spent.OWN2, week: 90 },
  }
  expect(flip("PRIDE", seen).target).toBe("OWN2")
})

test("nd941z@ stays in at 16:29Z on the day it ends and is out at 16:30Z, 2 hours before", () => {
  const seen = {
    ...spent,
    ND: { week: 50, weekReset: LATER },
    OWN2: { week: 50, weekReset: LATER },
  }
  expect(flip("ND", seen, at("2026-11-07T16:29:00Z")).target).toBeNull()
  expect(flip("ND", seen, at("2026-11-07T16:30:00Z")).target).toBe("OWN2")
})

test("past nd941z@ and own2@, lw@ is the next ending account", () => {
  const seen = { ...spent, LW: { ...spent.LW, week: 0 } }
  expect(flip("OWN2", seen).target).toBe("LW")
})

test("an ending account with no end is said once", () => {
  const home = mkdtempSync(join(scratch, "home-"))
  expect(flip("OWN2", spent, TONIGHT, home).noEnd).toEqual(["OWN2"])
  expect(flip("OWN2", spent, TONIGHT, home).noEnd).toEqual([])
})

test("pride@ comes up only with every ending account spent, and only with 10 week points left", () => {
  expect(flip("OWN2", { ...spent, PRIDE: { ...spent.PRIDE, week: 89 } }).target).toBe("PRIDE")
  expect(flip("OWN2", { ...spent, PRIDE: { ...spent.PRIDE, week: 90 } }).target).toBe("none")
  const seen = { ...spent, LW: { ...spent.LW, week: 99 }, PRIDE: { ...spent.PRIDE, week: 0 } }
  expect(flip("OWN2", seen).target).toBe("LW")
})

// the split, each account's share of new sessions, its week left over the hours to its deadline
// every account spent until a reset after nd941z@'s end, for the tests set in November
const spentLater = Object.fromEntries(
  Object.keys(spent).map((k) => [k, { week: 100, weekReset: LATER }]),
) as typeof spent
test("pride@ takes a share from the start while any of its week is left, beside usable ending accounts", () => {
  const seen = {
    ...spent,
    ND: { ...spent.ND, week: 50 },
    OWN2: { ...spent.OWN2, week: 50 },
    PRIDE: { ...spent.PRIDE, week: 99 },
  }
  const { split } = flip("ND", seen)
  expect(split.PRIDE).toBeGreaterThan(0)
  expect(split.ND).toBeGreaterThan(0)
  expect(split.OWN2).toBeGreaterThan(0)
  expect(split.LW).toBe(0)
  expect(flip("ND", { ...seen, PRIDE: { ...spent.PRIDE, week: 100 } }).split.PRIDE).toBe(0)
  // its 1 point over a week to its reset, beside two accounts each needing 50 points an hour, is still a share
  const urgent = { five: 0, week: 0, weekReset: TONIGHT + 2 * 3600 }
  const small = flip("ND", {
    ...spent,
    ND: urgent,
    OWN2: urgent,
    PRIDE: { week: 99, weekReset: TONIGHT + 167 * 3600 },
  }).split.PRIDE
  expect(small).toBeGreaterThan(0)
})

test("a blocked, refused or spent account takes no share, and with none usable no account does", () => {
  const seen = {
    ...spent,
    LW: { ...spent.LW, limitedUntil: TONIGHT + 3600, week: 10 },
    ND: { ...spent.ND, five: 85, fiveReset: TONIGHT + 3600, week: 10 },
    OWN2: { ...spent.OWN2, week: 10 },
  }
  const seenSplit = flip("OWN2", seen).split
  expect(seenSplit.OWN2).toBe(1)
  expect(Object.values(seenSplit).filter((share) => share !== 0)).toEqual([1])
  const spentSplit = flip("OWN2", spent).split
  expect(Object.keys(spentSplit).sort()).toEqual(Object.keys(spent).sort())
  expect(Object.values(spentSplit).every((share) => share === 0)).toBe(true)
})

test("an ending account is weighted to its end when that comes before its week reset", () => {
  // the same week left and the same reset, but nd941z@ ends in 24 hours (22 to its deadline) and own2@ runs to its reset in 110
  const now = at("2026-11-06T18:30:00Z")
  const reset = at("2026-11-11T08:30:00Z")
  const seen = {
    ...spentLater,
    ND: { week: 50, weekReset: reset },
    OWN2: { week: 50, weekReset: reset },
  }
  const { split } = flip("ND", seen, now)
  expect(split.ND / split.OWN2).toBeCloseTo(110 / 22, 1)
})

test("spent by the split, an ending account reaches 100% before its end, and pride@ keeps a share while its week lasts", () => {
  // 46 hours before nd941z@'s end, nd941z@ at 20% and pride@ at 0% until its reset in 72 hours, every other account spent; the factory spends 3.5 points an hour across them, a little over the 80/44 + 100/72 they need
  let now = at("2026-11-05T18:30:00Z")
  const end = at("2026-11-07T18:30:00Z")
  const pride = { week: 0, weekReset: at("2026-11-08T18:30:00Z") }
  const nd = { week: 20, weekReset: LATER }
  let spentAt: number | null = null
  while (now < end && spentAt === null) {
    const { split } = flip("ND", { ...spentLater, ND: nd, PRIDE: pride }, now)
    if (pride.week < 100) expect(split.PRIDE).toBeGreaterThan(0)
    nd.week = Math.min(100, nd.week + 3.5 * split.ND)
    pride.week = Math.min(100, pride.week + 3.5 * split.PRIDE)
    now += 3600
    if (nd.week >= 100) spentAt = now
  }
  expect(spentAt).not.toBeNull()
  expect(spentAt as number).toBeLessThanOrEqual(end - 2 * 3600)
})

test("with no stored login, a usage.json run.py took from an account's probe leaves that account's reading time as it was, so run.py probes it again on time", () => {
  const readAt = TONIGHT - 600
  const { seenAt } = flip(
    "ND",
    { ...spent, ND: { at: readAt, week: 40, weekReset: TUE_1000 } },
    TONIGHT,
    undefined,
    undefined,
    false,
    true,
  )
  expect(seenAt.ND).toBe(readAt)
})
