import { readFileSync } from "node:fs"
import { join } from "node:path"

// By relative path, so a test outside the package type-checks it, where @/ is not its src.
import { stableJson } from "./diff"
import { guardedOrgs } from "./ext"
import { deriveHooks, extGit, extLog, scopesIn, writeFiles, writeRoot } from "./folder"
import { CORE, extensionsDir, loginOf, scopeDir } from "./rendered"
import {
  checkSetting,
  CORE_READ_ONLY,
  extScopeSchema,
  resolveKey,
  SCHEMA_VERSION,
  settingFields,
  settingsFor,
} from "./settings"

// The settings half of the extensions folder: each scope's values in <scope>/settings.json, each write one commit in that scope's clone whose author is who asked, whose message is the reason and whose Setting trailer names the key, with the root's policy.json rebuilt from every scope beside it.

type Who = { actor: string; author: string; inboxRef: number | null; reason: string }
export type Result<T> = ({ ok: true } & T) | { message: string; ok: false; status: 400 | 404 | 409 }
export type Row = { key: string; scope: string; value: unknown }

const FILE = "settings.json"

const readValues = (data: string, scope: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(join(scopeDir(data, scope), FILE), "utf8"))
  } catch {
    return {}
  }
}

// Every value set at a scope, core's (in the checkout, where scopeDir finds it) first; a key no piece defines stays a row, so a write of another key keeps it.
export const settingRows = (data: string): Row[] =>
  [CORE, ...scopesIn(data).filter((scope) => scope !== CORE)].flatMap((scope) =>
    Object.entries(readValues(data, scope)).map(([key, value]) => ({ key, scope, value })),
  )

// policy.json: the settings a session in the home set reads, and those of a session in each guarded org's repos.
export const policyJson = (rows: Row[], login: string): string => {
  const values = settingsFor(rows, login).values
  return stableJson({
    orgs: Object.fromEntries(
      guardedOrgs(values).map((org) => [org, settingsFor(rows, login, org).values]),
    ),
    schemaVersion: SCHEMA_VERSION,
    values,
  })
}

// The root's derived files rebuilt from every scope, policy.json and the guards' lists, after a clone or a pull brought commits no write here made; call it under withLock.
export const deriveRoot = (data: string, login: string): void => {
  writeRoot(extensionsDir(data), new Map([["policy.json", policyJson(settingRows(data), login)]]))
  deriveHooks(data, login)
}

const byScopeKey = (a: Row, b: Row) => (`${a.scope} ${a.key}` < `${b.scope} ${b.key}` ? -1 : 1)

export const listSettings = (data: string) => ({
  keys: settingFields().map(({ field, key }) => ({
    aliases: field.aliases ?? [],
    default: field.default,
    description: field.description,
    key,
  })),
  rows: settingRows(data).sort(byScopeKey),
  schemaVersion: SCHEMA_VERSION,
})

const namesOf = (key: string): string[] => [
  key,
  ...(settingFields().find((entry) => entry.key === key)!.field.aliases ?? []),
]

// The login, or none before playground ext init names one, when a read takes core's values and the defaults.
const loginOrNone = (data: string): string | undefined => {
  try {
    return loginOf(data)
  } catch {
    return undefined
  }
}

// What a session of the org reads for one key: its value and every row that sets it, or its default.
export const readSetting = (data: string, key: string, org?: string) => {
  const name = resolveKey(key)
  if (!name) return null
  const rows = settingRows(data)
  const values = settingsFor(rows, loginOrNone(data) ?? "", org).values
  const field = settingFields().find((entry) => entry.key === name)!.field
  return {
    default: field.default,
    key: name,
    rows: rows.filter((row) => resolveKey(row.key) === name).sort(byScopeKey),
    value: name in values ? values[name] : field.default,
  }
}

