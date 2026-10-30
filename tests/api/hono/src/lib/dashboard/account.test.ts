import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import {
  accountFor,
  accountOf,
  claudeConfigFile,
  loginOf,
  readAccount,
} from "../../../../../../api/hono/src/lib/dashboard/account"

const TOKEN = "sk-ant-oat01-SECRET"

// A config shaped as Claude Code writes it, with token-shaped fields beside the account.
const config = (oauthAccount: Record<string, unknown> | undefined) =>
  JSON.stringify({
    oauthAccount,
    primaryApiKey: TOKEN,
    userID: "u-1",
    projects: { "/repo": { lastSessionId: "s-1" } },
  })

describe("accountOf", () => {
  test("picks the email and display name alone, so no token-shaped field reaches the report", () => {
    const account = accountOf(
      config({
        accessToken: TOKEN,
        accountUuid: "a-1",
        displayName: "Merritt",
        emailAddress: "merritt@example.com",
        organizationName: "Acme",
        refreshToken: TOKEN,
      }),
    )
    expect(account).toEqual({ email: "merritt@example.com", name: "Merritt" })
    expect(JSON.stringify(account)).not.toContain(TOKEN)
  })

  test("a missing or blank display name is no name", () => {
    expect(accountOf(config({ emailAddress: "merritt@example.com" }))).toEqual({
      email: "merritt@example.com",
      name: null,
    })
    expect(accountOf(config({ displayName: "  ", emailAddress: "merritt@example.com" }))).toEqual({
      email: "merritt@example.com",
      name: null,
    })
  })

  test("no account, no email, a malformed email or a file that is not JSON is none", () => {
    expect(accountOf(config(undefined))).toBeNull()
    expect(accountOf(config({ displayName: "Merritt" }))).toBeNull()
    expect(accountOf(config({ emailAddress: "not an email" }))).toBeNull()
    expect(accountOf("{")).toBeNull()
  })
})

// usage.json as the ops-usage job writes it: the windows, when it was written, and the login the windows were read under.
const usage = (account: unknown) =>
  JSON.stringify({
    account,
    rate_limits: { five_hour: { resets_at: 1767276600, used_percentage: 42 } },
    storedLogin: { account, week: 0.4 },
    writtenAt: "2026-01-01T11:59:00.000Z",
  })

// The user menu names the owner's own login, not a factory one: the factory runs on a login spawn.sh hands each session, which never touches .claude.json
describe("loginOf", () => {
  test("picks the login usage.json's windows were read under, and nothing else of the file", () => {
    expect(loginOf(usage("pride@example.com"))).toBe("pride@example.com")
  })

  test("no login, a malformed one or a file that is not JSON is none", () => {
    expect(loginOf(usage(undefined))).toBeNull()
    expect(loginOf(usage("not an email"))).toBeNull()
    expect(loginOf(usage({ email: "pride@example.com" }))).toBeNull()
    expect(loginOf("{")).toBeNull()
  })
})

describe("accountFor", () => {
  const merritt = { email: "merritt@example.com", name: "Merritt" }

  test("the usage readings' login wins over .claude.json's account, and keeps its name only when the two are one account", () => {
    expect(accountFor("pride@example.com", merritt)).toEqual({
      email: "pride@example.com",
      name: null,
    })
    expect(accountFor("Merritt@Example.com", merritt)).toEqual({
      email: "Merritt@Example.com",
      name: "Merritt",
    })
    expect(accountFor("pride@example.com", null)).toEqual({
      email: "pride@example.com",
      name: null,
    })
  })

  test("with no login in usage.json, .claude.json's account as before", () => {
    expect(accountFor(null, merritt)).toEqual(merritt)
    expect(accountFor(null, null)).toBeNull()
  })
})

describe("readAccount", () => {
  const dir = mkdtempSync(join(tmpdir(), "account-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const path = join(dir, ".claude.json")
  const usagePath = join(dir, "usage.json")
  const missing = join(dir, "missing.json")

  test("reads the account from .claude.json while usage.json names no login, and a missing file is none", async () => {
    writeFileSync(path, config({ displayName: "Merritt", emailAddress: "merritt@example.com" }))
    expect(await readAccount(path, missing)).toEqual({
      email: "merritt@example.com",
      name: "Merritt",
    })
    writeFileSync(usagePath, usage(undefined))
    expect(await readAccount(path, usagePath)).toEqual({
      email: "merritt@example.com",
      name: "Merritt",
    })
    expect(await readAccount(missing, missing)).toBeNull()
  })

  test("names usage.json's login once it has one", async () => {
    writeFileSync(path, config({ displayName: "Merritt", emailAddress: "merritt@example.com" }))
    writeFileSync(usagePath, usage("pride@example.com"))
    expect(await readAccount(path, usagePath)).toEqual({ email: "pride@example.com", name: null })
    expect(await readAccount(missing, usagePath)).toEqual({
      email: "pride@example.com",
      name: null,
    })
  })
})

describe("claudeConfigFile", () => {
  const before = process.env.CLAUDE_CONFIG_DIR
  afterEach(() => {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = before
  })

  test("is .claude.json under CLAUDE_CONFIG_DIR when set, else in the home folder", () => {
    process.env.CLAUDE_CONFIG_DIR = "/scratch/claude"
    expect(claudeConfigFile()).toBe("/scratch/claude/.claude.json")
    delete process.env.CLAUDE_CONFIG_DIR
    expect(claudeConfigFile()).toBe(join(homedir(), ".claude.json"))
  })
})
