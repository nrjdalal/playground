import { lstatSync } from "node:fs"
import { basename, dirname, join } from "node:path"

import type { Entry, Kind } from "./record"

// The seed's reading of the data folder's two hand-kept notes: bundles/footprint.md's tree for one machine (each line a path, a comment its why) and bundles/spark-9dfb-undo.md's undo line for each path it names.

export const FOOTPRINT_NOTE = "footprint.md"
export const UNDO_NOTE = "spark-9dfb-undo.md"

const TREE = /^((?:│ {3}| {4})*)(?:├── |└── )(.+)$/
const NO_UNDO = `see bundles/${FOOTPRINT_NOTE} and bundles/${UNDO_NOTE}`

// Pure: each path the footprint tree lists under the machine whose heading line starts with its name, with the line's comment: ~/ read under home, a line's comma list sharing its first item's folder, and `docker:` items as images (a name holding a colon) or containers.
export function treePaths(
  text: string,
  machine: string,
  home: string,
): { comment: string; folder: boolean; path: string }[] {
  const out: { comment: string; folder: boolean; path: string }[] = []
  let mine = false
  const parents: string[] = []
  for (const line of text.split("\n")) {
    if (/^\S/.test(line) && !TREE.test(line)) {
      mine = line.split(/\s/)[0] === machine
      parents.length = 0
      continue
    }
    const found = mine && TREE.exec(line)
    if (!found) continue
    const depth = found[1]!.length / 4
    const [names, comment = ""] = found[2]!.split(/\s+#\s*/)
    const items = names!.trim().split(/,\s*/)
    if (depth === 0 && items[0]!.startsWith("docker:")) {
      items[0] = items[0]!.slice("docker:".length).trim()
      for (const item of items)
        out.push({
          comment,
          folder: false,
          path: `docker ${item.includes(":") ? "image" : "container"} ${item}`,
        })
      continue
    }
    const first = items[0]!
    const base = depth === 0 ? "" : parents[depth - 1]!
    const at = (name: string) =>
      name === "~/" || name === "~"
        ? home
        : base
          ? join(base, name)
          : name.replace(/^~\//, `${home}/`)
    parents[depth] = at(first).replace(/\/+$/, "")
    const shared = dirname(first.replace(/\/+$/, ""))
    for (const [i, item] of items.entries()) {
      const name = i === 0 ? item : shared === "." ? item : `${shared}/${item}`
      const path = at(name)
      if (path === home) continue
      out.push({ comment, folder: item.endsWith("/"), path: path.replace(/\/+$/, "") })
    }
  }
  return out
}

// Pure: the undo line of the undo note's first step that names this path, as ~/ or whole, else a pointer to both notes.
export function undoOf(text: string, path: string, home: string): string {
  const forms = [path, path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : null]
  for (const step of text.split(/\n(?=\d+\. |## |- `)/)) {
    if (!forms.some((form) => form && step.includes(form))) continue
    const undo = step
      .split("\n")
      .map((line) => line.trim().replace(/^- /, ""))
      .find((line) => /^Undo\b/.test(line))
    if (undo) return undo
  }
  return NO_UNDO
}

const kindOf = (path: string, folder: boolean): Kind => {
  if (path.startsWith("docker image ")) return "image"
  if (path.startsWith("docker container ")) return "container"
  const stat = (() => {
    try {
      return lstatSync(path)
    } catch {
      return null
    }
  })()
  if (stat?.isSymbolicLink()) return "link"
  if (stat?.isDirectory()) return "folder"
  return stat ? "file" : folder ? "folder" : "file"
}

// Each glob in a path read on this machine, or the path as written when nothing matches, so a recorded path that never was reads gone.
const expand = (path: string): string[] => {
  if (!path.includes("*")) return [path]
  const matched = [...new Bun.Glob(basename(path)).scanSync({ cwd: dirname(path), dot: true })]
  return matched.length ? matched.map((name) => join(dirname(path), name)).sort() : [path]
}

// The seed's entries for one machine from the two notes' text.
export function seedEntries(
  footprint: string,
  undo: string,
  machine: string,
  home: string,
  now: Date,
): Entry[] {
  return treePaths(footprint, machine, home).flatMap(({ comment, folder, path }) =>
    (path.startsWith("docker ") ? [path] : expand(path)).map((each) => ({
      added: now.toISOString(),
      by: "seed",
      kind: kindOf(each, folder),
      path: each,
      undo: undoOf(undo, path, home),
      why: `seeded from bundles/${FOOTPRINT_NOTE}${comment ? `: ${comment}` : ""}`,
    })),
  )
}