// A write's refusal: core, a scope GitHub would not name, or a machine whose extensions have no login yet.
const badScope = (data: string, scope: string): Result<never> | undefined =>
  scope === CORE
    ? { message: CORE_READ_ONLY, ok: false, status: 409 }
    : !extScopeSchema.safeParse(scope).success
      ? { message: "a scope is your GitHub login or an org's name", ok: false, status: 400 }
      : loginOrNone(data) === undefined
        ? {
            message:
              "settings are written to your extensions, which need a login: run playground ext init",
            ok: false,
            status: 409,
          }
        : undefined

// One commit of the scope's new settings.json, with policy.json rebuilt at the root from every scope.
const commit = (
  data: string,
  scope: string,
  key: string,
  values: Record<string, unknown>,
  who: Who,
) => {
  const rows = [
    ...settingRows(data).filter((row) => row.scope !== scope),
    ...Object.entries(values).map(([name, value]) => ({ key: name, scope, value })),
  ]
  const trailers: [string, string][] = [
    ["Setting", key],
    ["Actor", who.actor],
  ]
  if (who.inboxRef !== null) trailers.push(["Inbox", `#i${who.inboxRef}`])
  writeFiles(
    data,
    scope,
    new Map([[FILE, stableJson(values)]]),
    { author: who.author, reason: who.reason, trailers },
    new Map([["policy.json", policyJson(rows, loginOf(data))]]),
  )
}

export const setSetting = (
  data: string,
  input: { key: string; scope: string; value: unknown },
  who: Who,
): Result<{ key: string; scope: string; value: unknown }> => {
  const bad = badScope(data, input.scope)
  if (bad) return bad
  const checked = checkSetting(input.key, input.value)
  if (!checked.ok) return { message: checked.message, ok: false, status: 400 }
  const values = readValues(data, input.scope)
  values[checked.key] = checked.value
  commit(data, input.scope, checked.key, values, who)
  return { key: checked.key, ok: true, scope: input.scope, value: checked.value }
}

// Takes a setting back to its default at a scope by dropping it from the scope's file, under its name and each alias.
export const resetSetting = (
  data: string,
  input: { key: string; scope: string },
  who: Who,
): Result<{ key: string; scope: string }> => {
  const bad = badScope(data, input.scope)
  if (bad) return bad
  const key = resolveKey(input.key)
  if (!key) return { message: `no setting ${input.key}`, ok: false, status: 404 }
  const values = readValues(data, input.scope)
  const names = namesOf(key).filter((name) => name in values)
  if (!names.length)
    return {
      message: `${key} has no value at ${input.scope}: it is at its default`,
      ok: false,
      status: 409,
    }
  for (const name of names) delete values[name]
  commit(data, input.scope, key, values, who)
  return { key, ok: true, scope: input.scope }
}

const valueAt = (data: string, scope: string, rev: string, key: string): unknown => {
  const shown = extGit(scopeDir(data, scope), ["show", `${rev}:${FILE}`])
  if (shown.code !== 0) return null
  try {
    return JSON.parse(shown.out)[key] ?? null
  } catch {
    return null
  }
}

// Every commit that changed a key, in every scope, under its current name and each alias, newest first, with its value before and after: playground settings why.
export const settingHistory = (data: string, key: string) => {
  const name = resolveKey(key)
  if (!name) return null
  return scopesIn(data)
    .flatMap((scope) =>
      namesOf(name).flatMap((each) =>
        extLog(data, scope, ["Setting", each]).map((entry) => {
          const inbox = entry.trailers.find(([trailer]) => trailer === "Inbox")?.[1]
          return {
            actor: entry.trailers.find(([trailer]) => trailer === "Actor")?.[1] ?? null,
            at: entry.at,
            author: entry.author,
            inboxRef: inbox ? Number(inbox.slice(2)) : null,
            key: each,
            newValue: valueAt(data, scope, entry.sha, each),
            oldValue: valueAt(data, scope, `${entry.sha}^`, each),
            reason: entry.reason,
            scope,
            sha: entry.sha,
          }
        }),
      ),
    )
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
