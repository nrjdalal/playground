import {
  CORE,
  CORE_READ_ONLY,
  listSettings,
  loginOf,
  readSetting,
  resetSetting,
  type Result,
  setSetting,
  settingHistory,
} from "@packages/settings"

import { type Io, need, one, parseWords, print, Usage, valueOf } from "./store"

// playground settings: reads and writes the settings files in the extensions folder itself, with no dashboard needed; a write is one commit in its scope's clone, under the lock every writer takes.

export const SETTINGS_USAGE =
  "usage: playground settings list | get <key> [--org <org>] | why <key> | set <key> <value> --reason <why> [--scope <scope>] | reset <key> --reason <why> [--scope <scope>] | import-jobs <jobs.json> [--launch-agents <dir>] [--scope <scope>] [--dry-run]"

const done = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`${result.status} ${result.message}`)
  const { ok: _, ...data } = result
  return data as T
}

export async function settingsCommand(words: string[], io: Io): Promise<number> {
  const [verb, ...rest] = words
  const { options, positional } = parseWords(rest, ["--dry-run"])
  const who = () => ({
    actor: "cli",
    author: one(options, "--by") ?? "owner",
    inboxRef: null,
    reason: need(one(options, "--reason"), "--reason"),
  })
  const scope = () => {
    const named = one(options, "--scope") ?? loginOf(io.data)
    if (named === CORE) throw new Usage(CORE_READ_ONLY)
    return named
  }
  const key = () => need(positional[0], "a key")
  const known = <T>(read: T | null): T => {
    if (read === null) throw new Error(`404 no setting ${key()}`)
    return read
  }
  if (verb === "list") print(io.out, listSettings(io.data))
  else if (verb === "get") print(io.out, known(readSetting(io.data, key(), one(options, "--org"))))
  else if (verb === "why") print(io.out, known(settingHistory(io.data, key())))
  else if (verb === "set") {
    const value = valueOf(need(positional[1], "a value"))
    print(io.out, done(setSetting(io.data, { key: key(), scope: scope(), value }, who())))
  } else if (verb === "reset")
    print(io.out, done(resetSetting(io.data, { key: key(), scope: scope() }, who())))
  else if (verb === "import-jobs") {
    const into = scope()
    const reason = one(options, "--reason")
    return (await import("./jobs")).importJobs(
      need(positional[0], "a jobs.json"),
      {
        dryRun: Boolean(options["--dry-run"]),
        launchAgents: one(options, "--launch-agents"),
        scope: into,
      },
      (setting, value, why) =>
        done(
          setSetting(
            io.data,
            { key: setting, scope: into, value },
            { actor: "cli", author: "owner", inboxRef: null, reason: reason ?? why },
          ),
        ),
      io.out,
    )
  } else throw new Usage(`no settings command ${verb ?? ""}`.trim())
  return 0
}
