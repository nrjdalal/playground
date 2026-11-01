import { randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { site } from "@packages/config/site"
import type { Result, Who } from "@packages/settings"

// Relative, not @/: the routes' types bring this file into web/next's type check, under its own @/ paths.
import { readsLive } from "../dashboard/fixture"
import { type AccountRow, addAccount, refusalOf } from "../store/accounts"

// Settings > Accounts' guided Add for Claude: `claude setup-token` runs here in Bun's own pty (script cannot take Bun's piped stdin, which is a socket), with BROWSER pointed at true so it never opens the default browser, which holds the owner's own sign-in; the link it prints goes to the page, which opens it in a new window on a fresh throwaway profile, the code the page takes goes to its stdin, and the token it prints goes to the Keychain under the email once the account it names is that email. One sign-in runs at a time, in memory; nothing it prints is logged or answered but the link.

export type Browser = {
  app: "Brave Browser" | "Firefox" | "Google Chrome" | "Microsoft Edge"
  name: "Brave" | "Chrome" | "Edge" | "Firefox"
}

// Each browser that opens a link on a fresh profile, in the order one is picked; Safari takes no profile from its argv, so a Mac with Safari alone gets the link to copy.
const BROWSERS = [
  { app: "Google Chrome", engine: "chromium", name: "Chrome" },
  { app: "Brave Browser", engine: "chromium", name: "Brave" },
  { app: "Microsoft Edge", engine: "chromium", name: "Edge" },
  { app: "Firefox", engine: "firefox", name: "Firefox" },
] as const

// A new window on the profile folder, with its fixed argv as probe.ts's COMMANDS are: the folder and the sign-in's own link are its only values.
const freshWindow = (
  open: string,
  browser: (typeof BROWSERS)[number],
  profile: string,
  url: string,
) => [
  open,
  "-na",
  browser.app,
  "--args",
  ...(browser.engine === "firefox"
    ? ["-profile", profile, "-no-remote"]
    : [`--user-data-dir=${profile}`, "--no-first-run"]),
  url,
]

// Wider than any sign-in link or token, so setup-token's screen never wraps one onto a second line.
const COLUMNS = 4096
// setup-token hands $BROWSER a link of its own to open; this one opens nothing, and the page opens the printed link in a new window on a fresh profile.
const NO_BROWSER = "/usr/bin/true"
const FAKE = join(import.meta.dir, "../../fixtures/setup-token.ts")
const LINK_MS = 20_000
const TOKEN_MS = 60_000
const PROFILE_MS = 10_000
// The longest a pasted code waits for its answer: setup-token's token, then the account read; the page waits a little longer.
export const CODE_WAIT_MS = TOKEN_MS + PROFILE_MS
const EXPIRY_MS = 10 * 60_000
// setup-token's Ink takes a long code and its Enter in one write as a paste and never submits it, so Enter goes on its own after this pause.
const PASTE_MS = 300

// What a test injects: the reader of the account a token signs in as, the binaries by path, so no case depends on PATH's order, the folder browsers are found in, the data folder, the expiry, the folder fresh profiles are made in and the wait for a token.
type Deps = {
  account?: (token: string) => Promise<string | null>
  applications?: string
  claude?: string
  data?: string
  expiryMs?: number
  open?: string
  profiles?: string
  tokenMs?: number
}

type SignIn = {
  email: string
  ended: boolean
  id: string
  label?: string
  proc: Bun.Subprocess
  profile?: string
  screen: string
  timer?: ReturnType<typeof setTimeout>
  url: string
  wake: Set<() => void>
}

let current: SignIn | undefined

const plain = (screen: string) => Bun.stripANSI(screen).replaceAll("\r", "")

// The sign-in link on setup-token's screen, read past its colours, its hyperlink codes and its carriage returns.
export const urlOf = (screen: string): string | undefined =>
  plain(screen).match(/https:\/\/\S*\/oauth\/\S+/)?.[0]

// setup-token's own refusal of a code, which it prints and then waits on Enter to retry.
const refusedOn = (screen: string): boolean => /OAuth error:/.test(plain(screen))

const tokenOf = (screen: string): string | undefined =>
  plain(screen).match(/sk-ant-[A-Za-z0-9_-]{20,}/)?.[0]

const browserOf = (applications = "/Applications"): (typeof BROWSERS)[number] | undefined =>
  BROWSERS.find((browser) => existsSync(join(applications, `${browser.app}.app`)))

const shown = (browser: (typeof BROWSERS)[number] | undefined): Browser | null =>
  browser ? { app: browser.app, name: browser.name } : null

// Pure: where the profile read goes, PLAYGROUND_PROFILE_URL when set (the new-user gate points it at a closed loopback port, so its made-up token never leaves the Mac), else Claude's own.
export const profileUrl = (env: Record<string, string | undefined> = process.env): string =>
  env.PLAYGROUND_PROFILE_URL || "https://api.anthropic.com/api/oauth/profile"

// The account a long-lived token signs in as, by Claude's own profile read, or null when it cannot say (a token scoped to inference alone may not read it).
const profileOf = async (token: string): Promise<string | null> => {
  try {
    const answer = await fetch(profileUrl(), {
      headers: { "anthropic-beta": "oauth-2025-04-20", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROFILE_MS),
    })
    if (!answer.ok) return null
    const body = (await answer.json()) as { account?: { email?: unknown } }
    return typeof body.account?.email === "string" ? body.account.email : null
  } catch {
    return null
  }
}

// A command by its path on PATH as it is now: Bun.spawn looks a bare name up on the PATH the process started with, which a later change misses.
const which = (name: string) => Bun.which(name, { PATH: process.env.PATH ?? "" })

// The real setup-token on a stack that reads this machine, else the made-up one; undefined when there is no claude.
const argvOf = (claude = which("claude")): string[] | undefined => {
  if (!readsLive()) return [process.execPath, FAKE, "setup-token"]
  return claude ? [claude, "setup-token"] : undefined
}

const end = (signIn: SignIn | undefined) => {
  if (!signIn || signIn.ended) return
  signIn.ended = true
  clearTimeout(signIn.timer)
  signIn.proc.kill()
  if (signIn.profile) rmSync(signIn.profile, { force: true, recursive: true })
  if (current === signIn) current = undefined
  for (const wake of signIn.wake) wake()
}

// The first thing read from the screen, once it shows, or undefined once the command exits, the sign-in ends or the wait runs out.
const until = <T>(signIn: SignIn, read: (screen: string) => T | undefined, ms: number) =>
  new Promise<T | undefined>((resolve) => {
    const settle = (value: T | undefined) => {
      clearTimeout(timer)
      signIn.wake.delete(check)
      resolve(value)
    }
    const check = () => {
      const value = read(signIn.screen)
      if (value !== undefined) settle(value)
      else if (signIn.ended) settle(undefined)
    }
    const timer = setTimeout(() => settle(read(signIn.screen)), ms)
    signIn.wake.add(check)
    check()
  })

// Starts a sign-in for the email, ending any before it: refused with the plain Add's words before anything runs when the account is listed already or there is no login.
export async function startSetup(
  input: { email: string; label?: string },
  deps: Deps = {},
): Promise<Result<{ browser: Browser | null; id: string; url: string }>> {
  const refused = refusalOf({ ...input, provider: "claude" }, deps.data)
  if (refused) return refused
  const argv = argvOf(deps.claude)
  if (!argv)
    return { message: "claude is not on PATH, so it cannot sign in", ok: false, status: 409 }
  end(current)
  const decoder = new TextDecoder()
  const proc = Bun.spawn(argv, {
    env: { ...process.env, BROWSER: NO_BROWSER },
    terminal: {
      cols: COLUMNS,
      data: (_, chunk) => {
        signIn.screen += decoder.decode(chunk, { stream: true })
        for (const wake of signIn.wake) wake()
      },
      rows: 50,
    },
  })
  const signIn: SignIn = {
    email: input.email,
    ended: false,
    id: randomUUID(),
    ...(input.label ? { label: input.label } : {}),
    proc,
    screen: "",
    url: "",
    wake: new Set(),
  }
  current = signIn
  void proc.exited.then(() => end(signIn))
  const url = await until(signIn, urlOf, LINK_MS)
  if (!url) {
    end(signIn)
    return { message: "claude setup-token printed no sign-in link", ok: false, status: 409 }
  }
  signIn.url = url
  // Its time runs from the link, when the owner can act on it, so a slow start under load never eats it.
  signIn.timer = setTimeout(() => end(signIn), deps.expiryMs ?? EXPIRY_MS)
  return { browser: shown(browserOf(deps.applications)), id: signIn.id, ok: true, url }
}

const gone = {
  message: `This sign-in has ended, most likely because ${site.name} restarted: start again for a new one`,
  ok: false,
  status: 404,
} as const

// Hands the code to setup-token and keeps the token it prints under the sign-in's email, unless the account it names is another, which drops it; confirmed says whether the account was named. The sign-in ends either way.
export async function submitCode(
  id: string,
  code: string,
  who: Who,
  deps: Deps = {},
): Promise<Result<{ account: AccountRow; confirmed: boolean }>> {
  const signIn = current
  if (!signIn || signIn.id !== id) return gone
  // Only what setup-token prints after the code answers it.
  const from = signIn.screen.length
  signIn.proc.terminal?.write(code)
  await Bun.sleep(PASTE_MS)
  signIn.proc.terminal?.write("\r")
  const answer = await until(
    signIn,
    (screen) => {
      const after = screen.slice(from)
      return tokenOf(after) ?? (refusedOn(after) ? null : undefined)
    },
    deps.tokenMs ?? TOKEN_MS,
  )
  const exited = signIn.ended
  end(signIn)
  if (answer === null)
    return {
      message:
        "Claude did not accept that code. It may be incomplete, expired, already used or from an earlier sign-in: start again for a new code",
      ok: false,
      status: 400,
    }
  if (answer === undefined && !exited)
    return {
      message: "Claude did not answer in time: start again for a new sign-in",
      ok: false,
      status: 409,
    }
  if (!answer)
    return {
      message: "the code was not taken: start again, and paste the code the sign-in page shows",
      ok: false,
      status: 400,
    }
  const token = answer
  const named = await (deps.account ?? (readsLive() ? profileOf : async () => signIn.email))(token)
  if (named && named.toLowerCase() !== signIn.email.toLowerCase())
    return {
      message: `the sign-in was for ${named}, not ${signIn.email}: start again, and sign in with ${signIn.email}`,
      ok: false,
      status: 409,
    }
  const added = addAccount(
    {
      email: signIn.email,
      ...(signIn.label ? { label: signIn.label } : {}),
      provider: "claude",
      token,
    },
    who,
    deps.data,
  )
  return added.ok ? { ...added, confirmed: named !== null } : added
}

// Opens the sign-in in progress in a new window on a fresh profile of the first installed browser, a folder deleted when the sign-in ends; a fixture stack opens nothing and names the browser it would have used.
export async function openPrivate(
  id: string,
  deps: Deps = {},
): Promise<Result<{ browser: Browser | null }>> {
  const signIn = current
  if (!signIn || signIn.id !== id || !signIn.url) return gone
  const browser = browserOf(deps.applications)
  if (!browser) return { browser: null, ok: true }
  if (!readsLive()) return { browser: shown(browser), ok: true }
  const open = deps.open ?? which("open") ?? "/usr/bin/open"
  signIn.profile ??= mkdtempSync(join(deps.profiles ?? tmpdir(), "playground-sign-in-"))
  const opened = Bun.spawn(freshWindow(open, browser, signIn.profile, signIn.url), {
    env: process.env,
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  })
  return { browser: (await opened.exited) === 0 ? shown(browser) : null, ok: true }
}
