import { lstatSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { dataDirOf } from "@packages/env/data-dir"
import { quarantine, type Roots } from "@packages/safe-delete"

// The folders the app's deletes start from: HOME, the main checkout of the checkout this code sits in, and the trash in the machine's data folder.
export const trashRoots = (from: string = import.meta.dir): Roots => {
  const git = Bun.spawnSync(
    ["git", "-C", from, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { stderr: "ignore", stdout: "pipe" },
  )
  const main = git.exitCode === 0 ? dirname(git.stdout.toString().trim()) : from
  return { home: homedir(), main, trash: join(dataDirOf(process.env), "trash") }
}

// Moves a path into the trash when one stands there: null once moved or when none does, else the refusal's words, which the caller shows.
export const discard = (
  path: string,
  opts: { reason: string; session: string },
  roots: Roots,
): string | null => {
  try {
    lstatSync(path)
  } catch {
    return null
  }
  const done = quarantine(path, opts, roots)
  return "refused" in done ? done.refused : null
}
