import { resolve } from "node:path"

import {
  factorySettings,
  guardedOrgs,
  readPolicy,
  readPolicyOrDefaults,
  readSessionNames,
  type Settings,
  settingValue,
} from "@packages/settings"

import { setSessionNames } from "../../../config/src/kinds"
import { dataDir } from "../../../env/src/data-dir"

const CHECKOUT = resolve(import.meta.dir, "../../../..")

const origins = new Map<string, string>()

// Sets the machine's managers' names (sessions.names and sessions.aliases) for every name kinds.ts places in this process, once at its start.
export const loadSessionNames = (environment = process.env): void =>
  setSessionNames(readSessionNames(dataDir(environment)))

// A checkout's origin on GitHub as owner/name, lowercase, read once per process; empty when it has none.
export const originRepo = (checkout = CHECKOUT): string => {
  if (!origins.has(checkout)) {
    const run = Bun.spawnSync(["git", "-C", checkout, "remote", "get-url", "origin"], {
      stderr: "ignore",
    })
    const url = run.stdout.toString().trim()
    const slug = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(url)?.[1] ?? ""
    origins.set(checkout, slug.toLowerCase())
  }
  return origins.get(checkout)!
}

// The repository the factory's pull requests land in: factory.repo when set, else the checkout's origin.
export const factoryRepo = (settings: Settings, checkout = CHECKOUT): string =>
  factorySettings.get(settings, "factory.repo").toLowerCase() || originRepo(checkout)

// factory.repo as the data folder's store sets it, else the checkout's origin; a set that cannot be trusted throws its refusal, and so does neither, since a merge gate would then read no repo as the factory's and skip GitGuardian's check.
export const factoryRepoOf = async (
  environment: Record<string, string | undefined> = process.env,
  checkout = CHECKOUT,
): Promise<string> => {
  const data = dataDir(environment)
  const read = await readPolicy(data)
  if (read.refusal !== undefined) throw new Error(read.refusal)
  const repo = factoryRepo(read.settings, checkout)
  if (!repo)
    throw new Error(
      `factory.repo is unset in ${data} and ${checkout} has no GitHub origin, so the factory's repository is unknown: run playground settings set factory.repo <owner>/<name> --reason "<why>"`,
    )
  return repo
}

// A key a reader resolves past its stored value.
const RESOLVED: Record<string, (settings: Settings) => unknown> = {
  "factory.repo": factoryRepo,
}

// The settings reader for a caller that is not TypeScript (a shell or Python script): `bun packages/scripts/src/playground/setting.ts [--text] <key>...` prints each key's value on a line of its own, as JSON, or with --text a string as it is and a list of strings joined by spaces; a key's default on a machine with no store or none written yet, exit 0. It exits 2 naming why, printing nothing, for a key no piece defines or a store whose policy.json it cannot read. `--guarded-orgs` prints guardedOrgs() over ext.links as JSON, and a value ext.links' schema refuses exits 2 naming why, so a guard fails closed.
export const settingExit = async (
  words: string[],
  environment: Record<string, string | undefined>,
  out: (line: string) => void,
  err: (line: string) => void,
): Promise<number> => {
  if (words.length === 1 && words[0] === "--guarded-orgs") {
    const read = readPolicyOrDefaults(dataDir(environment))
    if (read.refusal !== undefined) {
      err(read.refusal)
      return 2
    }
    try {
      out(JSON.stringify(guardedOrgs(read.settings.values)))
    } catch (error) {
      err(`ext.links cannot be read: ${(error as Error).message}`)
      return 2
    }
    return 0
  }
  const text = words[0] === "--text"
  const keys = text ? words.slice(1) : words
  if (keys.length === 0 || keys.some((key) => key.startsWith("-"))) {
    err("usage: bun packages/scripts/src/playground/setting.ts [--text] <key>... | --guarded-orgs")
    return 2
  }
  const read = readPolicyOrDefaults(dataDir(environment))
  if (read.refusal !== undefined) {
    err(read.refusal)
    return 2
  }
  const values: unknown[] = []
  for (const key of keys) {
    const found = settingValue(read.settings, key)
    if (!found) {
      err(`no setting ${key}; playground settings list names them`)
      return 2
    }
    const resolved = RESOLVED[key]
    values.push(resolved ? resolved(read.settings) : found.value)
  }
  for (const value of values) out(text ? shown(value) : JSON.stringify(value))
  return 0
}

const shown = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value) && value.every((item) => typeof item === "string")
      ? value.join(" ")
      : JSON.stringify(value)

if (import.meta.main)
  process.exit(await settingExit(process.argv.slice(2), process.env, console.log, console.error))
