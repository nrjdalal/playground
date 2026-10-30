import { homedir } from "node:os"
import { join } from "node:path"

import { z } from "zod"

import { readFixtureMachine, readsLive } from "@/lib/dashboard/fixture"
import { type AccountUsage, readAccountUsages, usagePath } from "@/lib/usage/window"

// The Claude account the usage windows reflect, which the user menu shows in place of the dashboard's sign-in user: the login usage.json was read under, else the one Claude Code's config names.
export type Account = { email: string; name: string | null }

// Claude Code keeps its global config, the logged-in account among it, in .claude.json under CLAUDE_CONFIG_DIR when that is set, else in the home folder.
export const claudeConfigFile = (): string => {
  const dir = process.env.CLAUDE_CONFIG_DIR
  return dir ? join(dir, ".claude.json") : join(homedir(), ".claude.json")
}

// Picks the account's email and display name alone: zod drops every other key, so no token or other field of the file goes any further.
const configSchema = z.object({
  oauthAccount: z.object({
    displayName: z.string().trim().min(1).optional().catch(undefined),
    emailAddress: z.email(),
  }),
})

// Pure: the config file's text as its account, or null when it names none.
export function accountOf(text: string): Account | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) return null
  const { displayName, emailAddress } = parsed.data.oauthAccount
  return { email: emailAddress, name: displayName ?? null }
}

// Picks the login alone: usage.json's `account`, which the ops-usage job writes beside the windows it read under that login.
const usageSchema = z.object({ account: z.email() })

// Pure: usage.json's text as the login its windows were read under, or null when it names none.
export function loginOf(text: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = usageSchema.safeParse(raw)
  return parsed.success ? parsed.data.account : null
}

// Pure: the account the menu names. The factory runs on the login spawn.sh hands each session, which never touches .claude.json, so usage.json's login wins, since the menu should name the account the sessions run on, and it keeps .claude.json's display name only when the two are one account; with no login, .claude.json's account.
export function accountFor(login: string | null, config: Account | null): Account | null {
  if (!login) return config
  const same = config?.email.toLowerCase() === login.toLowerCase()
  return { email: login, name: same ? config.name : null }
}

const readText = (path: string): Promise<string | null> =>
  Bun.file(path)
    .text()
    .catch(() => null)

// The login usage.json names; a missing or unreadable file is none. A fixture stack reads its own fixture's usage.json here.
export async function readLogin(path = usagePath()): Promise<string | null> {
  const text = await readText(path)
  return text === null ? null : loginOf(text)
}

// The account Claude Code's config names, the main login; a missing or unreadable file is none. Only a stack that reads this machine calls it.
export async function readConfigAccount(path = claudeConfigFile()): Promise<Account | null> {
  const text = await readText(path)
  return text === null ? null : accountOf(text)
}

// The account the menu names, from usage.json's login and Claude Code's config; a missing or unreadable file is none. Only a stack that reads this machine calls it, so a fixture stack never opens the real config.
export async function readAccount(
  path = claudeConfigFile(),
  usage = usagePath(),
): Promise<Account | null> {
  const [login, config] = await Promise.all([readLogin(usage), readConfigAccount(path)])
  return accountFor(login, config)
}

// Every account's usage file, the main login first: this machine's from Claude Code's config, a fixture stack's from its made-up config, so it never opens the real one.
export async function readAccounts(): Promise<AccountUsage[]> {
  const main = readsLive() ? await readConfigAccount() : (readFixtureMachine().account ?? null)
  return readAccountUsages(main?.email ?? null)
}
