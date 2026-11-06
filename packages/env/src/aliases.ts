// The env names the rename changed still read: importing this fills each PLAYGROUND_* name from its old name when the new one is unset or empty, so a reader names the new one alone and a live .env, a plist or a running session's environment keeps working.

type Env = Record<string, string | undefined>

// The DESK_* names read from the environment, a name ending in _ standing for every name it starts (DESK_HERDR_SESSIONS); every other DESK_* token was a constant.
export const DESK_ENV = new Set([
  "APPROVALS_ENABLED",
  "ATTACHMENTS_DIR",
  "BARE_NAMES",
  "CHANGELOG_DIR",
  "DATA_DIR",
  "DEBUG_",
  "DEBUG_PASTE_DIR",
  "DISPATCHER",
  "DISPATCHER_SECONDARY",
  "FIXTURE",
  "FIXTURE_DIR",
  "FIXTURE_LAUNCHED",
  "HERDR_",
  "HERDR_ALONE",
  "HERDR_DIR",
  "HERDR_SESSION",
  "HERDR_SESSIONS",
  "LIVE_READS",
  "MERGED_PULLS",
  "OWNER_NAME",
  "PREVIEWS_DIR",
  "SDK_PERMISSION_MODE",
  "SDK_PROBE_DIR",
])

// The name an old env name became, or undefined for a name the rename left alone.
export const renamedEnv = (name: string): string | undefined => {
  if (!name.startsWith("DESK_")) return
  const rest = name.slice("DESK_".length)
  if (DESK_ENV.has(rest) || [...DESK_ENV].some((p) => p.endsWith("_") && rest.startsWith(p)))
    return `PLAYGROUND_${rest}`
}

export const applyEnvAliases = (env: Env = process.env): void => {
  for (const [name, value] of Object.entries(env)) {
    const renamed = renamedEnv(name)
    if (renamed && !env[renamed]) env[renamed] = value
  }
}

applyEnvAliases()
