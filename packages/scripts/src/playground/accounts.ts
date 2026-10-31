import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  type Account,
  accountKey,
  accountSettings,
  accountsOf,
  checkSetting,
  hasSecret,
  keychainServiceOf,
  loginOf,
  type Provider,
  providerOf,
  readPolicyOrDefaults,
  removeSecret,
  setSetting,
  storeSecret,
} from "@packages/settings"

import { need, one, parseWords, Usage } from "./store"

// playground accounts: the rows of usage.accounts and the Keychain item beside each, a Claude token by its email and a GLM key by its label; nothing here prints a secret.

export const ACCOUNTS_USAGE =
  "usage: playground accounts list | add --provider claude --email <email> [--label <label>] | add --provider glm --label <label> | remove <email|label>"

// The guided sign-in's steps, printed before setup-token shows its link, as the dashboard's Add shows them.
const CLAUDE_STEPS = [
  "Add a Claude account in 3 steps:",
  "  1. Open the link claude setup-token prints below in a private or guest window, so this browser's own Claude sign-in stays out of it.",
  "  2. Sign in there with the account you want to add, not the one this browser holds, and approve access.",
  "  3. Paste the code the page shows at setup-token's prompt, then the token it prints when asked here.",
]

export type AccountsIo = {
  data: string
  err: (line: string) => void
  out: (line: string) => void
  // one line read with no echo when stdin is a terminal, else stdin's first line
  readSecret: (prompt: string) => Promise<string>
  // claude setup-token in the user's own terminal, its exit code
  setupToken: () => Promise<number>
}

const settingsOf = (data: string) => {
  const read = readPolicyOrDefaults(data)
  if (read.refusal !== undefined) throw new Error(read.refusal)
  return read.settings
}

const json = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

const percent = (value: unknown) => (typeof value === "number" ? `${Math.round(value)}%` : "?")

// A Claude row's last reading from the login flip's state, a GLM row's from zai-usage.json, which follows the first GLM key alone.
const usageOf = (data: string, row: Account, firstGlm: string | undefined): string => {
  if (providerOf(row) === "claude") {
    const flip = json(join(data, "ops", "usage", "login-flip.json")) as {
      seen?: Record<string, { five?: unknown; week?: unknown }>
    }
    const seen = flip?.seen?.[accountKey(row)]
    // a null five is an account with no 5-hour window
    return seen
      ? `5h ${seen.five === null ? "none" : percent(seen.five)}, week ${percent(seen.week)}`
      : "no reading yet"
  }
  if (accountKey(row) !== firstGlm) return "no reading: the usage job reads the first GLM key"
  const file = json(join(data, "zai-usage.json")) as {
    balance?: { seenAt?: unknown }
    error?: unknown
    errorAt?: unknown
    windows?: Record<string, unknown>
  } | null
  // as the sidebar reads it (zaiUsageOf): a failed read is no reading, and an empty balance spends both windows
  if (file && "error" in file) return `no reading: the usage read failed at ${String(file.errorAt)}`
  const windows = file?.windows
  const share = (name: string) => {
    const window = windows?.[name] as { cap?: unknown; used?: unknown } | undefined
    if (typeof window?.used !== "number" || typeof window.cap !== "number" || window.cap <= 0)
      return "?"
    return percent(file?.balance ? 100 : (window.used / window.cap) * 100)
  }
  const empty = file?.balance ? `, the balance empty since ${String(file.balance.seenAt)}` : ""
  return windows ? `5h ${share("fiveHour")}, week ${share("week")}${empty}` : "no reading yet"
}

