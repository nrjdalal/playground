import { statSync } from "node:fs"
import { join } from "node:path"

// By relative path, so a test outside the package type-checks it, where @/ is not its src.
import { extSettings } from "./ext"
import { scopesIn } from "./folder"
import { listItems } from "./items"
import { CORE, loginOf, scopeDir } from "./rendered"
import { extLinkSchema, settingsFor } from "./settings"
import { type Result, setSetting, settingRows } from "./settings-folder"

// The extensions as the user arranges them, ext.order, ext.links and ext.repos at the login's scope: what playground ext list, order, link, unlink and remove read and write, and the Settings Extensions section beside them.

type Who = Parameters<typeof setSetting>[2]
export type Written = { key: string; scope: string; value: unknown }

const CORE_FIXED = "core is built into Playground: it is linked everywhere and always comes last"

const extOf = (data: string) => {
  const login = loginOf(data)
  const settings = settingsFor(settingRows(data), login)
  const links = extSettings.get(settings, "ext.links")
  const order = extSettings.get(settings, "ext.order")
  return {
    links,
    // the links a name has, the login's * always
    linksOf: (name: string) => (name === login ? ["*"] : (links[name] ?? [])),
    login,
    // every extension in priority order, the login's first unless ext.order places it
    names: order.includes(login) ? order : [login, ...order],
    repos: extSettings.get(settings, "ext.repos"),
  }
}

// The repository an extension syncs with: the one ext.repos names, else <login>/playground-<name>.
export const extRepoOf = (data: string, login: string, name: string): string =>
  extSettings.get(settingsFor(settingRows(data), login), "ext.repos")[name] ??
  `${login}/playground-${name}`

// When a folder last pulled from its repository, from git's FETCH_HEAD, or null before its first sync.
const syncedAt = (dir: string): string | null => {
  try {
    return statSync(join(dir, ".git", "FETCH_HEAD")).mtime.toISOString()
  } catch {
    return null
  }
}

// Each extension in ext.order's order with core last: its links, whether it is the login's, its items counted by kind, its repository and its last sync; core's repository is the checkout's.
export const listExtensions = (data: string) => {
  const ext = extOf(data)
  const counted = (scope: string) => {
    const counts: Record<string, number> = {}
    for (const item of listItems(data, { scope })) counts[item.kind] = (counts[item.kind] ?? 0) + 1
    return counts
  }
  return [
    ...ext.names.map((name) => ({
      counts: counted(name),
      links: ext.linksOf(name),
      login: name === ext.login,
      name,
      repo: ext.repos[name] ?? `${ext.login}/playground-${name}`,
      syncedAt: syncedAt(scopeDir(data, name)),
    })),
    { counts: counted(CORE), links: ["*"], login: false, name: CORE, repo: null, syncedAt: null },
  ]
}

// The login's extension holds this machine's settings, so every repo reads it.
const loginLinked = (name: string) =>
  ({
    message: `${name} is your login's extension, which holds your settings, so every repo reads it`,
    ok: false,
    status: 409,
  }) as const

const write = (data: string, key: string, value: unknown, who: Who) =>
  setSetting(data, { key, scope: loginOf(data), value }, who)

// A name that is an extension here: in ext.order, the login's, or a folder under the root.
const known = (data: string, name: string): Result<never> | undefined =>
  name === CORE
    ? { message: CORE_FIXED, ok: false, status: 409 }
    : extOf(data).names.includes(name) || scopesIn(data).includes(name)
      ? undefined
      : {
          message: `no extension ${name}: playground ext list names them, and playground ext add adds one`,
          ok: false,
          status: 404,
        }

// The names given first, in that order, then every other extension as it stood.
export const orderExtensions = (data: string, names: string[], who: Who): Result<Written> => {
  if (!names.length)
    return { message: "name the extensions to put first", ok: false, status: 400 } as const
  if (new Set(names).size !== names.length)
    return { message: "name each extension once", ok: false, status: 400 } as const
  for (const name of names) {
    const bad = known(data, name)
    if (bad) return bad
  }
  const before = extOf(data).names
  return write(
    data,
    "ext.order",
    [...names, ...before.filter((name) => !names.includes(name))],
    who,
  )
}

// An extension linked to one more GitHub org, or to * for every repo; one not yet in ext.order goes last in it.
export const linkExtension = (
  data: string,
  name: string,
  org: string,
  who: Who,
): Result<Written> => {
  const bad = known(data, name)
  if (bad) return bad
  const link = org.toLowerCase()
  if (!extLinkSchema.safeParse(link).success)
    return { message: `${org} is not a GitHub org or *`, ok: false, status: 400 } as const
  const ext = extOf(data)
  if (name === ext.login) return loginLinked(name)
  const had = ext.linksOf(name)
  if (had.includes(link))
    return { message: `${name} is already linked to ${link}`, ok: false, status: 409 } as const
  if (!ext.names.includes(name)) {
    const ordered = write(data, "ext.order", [...ext.names, name], who)
    if (!ordered.ok) return ordered
  }
  return write(data, "ext.links", { ...ext.links, [name]: [...had, link].sort() }, who)
}

export const unlinkExtension = (
  data: string,
  name: string,
  org: string,
  who: Who,
): Result<Written> => {
  const bad = known(data, name)
  if (bad) return bad
  const link = org.toLowerCase()
  const ext = extOf(data)
  if (name === ext.login) return loginLinked(name)
  const had = ext.linksOf(name)
  if (!had.includes(link))
    return { message: `${name} is not linked to ${link}`, ok: false, status: 409 } as const
  return write(
    data,
    "ext.links",
    { ...ext.links, [name]: had.filter((each) => each !== link) },
    who,
  )
}

// An extension out of ext.order, ext.links and ext.repos, so no session reads it; its folder stays, since only a sync has its commits on GitHub, and ext add brings it back.
export const removeExtension = (data: string, name: string, who: Who): Result<{ dir: string }> => {
  const bad = known(data, name)
  if (bad) return bad
  const ext = extOf(data)
  if (name === ext.login) return loginLinked(name)
  const drop = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => key !== name))
  for (const [key, before, after] of [
    ["ext.links", ext.links, drop(ext.links)],
    ["ext.order", ext.names, ext.names.filter((each) => each !== name)],
    ["ext.repos", ext.repos, drop(ext.repos)],
  ] as const) {
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    const done = write(data, key, after, who)
    if (!done.ok) return done
  }
  return { dir: scopeDir(data, name), ok: true } as const
}
