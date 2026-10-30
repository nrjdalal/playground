import { join } from "node:path"

import {
  type Account,
  accountKey,
  accountSettings,
  checkSetting,
  hasSecret,
  loginOf,
  type Provider,
  providerOf,
  removeSecret,
  type Result,
  setSetting,
  type Settings,
  settingRows,
  settingsFor,
  storeSecret,
  type Who,
} from "@packages/settings"

// Relative, not @/: the web's tests type-check this file under web/next's own @/ paths.
import { readsLive } from "../dashboard/fixture"
import { dataDir } from "../sessions/paths"
import { NOT_SET_UP } from "./app-words"

// Settings > Accounts: usage.accounts' rows with whether each one's token is kept, and the add and remove that write a row and its Keychain item together, the same writes `playground accounts add|remove` make.

export type AccountRow = {
  email: string | null
  key: string
  label: string | null
  provider: Provider
  stored: boolean
}

export type AccountInput =
  | { email: string; label?: string; provider: "claude"; token: string }
  | { label: string; provider: "glm"; token: string }

// An add's fields but its token, as a guided sign-in has them before setup-token prints one.
type AccountFields =
  | { email: string; label?: string; provider: "claude" }
  | { label: string; provider: "glm" }

const KEY = "usage.accounts"

// A stack that reads this machine keeps tokens in its Keychain; any other keeps only a sha256 of each in its own data folder, so a fixture stack never reaches the real Keychain.
export const keychainOf = (data: string) => ({
  record: readsLive() ? undefined : join(data, "keychain-record.json"),
})

// The login's settings, or none before playground ext init names a login.
const loginSettings = (data: string): { login: string; settings: Settings } | null => {
  let login: string
  try {
    login = loginOf(data)
  } catch {
    return null
  }
  return { login, settings: settingsFor(settingRows(data), login) }
}

const rowOf = (data: string, settings: Settings, row: Account): AccountRow => ({
  email: "email" in row ? row.email : null,
  key: accountKey(row),
  label: row.label ?? null,
  provider: providerOf(row),
  stored: hasSecret(settings, providerOf(row), accountKey(row), keychainOf(data)),
})

const NO_LOGIN = {
  message: `Accounts are kept in your settings, which are ${NOT_SET_UP}`,
  ok: false,
  status: 409,
} as const

export const listAccounts = (data = dataDir()): AccountRow[] => {
  const settings = loginSettings(data)?.settings
  if (!settings) return []
  return accountSettings.get(settings, KEY).map((row) => rowOf(data, settings, row))
}

type Refusal = Extract<Result<never>, { ok: false }>

const rowFrom = (input: AccountFields): Account =>
  input.provider === "glm"
    ? { label: input.label, provider: "glm" }
    : { email: input.email, ...(input.label ? { label: input.label } : {}), provider: "claude" }

// Why an add would be refused before any token is asked for: no login, the account listed already, or a row usage.accounts' schema refuses.
export const refusalOf = (input: AccountFields, data = dataDir()): Refusal | undefined => {
  const read = loginSettings(data)
  if (!read) return NO_LOGIN
  const row = rowFrom(input)
  const rows = accountSettings.get(read.settings, KEY)
  const key = accountKey(row)
  if (rows.some((each) => providerOf(each) === input.provider && accountKey(each) === key))
    return { message: `${key} is already listed`, ok: false, status: 409 }
  const checked = checkSetting(KEY, [...rows, row])
  if (!checked.ok) return { message: checked.message, ok: false, status: 400 }
}

// Keeps the token, then lists the row: the row is checked by usage.accounts' schema before the Keychain is touched, so a refused row stores nothing.
export const addAccount = (
  input: AccountInput,
  who: Who,
  data = dataDir(),
): Result<{ account: AccountRow }> => {
  const refused = refusalOf(input, data)
  if (refused) return refused
  const read = loginSettings(data)!
  const row = rowFrom(input)
  const rows = accountSettings.get(read.settings, KEY)
  const key = accountKey(row)
  try {
    storeSecret(read.settings, input.provider, key, input.token, keychainOf(data))
  } catch (error) {
    return { message: (error as Error).message, ok: false, status: 400 }
  }
  const set = setSetting(data, { key: KEY, scope: read.login, value: [...rows, row] }, who)
  if (!set.ok) return set
  return { account: rowOf(data, read.settings, row), ok: true }
}

// Drops the row, then its Keychain item, so a row is never left listed without its token.
export const removeAccount = (
  provider: Provider,
  key: string,
  who: Who,
  data = dataDir(),
): Result<{ key: string; provider: Provider }> => {
  const read = loginSettings(data)
  if (!read) return NO_LOGIN
  const rows = accountSettings.get(read.settings, KEY)
  const kept = rows.filter((row) => providerOf(row) !== provider || accountKey(row) !== key)
  if (kept.length === rows.length)
    return { message: `no ${provider} account ${key}`, ok: false, status: 404 }
  const set = setSetting(data, { key: KEY, scope: read.login, value: kept }, who)
  if (!set.ok) return set
  removeSecret(read.settings, provider, key, keychainOf(data))
  return { key, ok: true, provider }
}
