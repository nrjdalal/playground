import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// The extensions as sessions read them: <data>/extensions, one git clone per scope (the user's login, each org) beside the derived policy.json and hooks/<list>.json, and core, Playground's own, read from the checkout this package runs from. Written only by the API and the CLI. The root existing is what says this machine has extensions. This file imports only node: modules, since every guard loads it at each call.

// The lists a guard reads, by the name its file takes in the root's hooks folder, A to Z; a render refuses a tree that lacks one, so no guard is left without its list.
export const GUARD_LISTS = [
  "desktop-owner-apps",
  "glm-refused-sources",
  "no-public-leak",
  "playground-terms",
  "release-owners",
  "slack-cleared",
] as const

// Playground's own scope, which ships with the checkout and no writer touches.
export const CORE = "core"
export const coreDir = (): string =>
  fileURLToPath(new URL("../../../extensions/core", import.meta.url))

export const extensionsDir = (data: string) => join(data, "extensions")
export const scopeDir = (data: string, scope: string) =>
  scope === CORE ? coreDir() : join(data, "extensions", scope)
// The folder sessions read: the extensions root.
export const currentDir = extensionsDir
// What says this machine has extensions: their root.
export const markerPath = extensionsDir
export const loginPath = (data: string) => join(data, "extensions", "login")

// The login scope, the user's own: PLAYGROUND_LOGIN when set, else the login ext init wrote at the root.
export const loginOf = (
  data: string,
  env: Record<string, string | undefined> = process.env,
): string => {
  if (env.PLAYGROUND_LOGIN) return env.PLAYGROUND_LOGIN
  try {
    const login = readFileSync(loginPath(data), "utf8").trim()
    if (login) return login
  } catch {}
  throw new Error(`no login for the extensions in ${loginPath(data)}: run playground ext init`)
}

// Where an item lives in its scope's folder, without its extension.
export const itemPath = (kind: string, key: string): string => `${kind}s/${key}`

// How to write a root file that is missing: the guards' lists from the checkout's list files, any other from the settings that derive it, which need the login ext init writes.
export const fixFor = (file: string): string =>
  file.startsWith("hooks/")
    ? "seed the guards' lists with playground ext import --from-tree extensions/core/lists"
    : "run playground ext init, then set a setting with playground settings set, which writes it"

export type Read =
  | { path: string; refusal?: undefined }
  | { path?: undefined; refusal: string }
  | { path?: undefined; refusal?: undefined }

// A file under the extensions (policy.json, hooks/<list>.json, <scope>/<path>, core/<path> from the checkout), or why it cannot be read; with no root the machine has no extensions, and the caller takes its default.
export const readRendered = async (data: string, file: string): Promise<Read> =>
  readRenderedSync(data, file)

// readRendered for a caller that cannot wait: nothing in the read waits.
export const readRenderedSync = (data: string, file: string): Read => {
  const dir = extensionsDir(data)
  if (!existsSync(dir)) return {}
  const parts = file.split("/")
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    return { refusal: `${file} is not a path inside the extensions (${dir})` }
  const path = parts[0] === CORE ? join(coreDir(), ...parts.slice(1)) : join(dir, file)
  return existsSync(path)
    ? { path }
    : { refusal: `the extensions root (${dir}) holds no ${file}: ${fixFor(file)}` }
}

// The settings a session reads from the extensions' policy.json, its org's values over the rest; a machine with no extensions reads none, so every key takes its default, and a root that lacks it or holds one that does not parse is a refusal, never the defaults.
export const readPolicy = async (data: string, org?: string): Promise<Policy> =>
  readPolicySync(data, org)

export type Policy =
  | { refusal?: undefined; settings: { schemaVersion: 1; values: Record<string, unknown> } }
  | { refusal: string; settings?: undefined }

// readPolicy for a caller that cannot wait, such as a guard run inside a synchronous check.
export const readPolicySync = (data: string, org?: string): Policy => {
  const read = readRenderedSync(data, "policy.json")
  if (read.refusal) return { refusal: read.refusal }
  if (!read.path) return { settings: { schemaVersion: 1, values: {} } }
  let policy: { orgs?: Record<string, Record<string, unknown>>; values?: Record<string, unknown> }
  try {
    policy = JSON.parse(readFileSync(read.path, "utf8"))
  } catch {
    return {
      refusal: `the extensions' policy.json does not parse (${read.path}): ${fixFor("policy.json")}`,
    }
  }
  return {
    settings: {
      schemaVersion: 1,
      values: { ...policy.values, ...(org ? policy.orgs?.[org.toLowerCase()] : undefined) },
    },
  }
}

// The extensions' policy.json for a reader that renders from the file itself: none while a root ext init made has none yet, so every key takes its default as on a machine with no root.
export const readPolicyFile = (data: string): Read => {
  const read = readRenderedSync(data, "policy.json")
  return read.refusal === undefined ? read : {}
}

// readPolicySync for a reader whose keys all have safe defaults: a root ext init made, before a first setting writes policy.json, reads none, so every key takes its default and a fresh machine runs to that write; a policy.json that is there and does not parse is still a refusal.
export const readPolicyOrDefaults = (data: string, org?: string): Policy => {
  const read = readPolicySync(data, org)
  return read.refusal !== undefined && !existsSync(join(extensionsDir(data), "policy.json"))
    ? { settings: { schemaVersion: 1, values: {} } }
    : read
}
