import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

// A skill's folder and its files' paths within it.
export type Skill = { dir: string; files: string[]; name: string }

// The id writePlugin names a set's folder by, <data>/orgs/<set>/<id>: sha256 over each skill's name and each file's path and bytes, skills by name and files as listed, its first 16 hex characters.
export const setId = (skills: Skill[]): string => {
  const hash = createHash("sha256")
  for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name)))
    for (const file of skill.files)
      hash.update(`${skill.name}/${file}\0`).update(readFileSync(join(skill.dir, file)))
  return hash.digest("hex").slice(0, 16)
}

// An installed set's skills, read from its skills folder with no link followed; undefined when it holds anything but folders and regular files of one link each, since a symlink or a hard link lets a write outside the set change what it runs.
export const installedSkills = (skills: string): Skill[] | undefined => {
  const walk = (dir: string, root: string, files: string[]): boolean =>
    readdirSync(dir).every((entry) => {
      const path = join(dir, entry)
      const stat = lstatSync(path)
      if (stat.isDirectory()) return walk(path, root, files)
      files.push(relative(root, path))
      return stat.isFile() && stat.nlink === 1
    })
  try {
    const found: Skill[] = []
    for (const name of readdirSync(skills)) {
      const dir = join(skills, name)
      const files: string[] = []
      if (!lstatSync(dir).isDirectory() || !walk(dir, dir, files)) return undefined
      found.push({ dir, files: files.sort(), name })
    }
    return found
  } catch {
    return undefined
  }
}
