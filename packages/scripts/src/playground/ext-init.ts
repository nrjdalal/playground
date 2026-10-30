import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  CORE,
  CORE_READ_ONLY,
  deriveRoot,
  extensionsDir,
  extGit,
  extRepoOf,
  linkExtension,
  listExtensions,
  extScopeSchema,
  loginOf,
  loginPath,
  mustGit,
  orderExtensions,
  removeExtension,
  scopeDir,
  setSetting,
  settingRows,
  unlinkExtension,
  withLock,
  writeAtomically,
} from "@packages/settings"

import { remoteOf, syncExtensions } from "../ops-ext-sync/sync"
import { run as spawnRun } from "../ops-job/job"
import type { Run } from "../ops-tick/tick"
import { type Io, Usage } from "./store"

// playground ext init, add and sync. init sets this machine's extensions up for the gh login: the root's login file, the private repository the login's scope syncs with (<login>/playground-<login> unless ext.repos names another), made when missing with issues, wiki and projects off, and the login's folder as its clone, started with a first commit (an empty settings.json) when the repository is empty, so the scope has a HEAD to push. Each step checks before it acts, so a second run changes nothing. sync is the nightly ext-sync, run now.

// Whether to go on with a step that writes to GitHub, asked of the person running the command.
export type Confirm = (question: string) => Promise<boolean>

// --yes, else y typed on a terminal; with neither, no, and stdin is never read, since install.sh may run from curl's pipe.
export const askCreate =
  (yes: boolean, err: (line: string) => void = console.error): Confirm =>
  async (question) => {
    if (yes) {
      err(`${question} yes (--yes)`)
      return true
    }
    if (!process.stdin.isTTY) {
      err(`${question} no: stdin is not a terminal, so pass --yes`)
      return false
    }
    return /^y(es)?$/i.test((prompt(question) ?? "").trim())
  }

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

const identity = (login: string) => ({
  GIT_AUTHOR_EMAIL: "playground",
  GIT_AUTHOR_NAME: login,
  GIT_COMMITTER_EMAIL: "playground",
  GIT_COMMITTER_NAME: "Playground",
})

// The URL of the private repository a scope syncs with, made when missing with issues, wiki and projects off once confirm says yes; a public one is refused. Its line goes on lines.
const privateRepo = async (
  run: Run,
  slug: string,
  lines: string[],
  confirm: Confirm,
  command: string,
): Promise<string> => {
  let where = await remoteOf(run, slug)
  if ("refused" in where) throw new Error(where.refused)
  if ("local" in where) {
    const question = `playground ${command} will create ${slug} on GitHub, private, with issues, wiki and projects off. Create it? [y/N]`
    if (!(await confirm(question)))
      throw new Error(
        `${slug} was not created: run playground ${command} in a terminal and answer y, or pass --yes`,
      )
    const steps = [
      ["gh", "repo", "create", slug, "--private", "--disable-issues", "--disable-wiki"],
      ["gh", "repo", "edit", slug, "--enable-projects=false"],
    ]
    for (const argv of steps) {
      const done = await run(argv, 120_000)
      if (done.code !== 0)
        throw new Error(`${argv.slice(0, 3).join(" ")} failed: ${done.out.trim()}`)
    }
    where = await remoteOf(run, slug)
    if (!("url" in where)) throw new Error(`gh made ${slug} but does not show it as private`)
    lines.push(`made ${slug}, private, with issues, wiki and projects off`)
  } else lines.push(`${slug} is private`)
  return where.url
}

// The gh login init sets the extensions up for, refused when gh has none or the folder is another login's.
const initLogin = async (data: string, run: Run): Promise<string> => {
  const asked = await run(["gh", "api", "user", "--jq", ".login"], 60_000)
  const login = asked.code === 0 ? asked.out.trim() : ""
  if (!extScopeSchema.safeParse(login).success)
    throw new Error("gh has no login here: run gh auth login, then playground ext init")
  const had = existsSync(loginPath(data)) ? readFileSync(loginPath(data), "utf8").trim() : ""
  if (had && had !== login)
    throw new Error(
      `these extensions are ${had}'s and gh is signed in as ${login}: sign gh in as ${had}, or use another data folder`,
    )
  return login
}

