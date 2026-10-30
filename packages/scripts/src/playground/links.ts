import { lstatSync, readdirSync, readlinkSync } from "node:fs"
import { join } from "node:path"

export type Link = { path: string; target: string }

const entries = (dir: string): string[] => {
  try {
    return readdirSync(dir).map((name) => join(dir, name))
  } catch {
    return []
  }
}

const isLink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

// The folders link-skills.sh links into, ~/.bun/bin, the data folder with its handoffs/ and ops/, and each folder in ops/, and the skills folder, where an older install linked each skill and link-skills.sh prunes them.
const linkFolders = (home: string, data: string): string[] => [
  join(home, ".claude", "skills"),
  join(home, ".bun", "bin"),
  data,
  join(data, "handoffs"),
  join(data, "ops"),
  ...entries(join(data, "ops")).filter((path) => !isLink(path)),
]

// Every link in those folders that points into the checkout, A to Z; a link to anywhere else is someone else's.
export const linksInto = (repo: string, home: string, data: string): Link[] =>
  linkFolders(home, data)
    .flatMap(entries)
    .filter(isLink)
    .map((path) => ({ path, target: readlinkSync(path) }))
    .filter(({ target }) => target === repo || target.startsWith(`${repo}/`))
    .toSorted((a, b) => a.path.localeCompare(b.path))
