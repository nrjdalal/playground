// A session's factory role, which the hooks read: PLAYGROUND_ROLE, else the role its name in Claude Code's registry gives, through the roster's kind for that name first and the name itself second, since cmux restores a session after a restart without the env var, else "" for a session outside the factory.
import "../../packages/env/src/aliases"
import { homedir } from "node:os"
import { join } from "node:path"

// By relative source path, never through @packages/config: every guard imports this file from the main checkout and fails open, so a dist a failed build left stale or missing would turn them all off.
import {
  FACTORY_ROLE_OF_KIND,
  isRosterKind,
  roleOfName,
  setSessionNames,
} from "../../packages/config/src/kinds"
import { dataDirOf } from "../../packages/env/src/data-dir"

export { roleOfName }

// The roles a manager runs under: the dispatcher's and the leads'.
export const MANAGER_ROLES = new Set(["dispatcher", "lead", "manager"])

type Environment = Record<string, string | undefined>

let names: Promise<void> | undefined

// The machine's managers' names, which roleOfName places a name by, read once a process through setting.ts, since a hook cannot load @packages/settings; a read that fails keeps a fresh install's.
export function loadNames(environment: Environment = process.env): Promise<void> {
  names ??= (async () => {
    try {
      const setting = join(import.meta.dir, "../../packages/scripts/src/playground/setting.ts")
      const read = Bun.spawn(["bun", setting, "sessions.names", "sessions.aliases"], {
        env: { ...process.env, ...environment },
        stderr: "ignore",
        stdout: "pipe",
      })
      const [names, aliases] = (await new Response(read.stdout).text()).trim().split("\n")
      if ((await read.exited) === 0)
        setSessionNames({ aliases: JSON.parse(aliases!), names: JSON.parse(names!) })
    } catch {}
  })()
  return names
}

// The session's name from Claude Code's registry, the file whose sessionId is this session's.
export async function registryName(
  sessionId: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  const dir = join(environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "sessions")
  for await (const file of new Bun.Glob("*.json").scan(dir)) {
    try {
      const entry = (await Bun.file(join(dir, file)).json()) as {
        name?: unknown
        sessionId?: unknown
      }
      if (entry.sessionId === sessionId && typeof entry.name === "string") return entry.name
    } catch {}
  }
}

// The role the roster's kind for a name gives, or "" when the roster has no entry of that name with a kind on the list, or cannot be read.
export async function rosterRole(
  name: string,
  environment: Environment = process.env,
): Promise<string> {
  const path = join(dataDirOf(environment), "roster.json")
  try {
    const roster = (await Bun.file(path).json()) as {
      agents?: { kind?: unknown; name?: unknown }[]
    }
    const kind = roster.agents?.find((agent) => agent?.name === name)?.kind
    return isRosterKind(kind) ? FACTORY_ROLE_OF_KIND[kind] : ""
  } catch {
    return ""
  }
}

// The names of the roster's live rows (`live` in scripts/roster-statuses.json, read here rather than imported, so role.ts loads from a bare checkout), or none when either cannot be read; an ended row's name (probe-dashboard) is an everyday word again.
export async function rosterNames(environment: Environment = process.env): Promise<string[]> {
  const path = join(dataDirOf(environment), "roster.json")
  try {
    const { live } = (await Bun.file(
      join(import.meta.dir, "..", "roster-statuses.json"),
    ).json()) as {
      live: string[]
    }
    const roster = (await Bun.file(path).json()) as {
      agents?: { name?: unknown; status?: unknown }[]
    }
    return (roster.agents ?? []).flatMap((agent) =>
      typeof agent?.name === "string" && live.includes(String(agent.status)) ? [agent.name] : [],
    )
  } catch {
    return []
  }
}

// "" when none tells: a registry that cannot be read places no session in the factory.
export async function sessionRole(environment: Environment, sessionId: unknown): Promise<string> {
  if (environment.PLAYGROUND_ROLE) return environment.PLAYGROUND_ROLE
  if (typeof sessionId !== "string") return ""
  try {
    const name = (await registryName(sessionId, environment)) ?? ""
    const role = name && (await rosterRole(name, environment))
    if (role) return role
    await loadNames(environment)
    return roleOfName(name)
  } catch {
    return ""
  }
}

// Whether a hook's input comes from a factory session: the hooks that guard the factory alone pass the owner's own sessions untouched, which load them too from the project settings.
export async function fromFactory(
  raw: string,
  environment: Environment = process.env,
): Promise<boolean> {
  return (await sessionRole(environment, sessionOf(raw))) !== ""
}

// The hook input's session_id, or undefined when the input does not read.
export function sessionOf(raw: string): unknown {
  try {
    return (JSON.parse(raw) as { session_id?: unknown }).session_id
  } catch {
    return undefined
  }
}
