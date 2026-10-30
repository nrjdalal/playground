import { join } from "node:path"

import { isExcluded, renamePath, renameText } from "../rename/rules"
import { FORMER, isTestFile, KINDS } from "./record"

const REFS = [
  ...new Set(
    [
      ...Object.values(KINDS).flatMap((kind) => [...kind.docs, ...kind.settings, ...kind.values]),
      ...Object.values(FORMER),
    ].map((ref) => renamePath(ref)),
  ),
]

// The recording reads only these, so a commit and a working tree with no git beside it (the runner box's copy) list the same files.
const FILES = ["AGENTS.md", ".claude/settings.json"]
const FOLDERS = ["extensions", "scripts", "skills", "tests"]

const wanted = (path: string): boolean =>
  (FILES.includes(path) || FOLDERS.some((folder) => path.startsWith(`${folder}/`))) &&
  !path.includes("/node_modules/") &&
  (isTestFile(path) ||
    REFS.some((ref) =>
      // a folder of rule files takes each file in it
      ref.endsWith("/")
        ? path.startsWith(ref) || path.includes(`/${ref}`)
        : path === ref || path.endsWith(`/${ref}`),
    ))

const normalise = (path: string) => (isExcluded(path) ? path : renamePath(path))

// Each file as the rename codemod leaves it, so a tree from before the rename and one after it compare by meaning; the rules change nothing on a second run, so a renamed tree passes through as it is.
export const asRenamed = (files: Map<string, string>): Map<string, string> =>
  new Map(
    [...files].map(([path, text]) =>
      isExcluded(path) ? [path, text] : [renamePath(path), renameText(text)],
    ),
  )

// The files the recording reads from a commit, through one `git cat-file --batch`.
export const commitTree = async (root: string, ref: string): Promise<Map<string, string>> => {
  const listed = (await Bun.$`git -C ${root} ls-tree -r -z --name-only ${ref}`.text()).split("\0")
  const paths = listed.filter((path) => path && wanted(normalise(path)))
  const proc = Bun.spawn(["git", "-C", root, "cat-file", "--batch"], {
    stdin: "pipe",
    stdout: "pipe",
  })
  proc.stdin.write(paths.map((path) => `${ref}:${path}\n`).join(""))
  await proc.stdin.end()
  const out = Buffer.from(await new Response(proc.stdout).arrayBuffer())
  if ((await proc.exited) !== 0) throw new Error(`git cat-file failed on ${ref}`)
  const files = new Map<string, string>()
  let at = 0
  for (const path of paths) {
    const eol = out.indexOf(10, at)
    const size = Number(out.subarray(at, eol).toString().split(" ")[2])
    files.set(path, out.subarray(eol + 1, eol + 1 + size).toString())
    at = eol + 1 + size + 1
  }
  return asRenamed(files)
}

// The files the recording reads from a checkout's working tree, untracked ones included.
export const workingTree = async (root: string): Promise<Map<string, string>> => {
  const listed = [...FILES]
  for (const folder of FOLDERS)
    for await (const path of new Bun.Glob(`${folder}/**/*`).scan({ cwd: root, onlyFiles: true }))
      listed.push(path)
  const files = new Map<string, string>()
  for (const path of listed) {
    if (!wanted(normalise(path))) continue
    const file = Bun.file(join(root, path))
    if (await file.exists()) files.set(path, await file.text())
  }
  return asRenamed(files)
}
