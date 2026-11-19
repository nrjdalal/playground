import { lstatSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"

// The sharded path pattern: one stem, one shard index, one total, one extension.
export const SHARD = /^(.+)-(\d{5})-of-(\d{5})\.(gguf|safetensors)$/

// The shard set one sharded path names: every real file in the same folder with the same stem, total and extension, A to Z, a symlink left out, or null for any other path.
export const shardSet = (path: string): string[] | null => {
  const m = SHARD.exec(basename(path))
  if (!m) return null
  const folder = dirname(path)
  const [, stem, , total, ext] = m
  let set: string[] = []
  try {
    for (const name of readdirSync(folder).sort()) {
      if (lstatSync(join(folder, name)).isSymbolicLink()) continue
      const mm = SHARD.exec(name)
      if (!mm) continue
      const [, stemOf, , totalOf, extOf] = mm
      if (stemOf === stem && totalOf === total && extOf === ext) set.push(join(folder, name))
    }
  } catch {
    return null
  }
  return set.length > 0 ? set : null
}