// ext init --dry-run: the login and the private repository init would use, and whether it is there yet (a public one is refused, as init refuses it), read through gh and making nothing.
export async function extInitCheck(
  data: string,
  run: Run = spawnRun,
): Promise<{ exists: boolean; login: string; repo: string }> {
  const login = await initLogin(data, run)
  const repo = extRepoOf(data, login, login)
  const where = await remoteOf(run, repo)
  if ("refused" in where) throw new Error(where.refused)
  return { exists: !("local" in where), login, repo }
}

export async function extInit(data: string, run: Run, confirm: Confirm): Promise<string[]> {
  const login = await initLogin(data, run)
  const file = loginPath(data)
  const slug = extRepoOf(data, login, login)
  const lines = [`login ${login}`]
  const url = await privateRepo(run, slug, lines, confirm, "ext init")
  const root = extensionsDir(data)
  const dir = scopeDir(data, login)
  mkdirSync(root, { recursive: true })
  withLock(data, () => {
    if (existsSync(join(dir, ".git"))) lines.push(`${dir} is already a clone`)
    else if (existsSync(dir) && readdirSync(dir).length)
      throw new Error(
        `${dir} holds files but no clone: move them aside, then run playground ext init`,
      )
    else if (mustGit(root, ["ls-remote", "--heads", url])) {
      mustGit(root, ["clone", "-q", url, login])
      lines.push(`cloned ${slug} into ${dir}`)
    } else {
      mkdirSync(dir, { recursive: true })
      mustGit(dir, ["init", "-q", "-b", "main"])
      writeAtomically(join(dir, "settings.json"), "{}\n")
      mustGit(dir, ["add", "settings.json"])
      mustGit(dir, ["commit", "-q", "-m", "init"], identity(login))
      lines.push(`started ${dir} with a first commit`)
    }
    if (extGit(dir, ["remote", "set-url", "origin", url]).code !== 0)
      mustGit(dir, ["remote", "add", "origin", url])
    writeAtomically(file, `${login}\n`)
    deriveRoot(data, login)
  })
  return lines
}

// A name ext add gives a new extension: its folder's, lowercase, so no two differ by case alone on a Mac's file system.
const NAME = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/

// The repository ext add would use for name, after the words' checks.
const addSlug = (data: string, name: string, named: string | undefined) => {
  if (name === CORE) throw new Usage(CORE_READ_ONLY)
  if (!NAME.test(name))
    throw new Usage(`${name} is not an extension's name: lowercase letters, digits and dashes`)
  if (named !== undefined && !REPO.test(named))
    throw new Usage(`${named} is not a repository: give it as owner/name`)
  const login = loginOf(data)
  if (name === login)
    throw new Usage(`${name} is your login's extension: playground ext init sets it up`)
  return { login, slug: named ?? extRepoOf(data, login, name) }
}

// ext add --dry-run: what ext add would find on GitHub, read through gh and making nothing: the repository it would use, whether it is there yet (a public one is refused, as ext add refuses it), and how many entries its skills/ holds.
export async function extAddCheck(
  data: string,
  name: string,
  named: string | undefined,
  run: Run = spawnRun,
): Promise<{ exists: boolean; repo: string; skills: number }> {
  const { slug } = addSlug(data, name, named)
  const where = await remoteOf(run, slug)
  if ("refused" in where) throw new Error(where.refused)
  if ("local" in where) return { exists: false, repo: slug, skills: 0 }
  const listed = await run(["gh", "api", `repos/${slug}/contents/skills`, "--jq", "length"], 60_000)
  return {
    exists: true,
    repo: slug,
    skills: listed.code === 0 ? Number(listed.out.trim()) || 0 : 0,
  }
}

