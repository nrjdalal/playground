import { afterAll, expect, test } from "bun:test"
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
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
  "week-marks.py",
)
const scratch = mkdtempSync(join(tmpdir(), "ops-week-marks-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// usage.accounts as a stand-in bun on PATH answers it for the settings reader beat.py runs
const ACCOUNTS = [{ email: "login@example.test" }, { email: "spare@example.test" }]

// usage.json is read through ~/.claude/acme, a link to ~/.playground as on the Mac, and the marks and samples stay in the state folder
const setup = (
  name: string,
  week: number,
  fiveHour: number,
  accounts?: Record<string, { readAt: string; week: number; weekReset: number }>,
) => {
  const home = join(scratch, name)
  mkdirSync(join(home, ".playground", "ops", "usage"), { recursive: true })
  symlinkSync(join(script, "..", "..", "beat.py"), join(home, ".playground", "ops", "beat.py"))
  mkdirSync(join(home, "bin"))
  writeFileSync(
    join(home, "bin", "bun"),
    `#!/bin/bash\n[ "$2" = usage.accounts ] && echo '${JSON.stringify(ACCOUNTS)}'\n[ "$2" = -e ] && echo '${join(home, ".playground")}'\nexit 0\n`,
  )
  chmodSync(join(home, "bin", "bun"), 0o755)
  const now = Date.now() / 1000
  writeFileSync(
    join(home, ".playground", "usage.json"),
    JSON.stringify({
      account: "login@example.test",
      ...(accounts && { accounts }),
      rate_limits: {
        five_hour: { resets_at: now + 3600, used_percentage: fiveHour },
        seven_day: { resets_at: now + 86400, used_percentage: week },
      },
    }),
  )
  return home
}

const samples = (home: string, file: string) => join(home, ".playground", "ops", "usage", file)

// One sample per account half an hour back, half a point lower, so each account reads 1%/h; the logged-in account's go to week-samples.jsonl, the others' to account-samples.jsonl
const history = (home: string, accounts: [string, number, number][]) => {
  const t = Date.now() / 1000 - 1800
  for (const [account, week, reset] of accounts)
    appendFileSync(
      samples(
        home,
        account === "login@example.test" ? "week-samples.jsonl" : "account-samples.jsonl",
      ),
      `${JSON.stringify({ account, reset, t, week: week - 0.5 })}\n`,
    )
}

const iso = (t: number) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")

const status = (home: string) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PATH: `${join(home, "bin")}:${process.env.PATH}`,
  }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawnSync(["python3", "-I", script], { env })
  expect(child.exitCode).toBe(0)
  return child.stdout.toString().split("\n")[0]
}

const alerts = (home: string) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PATH: `${join(home, "bin")}:${process.env.PATH}`,
  }
  delete env.CLAUDE_CONFIG_DIR
  const child = Bun.spawnSync(["python3", "-I", script], { env })
  expect(child.exitCode).toBe(0)
  return child.stdout
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("ALERT"))
    .map((line) => line.split(" ").slice(0, 2).join(" "))
}

test("a week past 90% and a 5-hour window past 85% each alert once", () => {
  const home = setup("high", 91, 86)
  expect(alerts(home)).toEqual(["ALERT 90", "ALERT 5h"])
  expect(alerts(home)).toEqual([])
})

// the owner's drain order: every account is used to 100%, where Bravo switches, so no mark parks or stops work
test("the 97% and 98% alerts say nothing parks and Bravo switches at 100%", () => {
  const home = setup("drain", 99, 20)
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PATH: `${join(home, "bin")}:${process.env.PATH}`,
  }
  delete env.CLAUDE_CONFIG_DIR
  const out = Bun.spawnSync(["python3", "-I", script], { env }).stdout.toString()
  const lines = out.split("\n").filter((line) => /^ALERT 9[78] /.test(line))
  expect(lines).toHaveLength(2)
  for (const line of lines) {
    expect(line).toContain("nothing parks: at 100% Bravo switches the factory to the next account")
    expect(line).not.toMatch(/push WIP|stops now/)
  }
})

test("a reading under every mark alerts nothing", () => {
  expect(alerts(setup("low", 40, 20))).toEqual([])
})

test("the factory's accounts at 1%/h each read 2%/h combined", () => {
  const now = Date.now() / 1000
  const home = setup("two", 50, 20, {
    "spare@example.test": { readAt: iso(now), week: 30, weekReset: now + 172800 },
    "login@example.test": { readAt: iso(now), week: 50, weekReset: now + 86400 },
  })
  history(home, [
    ["login@example.test", 50, now + 86400],
    ["spare@example.test", 30, now + 172800],
  ])
  const line = status(home)
  expect(line).toContain("rate 1.0%/h")
  expect(line).toContain("; combined 2.0%/h across 2 accounts")
  const accounts = (file: string) =>
    [...readFileSync(samples(home, file), "utf8").matchAll(/"account": "([^"]+)"/g)].map(
      (m) => m[1],
    )
  expect(new Set(accounts("week-samples.jsonl"))).toEqual(new Set(["login@example.test"]))
  expect(new Set(accounts("account-samples.jsonl"))).toEqual(new Set(["spare@example.test"]))
})

test("the spare account logged in counts as a factory account", () => {
  const home = setup("nd941z", 50, 20)
  const usage = join(home, ".playground", "usage.json")
  writeFileSync(
    usage,
    readFileSync(usage, "utf8").replace("login@example.test", "spare@example.test"),
  )
  expect(status(home)).toStartWith("spare@example.test: week 50%")
})

test("one account alone reads as before, with no combined pace", () => {
  const now = Date.now() / 1000
  const home = setup("one", 50, 20)
  history(home, [["login@example.test", 50, now + 86400]])
  const line = status(home)
  expect(line).toContain("rate 1.0%/h")
  expect(line).not.toContain("combined")
})

test("an account usage.accounts does not list counts nothing", () => {
  const home = setup("other", 95, 90)
  const usage = join(home, ".playground", "usage.json")
  writeFileSync(
    usage,
    readFileSync(usage, "utf8").replace("login@example.test", "other@example.test"),
  )
  expect(status(home)).toStartWith("other@example.test: not a factory account; nothing counted")
})