export async function accountsCommand(words: string[], io: AccountsIo): Promise<number> {
  const [verb, ...rest] = words
  const { options, positional } = parseWords(rest)
  const settings = settingsOf(io.data)
  const rows = accountSettings.get(settings, "usage.accounts")
  const write = (value: Account[], reason: string, scope = loginOf(io.data)) => {
    const set = setSetting(
      io.data,
      { key: "usage.accounts", scope, value },
      { actor: "cli", author: "owner", inboxRef: null, reason },
    )
    if (!set.ok) throw new Error(set.message)
  }
  if (verb === "list") {
    if (positional.length || Object.keys(options).length) throw new Usage("list takes no words")
    if (!rows.length) io.out("no accounts yet: playground accounts add adds one")
    const firstGlm = accountsOf(rows, "glm")[0]?.label
    for (const row of rows) {
      const provider = providerOf(row)
      const key = accountKey(row)
      const label = provider === "claude" && row.label ? ` (${row.label})` : ""
      const kept = hasSecret(settings, provider, key) ? "kept" : "MISSING from the Keychain"
      io.out(`${provider} ${key}${label}: ${kept}, ${usageOf(io.data, row, firstGlm)}`)
    }
    return 0
  }
  if (verb === "add") {
    if (positional.length) throw new Usage(`add takes no ${positional[0]}`)
    const provider = need(one(options, "--provider"), "--provider") as Provider
    if (provider !== "claude" && provider !== "glm")
      throw new Usage(`--provider takes claude or glm, not ${provider}`)
    const label = one(options, "--label")
    const email = one(options, "--email")
    if (provider === "glm" && email) throw new Usage("a GLM key is kept by its --label alone")
    const row: Account =
      provider === "glm"
        ? { label: need(label, "--label"), provider }
        : { email: need(email, "--email"), ...(label ? { label } : {}) }
    const key = accountKey(row)
    const held = rows.some((each) => providerOf(each) === provider && accountKey(each) === key)
    const next = held ? rows : [...rows, row]
    const checked = checkSetting("usage.accounts", next)
    if (!checked.ok) throw new Usage(checked.message)
    // the row's scope is read before any secret is asked for, so a folder with no login keeps nothing
    const scope = loginOf(io.data)
    if (provider === "claude") {
      for (const line of CLAUDE_STEPS) io.out(line)
      const code = await io.setupToken()
      if (code !== 0) throw new Error(`claude setup-token exited ${code}, so nothing was saved`)
    }
    const secret = (
      await io.readSecret(
        provider === "claude"
          ? `Paste the token claude setup-token printed for ${key} (it does not echo): `
          : `Paste the Z.ai key for ${key} (it does not echo): `,
      )
    ).trim()
    if (!secret) throw new Error("no secret was given, so nothing was saved")
    if (provider === "claude" && !secret.startsWith("sk-ant-"))
      throw new Error("that is not a Claude token, which starts sk-ant-, so nothing was saved")
    storeSecret(settings, provider, key, secret)
    if (!held)
      try {
        write(next, `playground accounts add ${provider} ${key}`, scope)
      } catch (error) {
        removeSecret(settings, provider, key)
        throw error
      }
    io.out(
      `${held ? "=" : "+"} ${provider} ${key}: its secret kept under ${keychainServiceOf(settings, provider)}${held ? " again, its row as it was" : ", its row added to usage.accounts"}`,
    )
    return 0
  }
  if (verb === "remove") {
    const id = need(positional[0], "an email or a label")
    if (positional.length > 1 || Object.keys(options).length)
      throw new Usage("remove takes one email or label")
    const named = rows.filter((row) => accountKey(row) === id || row.label === id)
    if (!named.length) throw new Error(`no account ${id} in usage.accounts`)
    if (named.length > 1) throw new Error(`${id} names more than one account: remove it by email`)
    const row = named[0]!
    const provider = providerOf(row)
    const key = accountKey(row)
    write(
      rows.filter((each) => each !== row),
      `playground accounts remove ${provider} ${key}`,
    )
    const had = removeSecret(settings, provider, key)
    io.out(
      `- ${provider} ${key}: its row removed${had ? ", and its secret from the Keychain" : "; the Keychain held no secret for it"}`,
    )
    return 0
  }
  throw new Usage(`no accounts command ${verb ?? ""}`.trim())
}

// The terminal's own io: the secret read with echo off, and claude setup-token on this terminal.
export const accountsIo = (data: string): AccountsIo => ({
  data,
  err: console.error,
  out: console.log,
  readSecret: async (prompt) => {
    if (!process.stdin.isTTY) return (await Bun.stdin.text()).split("\n")[0] ?? ""
    process.stderr.write(prompt)
    Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" })
    try {
      for await (const line of console) return line
      return ""
    } finally {
      Bun.spawnSync(["stty", "echo"], { stdin: "inherit" })
      process.stderr.write("\n")
    }
  },
  // BROWSER opens nothing, so setup-token never signs in through the default browser, which holds this Mac's own sign-in; claude is looked up on PATH as it is now
  setupToken: () =>
    Bun.spawn([Bun.which("claude", { PATH: process.env.PATH ?? "" }) ?? "claude", "setup-token"], {
      env: { ...process.env, BROWSER: "/usr/bin/true" },
      stdio: ["inherit", "inherit", "inherit"],
    }).exited,
})

// The command's run: its usage on a word it does not take, 2; any other refusal, 1.
export async function runAccounts(words: string[], io: AccountsIo): Promise<number> {
  try {
    return await accountsCommand(words, io)
  } catch (error) {
    const usage = error instanceof Usage
    io.err(`playground accounts: ${(error as Error).message}${usage ? `\n${ACCOUNTS_USAGE}` : ""}`)
    return usage ? 2 : 1
  }
}