// ext add sets an extension up beside the login's: its private repository (the one named, else the one ext.repos names, else <login>/playground-<name>), made when missing; its folder as its clone, any files already in it kept in a commit on top; a named repository recorded in ext.repos; and the name last in ext.order, linked to no org until ext link links it. ext sync then pulls it with the login's.
export async function extAdd(
  data: string,
  name: string,
  named: string | undefined,
  run: Run,
  confirm: Confirm,
): Promise<string[]> {
  const { login, slug } = addSlug(data, name, named)
  const lines: string[] = []
  const url = await privateRepo(run, slug, lines, confirm, "ext add")
  const dir = scopeDir(data, name)
  withLock(data, () => {
    if (existsSync(join(dir, ".git"))) lines.push(`${dir} is already a clone`)
    else {
      const kept = existsSync(dir) && readdirSync(dir).length > 0
      mkdirSync(dir, { recursive: true })
      mustGit(dir, ["init", "-q", "-b", "main"])
      mustGit(dir, ["remote", "add", "origin", url])
      const pulled = mustGit(dir, ["ls-remote", "--heads", "origin"]) !== ""
      if (pulled) {
        mustGit(dir, ["fetch", "-q", "origin"])
        mustGit(dir, ["reset", "-q", "origin/main"])
        // writes each file the clone brings that is not here yet, leaving the folder's own files as they are
        extGit(dir, ["checkout-index", "-a", "-q"])
      } else if (!kept) writeAtomically(join(dir, "settings.json"), "{}\n")
      mustGit(dir, ["add", "-A"])
      if (extGit(dir, ["diff", "--cached", "--quiet"]).code !== 0)
        mustGit(
          dir,
          ["commit", "-q", "-m", pulled ? "keep the files already here" : "init"],
          identity(login),
        )
      lines.push(
        pulled
          ? `cloned ${slug} into ${dir}${kept ? ", keeping its own files" : ""}`
          : `started ${dir} with a first commit`,
      )
    }
    deriveRoot(data, login)
  })
  const own = <T>(key: string, empty: T): T =>
    (settingRows(data).find((row) => row.scope === login && row.key === key)?.value ?? empty) as T
  const set = (key: string, value: unknown) => {
    const done = setSetting(
      data,
      { key, scope: login, value },
      { actor: "cli", author: "owner", inboxRef: null, reason: `ext add ${name}` },
    )
    if (!done.ok) throw new Error(`${key}: ${done.message}`)
  }
  if (slug !== extRepoOf(data, login, name)) {
    set("ext.repos", { ...own<Record<string, string>>("ext.repos", {}), [name]: slug })
    lines.push(`ext.repos now takes ${name} to ${slug}`)
  }
  const order = own<string[]>("ext.order", [])
  if (!order.includes(name)) {
    set("ext.order", [...(order.includes(login) ? order : [login, ...order]), name])
    lines.push(`${name} is last in ext.order: playground ext order ${name} puts it first`)
  }
  if (!(own<Record<string, string[]>>("ext.links", {})[name] ?? []).length)
    lines.push(`${name} is linked to no org yet: playground ext link ${name} <org|*> links it`)
  return lines
}

export async function extVerb(
  verb: "add" | "init" | "sync",
  words: string[],
  io: Io,
  run: Run = spawnRun,
  confirm: Confirm = async () => false,
): Promise<number> {
  const lines =
    verb === "add"
      ? await extAdd(io.data, words[0] ?? "", words[1], run, confirm)
      : verb === "init"
        ? await extInit(io.data, run, confirm)
        : await syncExtensions({ data: io.data, only: words[0], run })
  for (const line of lines) io.out(line)
  return 0
}

// ext order, link, unlink and remove: the login's ext.order, ext.links and ext.repos rearranged, each change one commit whose reason is the command; a refusal exits 2 when it is the words', else 1.
export function extArrange(verb: "link" | "order" | "remove" | "unlink", words: string[], io: Io) {
  const who = {
    actor: "cli",
    author: "owner",
    inboxRef: null,
    reason: `ext ${[verb, ...words].join(" ")}`,
  }
  const [name = "", org = ""] = words
  const pair = verb === "link" || verb === "unlink"
  if (verb === "order" ? !words.length : words.length !== (pair ? 2 : 1))
    throw new Usage(
      verb === "order"
        ? "order takes the names to put first"
        : `${verb} takes ${pair ? "a name and an org or *" : "a name"}`,
    )
  const done =
    verb === "order"
      ? orderExtensions(io.data, words, who)
      : verb === "link"
        ? linkExtension(io.data, name, org, who)
        : verb === "unlink"
          ? unlinkExtension(io.data, name, org, who)
          : removeExtension(io.data, name, who)
  if (!done.ok) throw done.status === 400 ? new Usage(done.message) : new Error(done.message)
  io.out(
    verb === "order"
      ? `ext.order is now ${listExtensions(io.data)
          .map((ext) => ext.name)
          .join(", ")}`
      : verb === "remove"
        ? `removed ${name}: no session reads it, and ${scopeDir(io.data, name)} stays until you delete it`
        : `${name} is ${verb}ed ${verb === "link" ? "to" : "from"} ${org.toLowerCase()}`,
  )
  return 0
}
